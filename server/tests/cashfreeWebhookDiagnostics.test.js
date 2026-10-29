import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable } from 'node:stream'
import { createHmac } from 'node:crypto'
import { initializeDatabase } from '../db.js'
import { createCashfreeProvider } from '../services/cashfreeProvider.js'
import { campusDate } from '../../shared/pickupPolicy.js'
import { initiatePayment } from '../services/payments.js'
import { handlePaymentRoutes } from '../routes/payments.js'
import { describeCashfreeWebhookRejection, logCashfreeWebhookRejection } from '../services/webhookDiagnostics.js'

const SAMOSA = 4
const SECRET = 'cfsk_ma_test_syntheticwebhooksecret0123456789'
const PHONE = '+919000000001'
const config = { enabled: true, provider: 'cashfree', publicAppUrl: 'https://example.com',
  cashfree: { environment: 'sandbox', clientId: 'synthetic-id', clientSecret: SECRET } }
const PATH = '/api/payments/webhook/cashfree'

function setup(t) {
  const db = initializeDatabase(':memory:')
  t.after(() => db.close())
  db.prepare('INSERT INTO daily_menu_stock (service_date, menu_item_id, quantity) VALUES (?, ?, ?)').run(campusDate(new Date()), SAMOSA, 20)
  const studentId = Number(db.prepare(`INSERT INTO users (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES ('webhook-student', 'STUDENT', 'Test', ?, 1, 'ACTIVE')`).run(PHONE).lastInsertRowid)
  const provider = createCashfreeProvider(config, async (url, options = {}) => {
    const body = JSON.parse(options.body)
    return Response.json({ ...body, payment_session_id: 'session_webhook' })
  }, { logger: () => {} })
  return { db, provider, studentId }
}

function successBody(orderId, amount = 20, paymentId = '885511') {
  return Buffer.from(JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', event_time: '2026-10-26T08:22:37+05:30', data: {
    order: { order_id: orderId, order_amount: amount, order_currency: 'INR', order_tags: null },
    payment: { cf_payment_id: Number(paymentId), payment_status: 'SUCCESS', payment_amount: amount, payment_currency: 'INR' },
    customer_details: { customer_phone: '9000000001', customer_email: 'student@example.com' } } }))
}
const sign = (timestamp, body, secret = SECRET) => createHmac('sha256', secret).update(timestamp).update(body).digest('base64')

function headersFor(body, { signature, timestamp, extra = {} } = {}) {
  const ts = timestamp === undefined ? String(Date.now()) : timestamp
  const headers = { 'content-type': 'application/json', 'content-length': String(body.length), 'x-webhook-version': '2023-08-01', ...extra }
  if (ts !== null) headers['x-webhook-timestamp'] = ts
  const sig = signature === undefined ? sign(ts ?? '', body) : signature
  if (sig !== null) headers['x-webhook-signature'] = sig
  return headers
}

async function deliver(db, provider, body, headers) {
  const request = Readable.from([body])
  request.method = 'POST'
  request.headers = headers
  const response = { status: null, body: null, writeHead(status) { this.status = status }, end(text) { this.body = text } }
  const logs = []
  const original = console.warn
  console.warn = (line) => logs.push(String(line))
  try {
    await handlePaymentRoutes(request, response, new URL(`http://localhost${PATH}`), db, {}, config, provider)
    return { status: response.status, logs }
  } catch (error) {
    return { status: error.statusCode, code: error.code, message: error.message, logs }
  } finally {
    console.warn = original
  }
}

const orders = (db) => db.prepare('SELECT count(*) AS n FROM orders').get().n
const forbidden = (orderId, body, headers) => [SECRET, PHONE, '9000000001', 'student@example.com', orderId, '885511',
  'session_webhook', body.toString('utf8'), headers['x-webhook-signature'], headers['x-webhook-timestamp']].filter(Boolean)

test('each rejection category keeps the same 400 response and logs only safe metadata', async (t) => {
  const { db, provider, studentId } = setup(t)
  const attempt = await initiatePayment(db, { idempotencyKey: 'webhook-diag-1', items: [{ menuItemId: SAMOSA, quantity: 1 }], pickupMethod: 'asap' }, studentId, config, provider)
  const body = successBody(attempt.attemptId)
  const now = String(Date.now())
  const cases = [
    ['signature_missing', headersFor(body, { signature: null })],
    ['signature_missing', headersFor(body, { signature: '' })],
    ['signature_malformed', headersFor(body, { signature: 'x'.repeat(44) })],
    ['signature_malformed', headersFor(body, { signature: 'é'.repeat(44) })],
    ['signature_malformed', headersFor(body, { signature: sign(now, body).slice(0, 40) })],
    ['timestamp_missing', headersFor(body, { timestamp: null, signature: sign('', body) })],
    ['timestamp_malformed', headersFor(body, { timestamp: 'not-a-time', signature: sign('not-a-time', body) })],
    ['timestamp_malformed', headersFor(body, { timestamp: '123', signature: sign('123', body) })],
    ['signature_mismatch', headersFor(body, { timestamp: now, signature: sign(now, body, 'a-different-secret') })],
    ['signature_mismatch', headersFor(body, { timestamp: now, signature: sign(String(Number(now) + 1), body) })],
  ]
  for (const [category, headers] of cases) {
    const result = await deliver(db, provider, body, headers)
    assert.deepEqual([result.status, result.code, result.message], [400, 'webhook_signature_invalid', 'Webhook verification failed.'], category)
    assert.equal(result.logs.length, 1, category)
    assert.match(result.logs[0], /^\[campusbite-api\] Cashfree webhook rejected \{/)
    const logged = JSON.parse(result.logs[0].replace('[campusbite-api] Cashfree webhook rejected ', ''))
    assert.equal(logged.category, category)
    for (const value of forbidden(attempt.attemptId, body, headers)) assert.ok(!result.logs[0].includes(value), `${category} leaked a value`)
  }
  // Tampered body with an otherwise valid signature is a mismatch too.
  const tampered = successBody(attempt.attemptId, 20, '885512')
  const tamperedResult = await deliver(db, provider, tampered, { ...headersFor(body, { timestamp: now }), 'content-length': String(tampered.length) })
  assert.equal(JSON.parse(tamperedResult.logs[0].split(' rejected ')[1]).category, 'signature_mismatch')
  assert.equal(orders(db), 0)
})

test('a correctly signed payment that does not match the stored attempt is logged as payment_mismatch', async (t) => {
  const { db, provider, studentId } = setup(t)
  const attempt = await initiatePayment(db, { idempotencyKey: 'webhook-diag-2', items: [{ menuItemId: SAMOSA, quantity: 1 }], pickupMethod: 'asap' }, studentId, config, provider)
  const body = successBody(attempt.attemptId, 30)
  const headers = headersFor(body)
  const result = await deliver(db, provider, body, headers)
  assert.deepEqual([result.status, result.code], [400, 'webhook_payment_mismatch'])
  const logged = JSON.parse(result.logs[0].split(' rejected ')[1])
  assert.equal(logged.category, 'payment_mismatch')
  assert.equal(logged.signaturePresent, true)
  for (const value of forbidden(attempt.attemptId, body, headers)) assert.ok(!result.logs[0].includes(value))
  assert.equal(orders(db), 0)
})

test('a valid webhook is still accepted once; duplicates stay idempotent and log nothing', async (t) => {
  const { db, provider, studentId } = setup(t)
  const attempt = await initiatePayment(db, { idempotencyKey: 'webhook-diag-3', items: [{ menuItemId: SAMOSA, quantity: 1 }], pickupMethod: 'asap' }, studentId, config, provider)
  const body = successBody(attempt.attemptId)
  for (let delivery = 0; delivery < 3; delivery += 1) {
    const result = await deliver(db, provider, body, headersFor(body))
    assert.equal(result.status, 200)
    assert.deepEqual(result.logs, [])
  }
  assert.equal(orders(db), 1)
  assert.equal(db.prepare("SELECT status FROM payment_attempts").get().status, 'paid')
})

test('metadata reports header shape, clock skew, version, encoding and length without values', () => {
  const error = Object.assign(new Error('x'), { statusCode: 400, webhookRejection: 'signature_mismatch' })
  const now = Date.parse('2026-10-26T02:52:37Z')
  const body = Buffer.from('{"a":1}')
  const d = describeCashfreeWebhookRejection(error, {
    'x-webhook-signature': 'A'.repeat(43) + '=', 'x-webhook-timestamp': String(now - 4000), 'x-webhook-version': '2023-08-01',
    'content-type': 'application/json; charset=utf-8', 'content-encoding': 'gzip', 'content-length': '99',
  }, body, now)
  assert.deepEqual(d, { category: 'signature_mismatch', httpStatus: 400, signaturePresent: true, signatureLength: 44, signatureBase64: true,
    signatureRepeated: false, timestampPresent: true, timestampDigits: 13, clockSkewSeconds: 4, webhookVersion: '2023-08-01', bodyBytes: 7,
    contentLength: 99, contentLengthMatchesBody: false, contentType: 'application/json', contentEncoding: 'gzip' })
  const odd = describeCashfreeWebhookRejection(error, { 'x-webhook-signature': ['a', 'b'], 'x-webhook-version': 'secret-ish-value',
    'content-type': 'text/evil', 'content-encoding': 'x-custom', 'content-length': 'abc', 'x-webhook-timestamp': '1761447157' }, body, now)
  assert.equal(odd.signatureRepeated, true)
  assert.equal(odd.signatureLength, null)
  assert.equal(odd.webhookVersion, 'other')
  assert.equal(odd.contentType, 'other')
  assert.equal(odd.contentEncoding, 'other')
  assert.equal(odd.contentLength, null)
  assert.equal(odd.timestampDigits, 10)
  assert.equal(typeof odd.clockSkewSeconds, 'number')
  assert.ok(!JSON.stringify(odd).includes('secret-ish-value'))
  const missing = describeCashfreeWebhookRejection(error, {}, body, now)
  assert.equal(missing.webhookVersion, 'absent')
  assert.equal(missing.signaturePresent, false)
  assert.equal(missing.timestampDigits, null)
  // Errors without a rejection category (e.g. 502 malformed payload) are not logged.
  assert.equal(logCashfreeWebhookRejection(new Error('other'), {}, body, () => assert.fail('should not log')), null)
})

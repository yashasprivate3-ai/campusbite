import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initializeDatabase } from '../db.js'
import { createCashfreeProvider, cashfreeCustomerId, sanitizeCashfreeError } from '../services/cashfreeProvider.js'
import { campusDate } from '../../shared/pickupPolicy.js'
import { initiatePayment, reconcilePaymentHolds, RELEASE_GRACE_MS } from '../services/payments.js'

// Samosa (item 4, Rs 20, ready now) avoids the rice time-of-day rule.
const SAMOSA = 4
const PHONE = '+919000000001'
const SECRET = 'cfsk_ma_test_syntheticsecretvalue0123456789'
const CLIENT_ID = 'TEST1234567890syntheticclientid'
const config = { enabled: true, provider: 'cashfree', publicAppUrl: 'https://example.com',
  cashfree: { environment: 'sandbox', clientId: CLIENT_ID, clientSecret: SECRET } }
const cart = (key) => ({ idempotencyKey: key, items: [{ menuItemId: SAMOSA, quantity: 1 }], pickupMethod: 'asap' })

// A Cashfree-style validation error that echoes back sensitive-looking values.
const REJECTION = {
  code: 'customer_details.customer_id_invalid',
  type: 'invalid_request_error',
  message: `customer_id is invalid for 9000000001 student@example.com ${SECRET} session_abcdefghijklmnopqrstuvwxyz0123`,
}

function setup(t, { create = 'ok', lookup = 'missing' } = {}) {
  const db = initializeDatabase(':memory:')
  t.after(() => db.close())
  const today = campusDate(new Date())
  db.prepare('INSERT INTO daily_menu_stock (service_date, menu_item_id, quantity) VALUES (?, ?, ?)').run(today, SAMOSA, 20)
  const studentId = Number(db.prepare(`INSERT INTO users (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES ('diag-student', 'STUDENT', 'Test', ?, 1, 'ACTIVE')`).run(PHONE).lastInsertRowid)
  const state = { create, lookup, calls: [], logs: [] }
  const provider = createCashfreeProvider(config, async (url, options = {}) => {
    state.calls.push({ url, method: options.method || 'GET', headers: options.headers, body: options.body })
    if (options.method === 'POST') {
      if (state.create === 'reject') return Response.json(REJECTION, { status: 400 })
      if (state.create === 'unauthorized') return new Response('<html>Unauthorized</html>', { status: 401 })
      const body = JSON.parse(options.body)
      return Response.json({ ...body, payment_session_id: 'session_synthetic' })
    }
    if (state.lookup === 'missing') return Response.json({ code: 'order_not_found', type: 'invalid_request_error', message: 'order not found' }, { status: 404 })
    return Response.json({ code: 'request_failed', type: 'authentication_error', message: 'authentication Failed' }, { status: 401 })
  }, { logger: (line) => state.logs.push(line) })
  const stock = () => db.prepare(`SELECT
      (SELECT quantity FROM daily_menu_stock WHERE service_date = ? AND menu_item_id = ?) AS quantity,
      (SELECT COALESCE(SUM(quantity), 0) FROM stock_reservations WHERE status = 'held') AS held,
      (SELECT COUNT(*) FROM orders) AS orders`).get(today, SAMOSA)
  return { db, provider, state, studentId, stock }
}
const expire = (db, attemptId) => db.prepare('UPDATE payment_attempts SET expires_at = ? WHERE public_id = ?')
  .run(new Date(Date.now() - RELEASE_GRACE_MS - 60_000).toISOString(), attemptId)
const forbidden = ['9000000001', PHONE, 'student@example.com', SECRET, CLIENT_ID, 'session_abcdefghijklmnopqrstuvwxyz0123', 'x-client-secret']

test('customer_id is deterministic, alphanumeric and 3-50 characters; order_id stays the attempt id', async (t) => {
  const attemptId = 'pay_f8d9a352-3f3a-454c-94a3-b7f44ba33591'
  assert.equal(cashfreeCustomerId(attemptId), 'custpayf8d9a3523f3a454c94a3b7f44ba33591')
  assert.equal(cashfreeCustomerId(attemptId), cashfreeCustomerId(attemptId))
  assert.notEqual(cashfreeCustomerId(attemptId), cashfreeCustomerId('pay_00000000-0000-4000-8000-000000000000'))
  for (const bad of ['', '---', undefined, `pay_${'a'.repeat(60)}`]) assert.throws(() => cashfreeCustomerId(bad))

  const { db, provider, state, studentId } = setup(t)
  const a = await initiatePayment(db, cart('diag-valid-1'), studentId, config, provider)
  const body = JSON.parse(state.calls[0].body)
  assert.match(body.customer_details.customer_id, /^[A-Za-z0-9]{3,50}$/)
  assert.equal(body.customer_details.customer_id, cashfreeCustomerId(a.attemptId))
  assert.equal(body.order_id, a.attemptId)
  assert.match(a.attemptId, /^pay_[0-9a-f-]{36}$/)
  assert.equal(db.prepare('SELECT provider_order_id FROM payment_attempts').get().provider_order_id, a.attemptId)
  assert.equal(state.calls[0].headers['x-idempotency-key'], a.attemptId.replace(/^pay_/, ''))
  assert.equal(body.customer_details.customer_phone, '9000000001')
})

test('sanitizer keeps only status, safe code/type and a redacted, length-limited message', () => {
  const diagnostic = sanitizeCashfreeError(400, JSON.stringify(REJECTION))
  assert.equal(diagnostic.httpStatus, 400)
  assert.equal(diagnostic.code, 'customer_details.customer_id_invalid')
  assert.equal(diagnostic.type, 'invalid_request_error')
  for (const value of forbidden) assert.ok(!JSON.stringify(diagnostic).includes(value), value)
  assert.match(diagnostic.message, /^customer_id is invalid for \[number\] \[email\] \[redacted\]/)
  assert.ok(sanitizeCashfreeError(400, JSON.stringify({ message: 'x '.repeat(500) })).message.length <= 200)
  assert.deepEqual(sanitizeCashfreeError(502, '<html>bad gateway</html>'), { httpStatus: 502, code: null, type: null, message: null })
  assert.equal(sanitizeCashfreeError(400, JSON.stringify({ code: `bad code ${SECRET}`, type: SECRET })).code, null)
  assert.equal(sanitizeCashfreeError(400, JSON.stringify({ type: SECRET })).type, null)
})

test('a Cashfree rejection is logged safely while the student sees only the generic error', async (t) => {
  const { db, provider, state, studentId } = setup(t, { create: 'reject' })
  await assert.rejects(initiatePayment(db, cart('diag-reject-1'), studentId, config, provider), (error) => {
    assert.equal(error.code, 'payment_gateway_rejected')
    assert.equal(error.message, 'Payment service rejected the request.')
    assert.equal(error.statusCode, 502)
    assert.equal(error.providerDiagnostic.code, 'customer_details.customer_id_invalid')
    // What sendApiError returns to the student: code, message and details only.
    const studentPayload = JSON.stringify({ error: error.code, message: error.message, details: error.details })
    assert.ok(!studentPayload.includes('customer_id_invalid'))
    assert.ok(!studentPayload.includes('invalid_request_error'))
    return true
  })
  assert.equal(state.logs.length, 1)
  const logged = JSON.parse(state.logs[0].replace('[campusbite-api] Cashfree API error ', ''))
  assert.equal(logged.operation, 'create_order')
  assert.equal(logged.httpStatus, 400)
  assert.equal(logged.code, 'customer_details.customer_id_invalid')
  assert.equal(logged.type, 'invalid_request_error')
  for (const value of forbidden) assert.ok(!state.logs[0].includes(value), value)

  const row = db.prepare('SELECT status, response_code, response_message FROM payment_attempts').get()
  assert.equal(row.status, 'failed')
  assert.equal(row.response_code, 'payment_gateway_rejected')
  assert.equal(row.response_message, 'Payment service rejected the request.')

  const event = db.prepare("SELECT metadata_json FROM auth_events WHERE event_type = 'PAYMENT_INITIATION_FAILED'").get()
  const metadata = JSON.parse(event.metadata_json)
  assert.equal(String(metadata.providerHttpStatus), '400')
  assert.equal(metadata.providerCode, 'customer_details.customer_id_invalid')
  for (const value of forbidden) assert.ok(!event.metadata_json.includes(value), value)
})

test('a non-JSON Cashfree error still gives a generic student error and a status-only diagnostic', async (t) => {
  const { db, provider, state, studentId } = setup(t, { create: 'unauthorized' })
  await assert.rejects(initiatePayment(db, cart('diag-401-1'), studentId, config, provider), { code: 'payment_gateway_rejected' })
  const logged = JSON.parse(state.logs[0].replace('[campusbite-api] Cashfree API error ', ''))
  assert.deepEqual(logged, { operation: 'create_order', httpStatus: 401, code: null, type: null, message: null })
})

test('idempotency: a rejected attempt is never re-sent; a new cart key gets a new attempt and customer_id', async (t) => {
  const { db, provider, state, studentId } = setup(t, { create: 'reject' })
  await assert.rejects(initiatePayment(db, cart('diag-idem-1'), studentId, config, provider), { code: 'payment_gateway_rejected' })
  await assert.rejects(initiatePayment(db, cart('diag-idem-1'), studentId, config, provider), { code: 'payment_attempt_terminal' })
  assert.equal(state.calls.length, 1)
  state.create = 'ok'
  const next = await initiatePayment(db, cart('diag-idem-2'), studentId, config, provider)
  assert.equal(state.calls.length, 2)
  const [first, second] = state.calls.map((call) => JSON.parse(call.body))
  assert.notEqual(first.order_id, second.order_id)
  assert.notEqual(first.customer_details.customer_id, second.customer_details.customer_id)
  assert.notEqual(state.calls[0].headers['x-idempotency-key'], state.calls[1].headers['x-idempotency-key'])
  assert.equal(second.order_id, next.attemptId)
})

test('stock held by a rejected order is released once Cashfree confirms the order does not exist', async (t) => {
  const { db, provider, state, studentId, stock } = setup(t, { create: 'reject', lookup: 'missing' })
  await assert.rejects(initiatePayment(db, cart('diag-release-1'), studentId, config, provider))
  assert.deepEqual({ ...stock() }, { quantity: 20, held: 1, orders: 0 })
  const attemptId = db.prepare('SELECT public_id FROM payment_attempts').get().public_id

  // Before expiry plus grace, nothing is released and Cashfree is not asked.
  assert.equal((await reconcilePaymentHolds(db, config, provider)).checked, 0)
  assert.equal(stock().held, 1)

  expire(db, attemptId)
  const summary = await reconcilePaymentHolds(db, config, provider)
  assert.equal(summary.released, 1)
  assert.deepEqual({ ...stock() }, { quantity: 20, held: 0, orders: 0 })
  assert.equal((await reconcilePaymentHolds(db, config, provider)).checked, 0)
  assert.ok(state.logs.some((line) => line.includes('"operation":"get_order"') && line.includes('"httpStatus":404')))
})

test('if Cashfree refuses the status check, the hold is kept (deferred) rather than released blindly', async (t) => {
  const { db, provider, studentId, stock } = setup(t, { create: 'reject', lookup: 'unauthorized' })
  await assert.rejects(initiatePayment(db, cart('diag-defer-1'), studentId, config, provider))
  expire(db, db.prepare('SELECT public_id FROM payment_attempts').get().public_id)
  const summary = await reconcilePaymentHolds(db, config, provider)
  assert.equal(summary.deferred, 1)
  assert.equal(summary.released, 0)
  assert.deepEqual({ ...stock() }, { quantity: 20, held: 1, orders: 0 })
})

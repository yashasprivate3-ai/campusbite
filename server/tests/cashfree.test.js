import assert from 'node:assert/strict'
const orderingClock = () => new Date('2099-10-17T06:30:00Z')
function seedStock(db) { for (let id = 1; id <= 6; id++) db.prepare('INSERT OR IGNORE INTO daily_menu_stock (service_date, menu_item_id, quantity) VALUES (?, ?, ?)').run('2099-10-17', id, 1000) }
import { test } from 'node:test'
import { createHmac } from 'node:crypto'
import { initializeDatabase, SCHEMA_VERSION } from '../db.js'
import { createCashfreeProvider } from '../services/cashfreeProvider.js'
import { initiatePayment, verifyPayment, handlePaymentWebhook, getPaymentStatus } from '../services/payments.js'

const config = { orderingClock, enabled: true, provider: 'cashfree', publicAppUrl: 'https://example.com',
  cashfree: { environment: 'sandbox', clientId: 'synthetic-id', clientSecret: 'synthetic-secret' } }
const cart = { idempotencyKey: 'cashfree-test-1', items: [{ menuItemId: 1, quantity: 2 }], pickupMethod: 'asap' }
function setup(t, overrides = {}) {
  const db = initializeDatabase(':memory:')
  seedStock(db)
  t.after(() => db.close())
  db.prepare(`INSERT INTO users (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES ('cf-student', 'STUDENT', 'Test', '+919000000001', 1, 'ACTIVE')`).run()
  const state = { calls: [], payment: null, orderId: null, ...overrides }
  const provider = createCashfreeProvider(config, async (url, options) => {
    state.calls.push({ url, options })
    if (options.method === 'POST') {
      const body = JSON.parse(options.body)
      assert.equal(body.order_amount, 140)
      assert.equal(body.order_currency, 'INR')
      assert.equal(body.customer_details.customer_phone, '9000000001')
      assert.match(options.headers['x-idempotency-key'], /^[a-f0-9-]{36}$/)
      state.orderId = body.order_id
      return Response.json({ ...body, payment_session_id: 'session_synthetic', ...state.createResponse })
    }
    if (!url.endsWith('/payments')) return Response.json({ order_id: state.orderId, order_amount: 140, order_currency: 'INR', order_status: state.orderStatus || (state.payment?.payment_status === 'SUCCESS' ? 'PAID' : 'ACTIVE') })
    return Response.json(state.payment ? [state.payment] : [])
  })
  return { db, provider, state }
}
function payment(orderId, overrides = {}) {
  return { order_id: orderId, cf_payment_id: '123456789', payment_amount: 140, payment_currency: 'INR', payment_status: 'SUCCESS', ...overrides }
}
function event(orderId, overrides = {}, type = 'PAYMENT_SUCCESS_WEBHOOK') {
  const body = Buffer.from(JSON.stringify({ type, data: { order: { order_id: orderId, order_amount: 140, order_currency: 'INR' }, payment: payment(orderId, overrides) } }))
  const timestamp = '1700000000000'
  return [body, createHmac('sha256', config.cashfree.clientSecret).update(timestamp).update(body).digest('base64'), timestamp]
}
function deliver(db, provider, envelope) {
  return handlePaymentWebhook(db, envelope[0], envelope[1], config, provider, envelope[2])
}
test('Cashfree creates a trusted session once and never exposes server credentials', async (t) => {
  const { db, provider, state } = setup(t)
  const a = await initiatePayment(db, { ...cart, total: 1 }, 1, config, provider)
  const b = await initiatePayment(db, cart, 1, config, provider)
  assert.equal(a.attemptId, b.attemptId)
  assert.equal(state.calls.length, 1)
  assert.equal(a.checkout.mode, 'sandbox')
  assert.equal(a.checkout.paymentSessionId, 'session_synthetic')
  assert.ok(!JSON.stringify(a).includes('synthetic-secret'))
  assert.ok(!JSON.stringify(a).includes('synthetic-id'))
  assert.match(state.calls[0].url, /^https:\/\/sandbox.cashfree.com\/pg\/orders$/)
})
test('Cashfree production is fail-closed without explicit activation approval', () => {
  assert.throws(() => createCashfreeProvider({ ...config, cashfree: { ...config.cashfree, environment: 'production' } }), /approval/)
  assert.throws(() => createCashfreeProvider({ ...config, cashfree: { ...config.cashfree, clientSecret: '' } }), /credentials/)
})
test('Cashfree signature authenticates exact bytes and timestamp; malformed signatures fail closed', () => {
  const provider = createCashfreeProvider(config)
  const [body, signature, timestamp] = event('test_order')
  assert.equal(provider.parseWebhook(body, signature, timestamp).status, 'paid')
  for (const bad of [undefined, '', 'x'.repeat(44), 'é'.repeat(44), [signature]]) {
    assert.throws(() => provider.parseWebhook(body, bad, timestamp), { code: 'webhook_signature_invalid' })
  }
  assert.throws(() => provider.parseWebhook(Buffer.concat([body, Buffer.from(' ')]), signature, timestamp))
  assert.throws(() => provider.parseWebhook(body, signature, '1700000000001'))
})
test('Cashfree duplicate, failed, and out-of-order webhooks create exactly one order', async (t) => {
  const { db, provider } = setup(t)
  const a = await initiatePayment(db, cart, 1, config, provider)
  deliver(db, provider, event(a.attemptId, { payment_status: 'FAILED' }, 'PAYMENT_FAILED_WEBHOOK'))
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 0)
  db.prepare("UPDATE payment_attempts SET status = 'expired'").run()
  deliver(db, provider, event(a.attemptId))
  deliver(db, provider, event(a.attemptId))
  deliver(db, provider, event(a.attemptId, { payment_status: 'FAILED' }, 'PAYMENT_FAILED_WEBHOOK'))
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 1)
  assert.equal((await verifyPayment(db, { attemptId: a.attemptId }, 1, config, provider)).status, 'paid')
})
test('Cashfree wrong amount/currency/order and non-success cannot fulfill', async (t) => {
  const { db, provider, state } = setup(t)
  const a = await initiatePayment(db, cart, 1, config, provider)
  for (const changes of [{ payment_amount: 1 }, { payment_currency: 'USD' }, { order_id: 'wrong' }, { payment_amount: '140' }, { payment_status: 'PENDING' }]) {
    assert.throws(() => deliver(db, provider, event(a.attemptId, changes)))
  }
  for (const status of ['PENDING', 'FAILED', 'USER_DROPPED']) {
    state.payment = payment(a.attemptId, { payment_status: status })
    assert.notEqual((await verifyPayment(db, { attemptId: a.attemptId, success: true }, 1, config, provider)).status, 'paid')
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 0)
})
test('Cashfree backend status recovers delayed success; callbacks cannot override trusted totals', async (t) => {
  const { db, provider, state } = setup(t)
  const a = await initiatePayment(db, cart, 1, config, provider)
  state.payment = payment(a.attemptId)
  const result = await verifyPayment(db, { attemptId: a.attemptId }, 1, config, provider)
  assert.equal(result.status, 'paid')
  deliver(db, provider, event(a.attemptId))
  assert.equal((await getPaymentStatus(db, a.attemptId, 1, config, provider)).order.id, result.order.id)
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 1)
})
test('Cashfree timeout keeps a known provider order for webhook recovery', async (t) => {
  const { db } = setup(t)
  const provider = createCashfreeProvider(config, async () => { throw new Error('synthetic timeout') })
  await assert.rejects(initiatePayment(db, cart, 1, config, provider), { code: 'payment_gateway_timeout' })
  const row = db.prepare('SELECT * FROM payment_attempts').get()
  assert.equal(row.status, 'pending')
  assert.equal(row.provider_order_id, row.public_id)
  deliver(db, provider, event(row.public_id))
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 1)
})
test('Cashfree fulfillment rolls back atomically when order creation fails', async (t) => {
  const { db, provider } = setup(t)
  const a = await initiatePayment(db, cart, 1, config, provider)
  db.exec("CREATE TRIGGER fail_order BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;")
  assert.throws(() => deliver(db, provider, event(a.attemptId)))
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 0)
  assert.equal(db.prepare('SELECT status FROM payment_attempts').get().status, 'initiated')
  db.exec('DROP TRIGGER fail_order;')
  deliver(db, provider, event(a.attemptId))
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 1)
})

test('Cashfree rejects a mismatched creation response without opening checkout', async (t) => {
  const { db, provider } = setup(t, { createResponse: { order_amount: 1 } })
  await assert.rejects(initiatePayment(db, cart, 1, config, provider), { code: 'payment_gateway_mismatch' })
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 0)
})
test('Cashfree polling concurrent with webhook fulfillment preserves exactly one order', async (t) => {
  const { db, provider } = setup(t)
  const a = await initiatePayment(db, cart, 1, config, provider)
  let resolveFetch
  const delayed = { ...provider, fetchProviderStatus: () => new Promise((resolve) => { resolveFetch = resolve }) }
  const checking = getPaymentStatus(db, a.attemptId, 1, config, delayed)
  const envelope = event(a.attemptId)
  deliver(db, provider, envelope)
  resolveFetch(provider.parseWebhook(...envelope))
  assert.equal((await checking).status, 'paid')
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 1)
})
test('Cashfree backend verification rejects wrong trusted amount, currency, and order', async (t) => {
  for (const changes of [{ payment_amount: 1 }, { payment_currency: 'USD' }, { order_id: 'different' }]) {
    const { db, provider, state } = setup(t)
    const a = await initiatePayment(db, cart, 1, config, provider)
    state.payment = payment(a.attemptId, changes)
    if (changes.order_id) assert.equal((await verifyPayment(db, { attemptId: a.attemptId }, 1, config, provider)).status, 'failed')
    else await assert.rejects(verifyPayment(db, { attemptId: a.attemptId }, 1, config, provider), { code: 'payment_gateway_invalid_response' })
    assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 0)
  }
})

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('schema 7 upgrade preserves existing paid records and relationships', (t) => {
  const folder = mkdtempSync(path.join(tmpdir(), 'campusbite-migration-'))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  const file = path.join(folder, 'isolated.db')
  let db = initializeDatabase(file)
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name='payment_attempts'").get().sql
    .replace(/CREATE TABLE "?payment_attempts"?/, 'CREATE TABLE old_attempts')
    .replace(", 'cashfree'", '').replace(/,\s*provider_session_id TEXT/, '')
  db.exec(schema)
  db.exec(`DROP TABLE payment_attempts; ALTER TABLE old_attempts RENAME TO payment_attempts;
    CREATE INDEX idx_payment_attempts_student_created ON payment_attempts(student_user_id, created_at);
    CREATE INDEX idx_payment_attempts_status ON payment_attempts(status, updated_at);
    PRAGMA user_version=7;`)
  db.prepare(`INSERT INTO users (public_id,role,display_name,status) VALUES ('old-student','STUDENT','Old','ACTIVE')`).run()
  db.exec(`INSERT INTO orders (id,token,pickup_method,total_amount) VALUES (1,'old-token','asap',140);
    INSERT INTO payment_attempts (public_id,student_user_id,provider,provider_order_id,amount_paise,currency,
      trusted_cart_json,checkout_details_json,request_fingerprint,idempotency_key,status,provider_payment_id,expires_at,order_id)
    VALUES ('old-attempt',1,'razorpay','order_old',14000,'INR','[]','{}','old-fingerprint','old-key','paid','pay_old','2026-01-01',1);`)
  const before = { ...db.prepare('SELECT * FROM payment_attempts').get() }
  db.close()
  db = initializeDatabase(file)
  try {
    const { provider_session_id, ...after } = db.prepare('SELECT * FROM payment_attempts').get()
    assert.equal(provider_session_id, null)
    assert.deepEqual(after, before)
    assert.equal(db.prepare('SELECT token FROM orders WHERE id=1').get().token, 'old-token')
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION)
  } finally { db.close() }
})

test('Cashfree expired or terminated sessions become terminal only from provider confirmation', async (t) => {
  for (const [orderStatus, expected] of [['EXPIRED', 'expired'], ['TERMINATED', 'cancelled']]) {
    const { db, provider, state } = setup(t)
    const a = await initiatePayment(db, cart, 1, config, provider)
    state.orderStatus = orderStatus
    assert.equal((await getPaymentStatus(db, a.attemptId, 1, config, provider)).status, expected)
    assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 0)
  }
})

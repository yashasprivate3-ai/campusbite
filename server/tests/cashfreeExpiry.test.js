import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initializeDatabase } from '../db.js'
import {
  createCashfreeProvider, cashfreeOrderExpiry, CASHFREE_MIN_EXPIRY_MS, CASHFREE_MAX_EXPIRY_MS,
} from '../services/cashfreeProvider.js'
import { campusDate } from '../../shared/pickupPolicy.js'
import {
  initiatePayment, reconcilePaymentHolds, RELEASE_GRACE_MS, CASHFREE_ATTEMPT_LIFETIME_MINUTES,
} from '../services/payments.js'

// Samosa (item 4, Rs 20, ready now) avoids the rice time-of-day rule.
const SAMOSA = 4
const MINUTE = 60_000
const config = { enabled: true, provider: 'cashfree', publicAppUrl: 'https://example.com',
  cashfree: { environment: 'sandbox', clientId: 'synthetic-id', clientSecret: 'synthetic-secret' } }
const cart = (key) => ({ idempotencyKey: key, items: [{ menuItemId: SAMOSA, quantity: 1 }], pickupMethod: 'asap' })

// Synthetic Cashfree that enforces the real rule: 400 order_expiry_time_invalid
// unless the expiry is more than 15 minutes and less than 30 days away.
function setup(t) {
  const db = initializeDatabase(':memory:')
  t.after(() => db.close())
  const today = campusDate(new Date())
  db.prepare('INSERT INTO daily_menu_stock (service_date, menu_item_id, quantity) VALUES (?, ?, ?)').run(today, SAMOSA, 20)
  const studentId = Number(db.prepare(`INSERT INTO users (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES ('expiry-student', 'STUDENT', 'Test', '+919000000001', 1, 'ACTIVE')`).run().lastInsertRowid)
  const state = { orders: new Map(), creates: [] }
  const provider = createCashfreeProvider(config, async (url, options = {}) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body)
      state.creates.push({ body, at: Date.now() })
      const remaining = new Date(body.order_expiry_time).getTime() - Date.now()
      if (!(remaining > CASHFREE_MIN_EXPIRY_MS && remaining < CASHFREE_MAX_EXPIRY_MS)) {
        return Response.json({ code: 'order_expiry_time_invalid', type: 'invalid_request_error',
          message: 'order_expiry_time : Expiry time should be more than 15 min and less than 30 days' }, { status: 400 })
      }
      state.orders.set(body.order_id, { status: 'ACTIVE', amount: body.order_amount, payments: [] })
      return Response.json({ ...body, payment_session_id: `session_${state.creates.length}` })
    }
    const match = url.match(/\/orders\/([^/]+)(\/payments)?$/)
    const order = state.orders.get(decodeURIComponent(match[1]))
    if (!order) return Response.json({ code: 'order_not_found' }, { status: 404 })
    if (match[2]) return Response.json(order.payments)
    return Response.json({ order_id: decodeURIComponent(match[1]), order_amount: order.amount, order_currency: 'INR', order_status: order.status })
  }, { logger: () => {} })
  const stock = () => ({ ...db.prepare(`SELECT
      (SELECT COALESCE(SUM(quantity), 0) FROM stock_reservations WHERE status = 'held') AS held,
      (SELECT COALESCE(SUM(quantity), 0) FROM stock_reservations WHERE status = 'consumed') AS consumed,
      (SELECT COALESCE(SUM(quantity), 0) FROM stock_reservations WHERE status = 'released') AS released,
      (SELECT COUNT(*) FROM orders) AS orders`).get() })
  const addPayment = (orderId, status, id) => state.orders.get(orderId).payments.push({ order_id: orderId, cf_payment_id: id,
    payment_amount: state.orders.get(orderId).amount, payment_currency: 'INR', payment_status: status })
  const attempt = (attemptId) => db.prepare('SELECT * FROM payment_attempts WHERE public_id = ?').get(attemptId)
  return { db, provider, state, studentId, stock, addPayment, attempt }
}
// Reconcile as if `ms` milliseconds after the attempt's own deadline.
const afterDeadline = (row, ms) => new Date(new Date(row.expires_at).getTime() + ms)

test('Cashfree gets the attempt deadline: 20 minutes, safely above its 15-minute minimum', async (t) => {
  const { db, provider, state, studentId, attempt } = setup(t)
  const before = Date.now()
  const a = await initiatePayment(db, cart('expiry-ok-1'), studentId, config, provider)
  assert.equal(state.creates.length, 1)
  const sent = new Date(state.creates[0].body.order_expiry_time).getTime()
  const local = new Date(attempt(a.attemptId).expires_at).getTime()
  assert.equal(sent, local, 'Cashfree and the local attempt share one absolute deadline')
  assert.equal(CASHFREE_ATTEMPT_LIFETIME_MINUTES, 20)
  assert.ok(sent - before >= 20 * MINUTE - 1000 && sent - before <= 20 * MINUTE + 5000)
  assert.ok(sent - state.creates[0].at > CASHFREE_MIN_EXPIRY_MS + 4 * MINUTE)
  assert.equal(a.status, 'initiated')
  assert.equal(a.checkout.paymentSessionId, 'session_1')
  assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 0)
})

test('an unsafe expiry is refused locally and never sent to Cashfree', async () => {
  const now = Date.parse('2026-10-26T06:30:00Z')
  assert.equal(cashfreeOrderExpiry(new Date(now + 20 * MINUTE).toISOString(), now), new Date(now + 20 * MINUTE).toISOString())
  assert.equal(cashfreeOrderExpiry(new Date(now + 16 * MINUTE), now), new Date(now + 16 * MINUTE).toISOString())
  for (const bad of [undefined, null, '', 'not-a-date', 20, new Date(now + 15 * MINUTE).toISOString(),
    new Date(now + 15 * MINUTE + 30_000).toISOString(), new Date(now - MINUTE).toISOString(),
    new Date(now + 30 * 24 * 60 * MINUTE).toISOString()]) {
    assert.throws(() => cashfreeOrderExpiry(bad, now), { code: 'payment_expiry_unsafe' }, String(bad))
  }
  let calls = 0
  const provider = createCashfreeProvider(config, async () => { calls += 1; return Response.json({}) }, { logger: () => {} })
  for (const expiresAt of [undefined, new Date(Date.now() + 15 * MINUTE).toISOString()]) {
    await assert.rejects(provider.createProviderOrder({ amountPaise: 2000, attemptId: 'pay_00000000-0000-4000-8000-000000000000',
      phoneNumber: '+919000000001', expiresAt }), { code: 'payment_expiry_unsafe', message: 'Payment service rejected the request.' })
  }
  assert.equal(calls, 0)
})

test('Razorpay attempts keep their 15-minute lifetime and receive no Cashfree expiry', async (t) => {
  const { db, studentId } = setup(t)
  const seen = []
  const razorpay = { name: 'razorpay',
    async createProviderOrder(args) { seen.push(args); return { orderId: 'order_synthetic1', amountPaise: args.amountPaise, currency: 'INR', providerCode: 'created', providerMessage: 'ok' } },
    buildSafeCheckoutConfiguration: () => ({ provider: 'razorpay' }) }
  const rzConfig = { enabled: true, provider: 'razorpay', razorpay: { attemptLifetimeMinutes: 15 } }
  const before = Date.now()
  await initiatePayment(db, cart('expiry-rzp-1'), studentId, rzConfig, razorpay)
  const lifetime = new Date(db.prepare('SELECT expires_at FROM payment_attempts').get().expires_at).getTime() - before
  assert.ok(lifetime >= 15 * MINUTE - 1000 && lifetime <= 15 * MINUTE + 5000)
})

test('stock stays held until the shared deadline plus grace, even if Cashfree reports EXPIRED early', async (t) => {
  const { db, provider, state, studentId, stock, attempt } = setup(t)
  const a = await initiatePayment(db, cart('expiry-early-1'), studentId, config, provider)
  state.orders.get(a.attemptId).status = 'EXPIRED'
  for (const ms of [-10 * MINUTE, 0, RELEASE_GRACE_MS - 1000]) {
    assert.equal((await reconcilePaymentHolds(db, config, provider, afterDeadline(attempt(a.attemptId), ms))).checked, 0)
    assert.equal(stock().held, 1)
  }
})

test('after expiry, an in-flight PENDING payment keeps the hold; its late success creates exactly one order', async (t) => {
  const { db, provider, state, studentId, stock, addPayment, attempt } = setup(t)
  const a = await initiatePayment(db, cart('expiry-inflight-1'), studentId, config, provider)
  const order = state.orders.get(a.attemptId)
  order.status = 'EXPIRED'
  addPayment(a.attemptId, 'PENDING', '7001')
  const late = afterDeadline(attempt(a.attemptId), RELEASE_GRACE_MS + MINUTE)
  const summary = await reconcilePaymentHolds(db, config, provider, late)
  assert.deepEqual({ released: summary.released, kept: summary.kept }, { released: 0, kept: 1 })
  assert.deepEqual(stock(), { held: 1, consumed: 0, released: 0, orders: 0 })

  order.payments[0].payment_status = 'SUCCESS'
  order.status = 'PAID'
  assert.equal((await reconcilePaymentHolds(db, config, provider, late)).fulfilled, 1)
  assert.deepEqual(stock(), { held: 0, consumed: 1, released: 0, orders: 1 })
  assert.equal((await reconcilePaymentHolds(db, config, provider, late)).checked, 0)
})

test('a still-ACTIVE Cashfree order keeps the hold; EXPIRED with only failed attempts releases it once', async (t) => {
  const { db, provider, state, studentId, stock, addPayment, attempt } = setup(t)
  const a = await initiatePayment(db, cart('expiry-active-1'), studentId, config, provider)
  const late = afterDeadline(attempt(a.attemptId), RELEASE_GRACE_MS + MINUTE)
  assert.equal((await reconcilePaymentHolds(db, config, provider, late)).kept, 1)
  assert.equal(stock().held, 1)
  addPayment(a.attemptId, 'FAILED', '7002')
  addPayment(a.attemptId, 'USER_DROPPED', '7003')
  assert.equal((await reconcilePaymentHolds(db, config, provider, late)).kept, 1)
  state.orders.get(a.attemptId).status = 'EXPIRED'
  assert.equal((await reconcilePaymentHolds(db, config, provider, late)).released, 1)
  assert.deepEqual(stock(), { held: 0, consumed: 0, released: 1, orders: 0 })
  assert.equal((await reconcilePaymentHolds(db, config, provider, late)).checked, 0)
})

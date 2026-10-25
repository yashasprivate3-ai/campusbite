import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHmac } from 'node:crypto'
import { initializeDatabase } from '../db.js'
import { createCashfreeProvider } from '../services/cashfreeProvider.js'
import { campusDate } from '../../shared/pickupPolicy.js'
import {
  getPaymentStatus, handlePaymentWebhook, initiatePayment, listPaymentReconciliationHolds,
  reconcilePaymentHolds, verifyPayment, RELEASE_GRACE_MS,
} from '../services/payments.js'

// Samosa (item 4, Rs 20, ready now) avoids the rice time-of-day rule, so these
// scenarios run against today's real service date.
const SAMOSA = 4
const secret = 'synthetic-secret'
const config = { enabled: true, provider: 'cashfree', publicAppUrl: 'https://example.com',
  cashfree: { environment: 'sandbox', clientId: 'synthetic-id', clientSecret: secret } }

function setup(t, { stock = 3 } = {}) {
  const db = initializeDatabase(':memory:')
  t.after(() => db.close())
  const today = campusDate(new Date())
  db.prepare('INSERT INTO daily_menu_stock (service_date, menu_item_id, quantity) VALUES (?, ?, ?)').run(today, SAMOSA, stock)
  const studentId = Number(db.prepare(`INSERT INTO users (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES ('life-student', 'STUDENT', 'Test', '+919000000001', 1, 'ACTIVE')`).run().lastInsertRowid)
  // Synthetic Cashfree: no network. `orders` maps provider order id -> { status, payments[], missing }
  const state = { orders: new Map(), fail: false, created: 0 }
  const provider = createCashfreeProvider(config, async (url, options = {}) => {
    if (state.fail) throw new Error('network down')
    if (options.method === 'POST') {
      const body = JSON.parse(options.body)
      state.created += 1
      if (state.rejectCreate) return new Response('{}', { status: 400 })
      state.orders.set(body.order_id, { status: 'ACTIVE', amount: body.order_amount, payments: [] })
      return Response.json({ ...body, payment_session_id: `session_${state.created}` })
    }
    const match = url.match(/\/orders\/([^/]+)(\/payments)?$/)
    const order = state.orders.get(decodeURIComponent(match[1]))
    if (!order) return new Response('{}', { status: 404 })
    if (match[2]) return Response.json(order.payments)
    return Response.json({ order_id: decodeURIComponent(match[1]), order_amount: order.amount, order_currency: 'INR', order_status: order.status })
  })
  const pay = (orderId, status, id = '9001') => {
    const order = state.orders.get(orderId)
    order.payments.push({ order_id: orderId, cf_payment_id: id, payment_amount: order.amount, payment_currency: 'INR', payment_status: status })
    if (status === 'SUCCESS') order.status = 'PAID'
  }
  return { db, provider, state, studentId, pay, today }
}

const cart = (key, quantity = 1) => ({ idempotencyKey: key, items: [{ menuItemId: SAMOSA, quantity }], pickupMethod: 'asap' })
const reservations = (db) => db.prepare('SELECT status, count(*) AS n, sum(quantity) AS q FROM stock_reservations GROUP BY status ORDER BY status').all().map(r => ({ ...r }))
const orders = (db) => db.prepare('SELECT count(*) AS n FROM orders').get().n
const expireLocally = (db, attemptId) => db.prepare('UPDATE payment_attempts SET expires_at = ? WHERE public_id = ?')
  .run(new Date(Date.now() - RELEASE_GRACE_MS - 60_000).toISOString(), attemptId)
function webhook(db, provider, orderId, amount = 20, paymentId = '9001') {
  const body = Buffer.from(JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: {
    order: { order_id: orderId, order_amount: amount, order_currency: 'INR' },
    payment: { order_id: orderId, cf_payment_id: paymentId, payment_amount: amount, payment_currency: 'INR', payment_status: 'SUCCESS' } } }))
  const ts = String(Date.now())
  return handlePaymentWebhook(db, body, createHmac('sha256', secret).update(ts).update(body).digest('base64'), config, provider, ts)
}

test('successful payment consumes the held stock and creates exactly one order', async (t) => {
  const { db, provider, studentId, pay } = setup(t)
  const a = await initiatePayment(db, cart('life-success-1'), studentId, config, provider)
  assert.deepEqual(reservations(db), [{ status: 'held', n: 1, q: 1 }])
  pay(a.attemptId, 'SUCCESS')
  assert.equal((await verifyPayment(db, { attemptId: a.attemptId }, studentId, config, provider)).status, 'paid')
  webhook(db, provider, a.attemptId)
  assert.equal(orders(db), 1)
  assert.deepEqual(reservations(db), [{ status: 'consumed', n: 1, q: 1 }])
})

test('a FAILED Cashfree payment keeps the order payable: attempt stays pending and stock stays held', async (t) => {
  const { db, provider, studentId, pay } = setup(t)
  const a = await initiatePayment(db, cart('life-failed-1'), studentId, config, provider)
  pay(a.attemptId, 'FAILED', '9002')
  const result = await verifyPayment(db, { attemptId: a.attemptId }, studentId, config, provider)
  assert.equal(result.status, 'pending')
  assert.equal(result.responseCode, 'FAILED')
  assert.deepEqual(reservations(db), [{ status: 'held', n: 1, q: 1 }])
  // The student retries inside the same Cashfree order and succeeds.
  pay(a.attemptId, 'SUCCESS', '9003')
  assert.equal((await verifyPayment(db, { attemptId: a.attemptId }, studentId, config, provider)).status, 'paid')
  assert.equal(orders(db), 1)
  assert.deepEqual(reservations(db), [{ status: 'consumed', n: 1, q: 1 }])
})

test('closing the pop-up (no payment yet) never releases stock', async (t) => {
  const { db, provider, studentId } = setup(t)
  const a = await initiatePayment(db, cart('life-dismiss-1'), studentId, config, provider)
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await verifyPayment(db, { attemptId: a.attemptId }, studentId, config, provider)).status, 'initiated')
    assert.equal((await getPaymentStatus(db, a.attemptId, studentId, config, provider)).status, 'initiated')
  }
  assert.deepEqual(reservations(db), [{ status: 'held', n: 1, q: 1 }])
})

test('cancelled (TERMINATED) and expired (EXPIRED) orders release stock idempotently and make it orderable again', async (t) => {
  for (const [providerStatus, expected] of [['TERMINATED', 'cancelled'], ['EXPIRED', 'expired']]) {
    const { db, provider, state, studentId } = setup(t, { stock: 1 })
    const a = await initiatePayment(db, cart(`life-end-${expected}`), studentId, config, provider)
    await assert.rejects(initiatePayment(db, cart(`life-end-${expected}-2`), studentId, config, provider), { code: 'item_unavailable' })
    state.orders.get(a.attemptId).status = providerStatus
    assert.equal((await getPaymentStatus(db, a.attemptId, studentId, config, provider)).status, expected)
    assert.equal((await getPaymentStatus(db, a.attemptId, studentId, config, provider)).status, expected)
    assert.deepEqual(reservations(db), [{ status: 'released', n: 1, q: 1 }])
    assert.equal(db.prepare("SELECT count(*) AS n FROM auth_events WHERE event_type = 'STOCK_RESERVATION_RELEASED'").get().n, 1)
    assert.ok(db.prepare('SELECT released_at FROM stock_reservations').get().released_at)
    const again = await initiatePayment(db, cart(`life-end-${expected}-3`), studentId, config, provider)
    assert.equal(again.status, 'initiated')
    assert.equal(orders(db), 0)
  }
})

test('reconciliation sweep: waits for local expiry, keeps payable or uncertain orders, then releases once', async (t) => {
  const { db, provider, state, studentId } = setup(t)
  const a = await initiatePayment(db, cart('life-sweep-1'), studentId, config, provider)
  let summary = await reconcilePaymentHolds(db, config, provider)
  assert.equal(summary.checked, 0) // still inside the checkout window: provider is not even asked
  expireLocally(db, a.attemptId)
  summary = await reconcilePaymentHolds(db, config, provider)
  assert.deepEqual([summary.checked, summary.kept, summary.released], [1, 1, 0]) // Cashfree order still ACTIVE
  state.fail = true
  summary = await reconcilePaymentHolds(db, config, provider)
  assert.deepEqual([summary.deferred, summary.released], [1, 0]) // provider outage keeps the hold
  assert.deepEqual(reservations(db), [{ status: 'held', n: 1, q: 1 }])
  state.fail = false
  state.orders.get(a.attemptId).status = 'EXPIRED'
  summary = await reconcilePaymentHolds(db, config, provider)
  assert.equal(summary.released, 1)
  summary = await reconcilePaymentHolds(db, config, provider)
  assert.equal(summary.checked, 0) // nothing left to do: idempotent
  assert.deepEqual(reservations(db), [{ status: 'released', n: 1, q: 1 }])
  assert.equal(listPaymentReconciliationHolds(db).holds.length, 0)
})

test('reconciliation fulfils a late success it finds after the browser was lost', async (t) => {
  const { db, provider, studentId, pay } = setup(t)
  const a = await initiatePayment(db, cart('life-late-1'), studentId, config, provider)
  pay(a.attemptId, 'SUCCESS', '9010')
  expireLocally(db, a.attemptId)
  const summary = await reconcilePaymentHolds(db, config, provider)
  assert.equal(summary.fulfilled, 1)
  assert.equal(orders(db), 1)
  assert.deepEqual(reservations(db), [{ status: 'consumed', n: 1, q: 1 }])
  webhook(db, provider, a.attemptId, 20, '9010')
  assert.equal(orders(db), 1)
})

test('a provider order that was never created is released only after expiry, never while it may still exist', async (t) => {
  const { db, provider, state, studentId } = setup(t)
  state.rejectCreate = true
  await assert.rejects(initiatePayment(db, cart('life-norder-1'), studentId, config, provider), { code: 'payment_gateway_rejected' })
  assert.deepEqual(reservations(db), [{ status: 'held', n: 1, q: 1 }])
  assert.equal((await reconcilePaymentHolds(db, config, provider)).checked, 0)
  db.prepare('UPDATE payment_attempts SET expires_at = ?').run(new Date(Date.now() - RELEASE_GRACE_MS - 60_000).toISOString())
  assert.equal((await reconcilePaymentHolds(db, config, provider)).released, 1)
  assert.deepEqual(reservations(db), [{ status: 'released', n: 1, q: 1 }])
  assert.equal(db.prepare('SELECT status FROM payment_attempts').get().status, 'failed')
})

test('a delayed webhook after release re-reserves available stock and creates exactly one correct order', async (t) => {
  const { db, provider, state, studentId } = setup(t, { stock: 2 })
  const a = await initiatePayment(db, cart('life-delayed-1'), studentId, config, provider)
  state.orders.get(a.attemptId).status = 'EXPIRED'
  await getPaymentStatus(db, a.attemptId, studentId, config, provider)
  assert.deepEqual(reservations(db), [{ status: 'released', n: 1, q: 1 }])
  webhook(db, provider, a.attemptId, 20, '9020')
  webhook(db, provider, a.attemptId, 20, '9020')
  assert.equal(orders(db), 1)
  assert.equal(db.prepare('SELECT status FROM payment_attempts').get().status, 'paid')
  assert.deepEqual(reservations(db), [{ status: 'consumed', n: 1, q: 1 }])
  assert.equal(db.prepare('SELECT total_amount FROM orders').get().total_amount, 2000)
})

test('a delayed webhook after release never oversells: it records the captured payment for an owner refund', async (t) => {
  const { db, provider, state, studentId, pay } = setup(t, { stock: 1 })
  const a = await initiatePayment(db, cart('life-oversell-1'), studentId, config, provider)
  state.orders.get(a.attemptId).status = 'EXPIRED'
  await getPaymentStatus(db, a.attemptId, studentId, config, provider)
  // Someone else buys the last Samosa.
  const b = await initiatePayment(db, cart('life-oversell-2'), studentId, config, provider)
  pay(b.attemptId, 'SUCCESS', '9031')
  await verifyPayment(db, { attemptId: b.attemptId }, studentId, config, provider)
  // The first order's payment arrives late.
  webhook(db, provider, a.attemptId, 20, '9030')
  webhook(db, provider, a.attemptId, 20, '9030') // duplicate is a no-op
  assert.equal(orders(db), 1)
  const first = db.prepare('SELECT status, order_id, response_code, provider_payment_id FROM payment_attempts WHERE public_id = ?').get(a.attemptId)
  assert.deepEqual({ ...first }, { status: 'expired', order_id: null, response_code: 'captured_unfulfilled', provider_payment_id: '9030' })
  const report = listPaymentReconciliationHolds(db)
  assert.equal(report.capturedUnfulfilled.length, 1)
  assert.equal(report.capturedUnfulfilled[0].attemptId, a.attemptId)
  assert.equal(db.prepare("SELECT sum(quantity) AS q FROM stock_reservations WHERE status IN ('held', 'consumed')").get().q, 1)
})

test('retried checkout with the same request reuses one attempt and one reservation', async (t) => {
  const { db, provider, state, studentId } = setup(t)
  const first = await initiatePayment(db, cart('life-retry-1'), studentId, config, provider)
  const second = await initiatePayment(db, cart('life-retry-1'), studentId, config, provider)
  assert.equal(second.attemptId, first.attemptId)
  assert.equal(second.reused, true)
  assert.equal(state.created, 1)
  assert.deepEqual(reservations(db), [{ status: 'held', n: 1, q: 1 }])
})

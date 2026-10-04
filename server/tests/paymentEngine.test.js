import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { initializeDatabase } from '../db.js'
import { buildTrustedCartSnapshot } from '../data/menu.js'
import { createHmac } from 'node:crypto'
import { Readable } from 'node:stream'
import { handlePaymentRoutes } from '../routes/payments.js'
import { readRawBody } from '../services/http.js'
import {
  getPaymentStatus,
  handlePaymentWebhook,
  initiatePayment,
  verifyPayment,
} from '../services/payments.js'
import { createRazorpayProvider } from '../services/razorpayProvider.js'

const databases = []
const paymentConfig = {
  enabled: true,
  provider: 'razorpay',
  razorpay: { attemptLifetimeMinutes: 15 },
}

function createDatabase() {
  const database = initializeDatabase(':memory:')
  databases.push(database)
  database.prepare(`INSERT INTO users
    (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES (?, 'STUDENT', ?, ?, 1, 'ACTIVE')`).run('student-one', 'Student One', '+919000000001')
  database.prepare(`INSERT INTO users
    (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES (?, 'STUDENT', ?, ?, 1, 'ACTIVE')`).run('student-two', 'Student Two', '+919000000002')
  return database
}

afterEach(() => {
  while (databases.length) databases.pop().close()
})

const webhookSecret = 'synthetic-webhook-secret'
function webhookGateway(secret = webhookSecret) {
  return createRazorpayProvider({ ...paymentConfig, razorpay: {
    keyId: 'rzp_test_synthetic', keySecret: 'different-synthetic-api-secret', webhookSecret: secret,
  } }, () => { throw new Error('Webhook must not make network requests.') })
}

function signedEvent(overrides = {}, eventType = 'payment.captured') {
  const body = Buffer.from(JSON.stringify({ event: eventType, payload: { payment: { entity: {
    id: 'pay_TestPayment1', order_id: 'order_TestOrder1', amount: 14000,
    currency: 'INR', status: 'captured', captured: true, ...overrides,
  } } } }))
  return [body, createHmac('sha256', webhookSecret).update(body).digest('hex')]
}

test('webhook checks exact raw bytes, dedicated secret, malformed signatures and JSON', () => {
  const gateway = webhookGateway()
  const [body, signature] = signedEvent()
  assert.equal(gateway.parseWebhook(body, signature).paymentId, 'pay_TestPayment1')
  for (const invalid of [undefined, '', '0'.repeat(64), ['a'.repeat(64)], 'z'.repeat(64)]) {
    assert.throws(() => gateway.parseWebhook(body, invalid), { code: 'webhook_signature_invalid' })
  }
  assert.throws(() => gateway.parseWebhook(Buffer.concat([body, Buffer.from(' ')]), signature), { code: 'webhook_signature_invalid' })
  assert.throws(() => webhookGateway('').parseWebhook(body, signature), { code: 'webhook_unavailable' })
  const malformed = Buffer.from('{')
  assert.throws(() => gateway.parseWebhook(malformed, createHmac('sha256', webhookSecret).update(malformed).digest('hex')), { code: 'invalid_webhook' })
})

test('duplicate and out-of-order webhooks recover terminal attempts with exactly one order', async () => {
  for (const status of ['initiated', 'failed', 'cancelled', 'expired']) {
    const database = createDatabase()
    const attempt = await initiatePayment(database, payload(), 1, paymentConfig, provider())
    database.prepare('UPDATE payment_attempts SET status = ?').run(status)
    const deliver = (event) => handlePaymentWebhook(database, ...event, paymentConfig, webhookGateway())
    deliver(signedEvent({}, 'payment.failed'))
    assert.equal(database.prepare('SELECT count(*) AS n FROM orders').get().n, 0)
    deliver(signedEvent())
    deliver(signedEvent())
    deliver(signedEvent({}, 'order.paid'))
    deliver(signedEvent({}, 'payment.authorized'))
    const result = await getPaymentStatus(database, attempt.attemptId, 1, paymentConfig, provider())
    assert.equal(result.status, 'paid')
    assert.equal(database.prepare('SELECT count(*) AS n FROM orders').get().n, 1)
    const repeated = await verifyPayment(database, { attemptId: attempt.attemptId }, 1, paymentConfig, provider())
    assert.equal(repeated.order.id, result.order.id)
  }
})

test('webhook rejects mismatches and noncaptured payloads without changing the attempt', async () => {
  const database = createDatabase()
  await initiatePayment(database, payload(), 1, paymentConfig, provider())
  for (const overrides of [{ amount: 1 }, { amount: '14000' }, { currency: 'USD' },
    { captured: false }, { status: 'authorized' }, { id: 'invalid' }]) {
    assert.throws(() => handlePaymentWebhook(database, ...signedEvent(overrides), paymentConfig, webhookGateway()))
  }
  handlePaymentWebhook(database, ...signedEvent({ order_id: 'order_Unrelated1' }), paymentConfig, webhookGateway())
  assert.equal(database.prepare('SELECT status FROM payment_attempts').get().status, 'initiated')
  assert.equal(database.prepare('SELECT count(*) AS n FROM orders').get().n, 0)
  handlePaymentWebhook(database, ...signedEvent(), paymentConfig, webhookGateway())
  assert.throws(() => handlePaymentWebhook(database, ...signedEvent({ id: 'pay_Different1' }), paymentConfig, webhookGateway()), { code: 'webhook_payment_mismatch' })
  assert.equal(database.prepare('SELECT count(*) AS n FROM orders').get().n, 1)
})

test('webhook cannot reuse a payment linked to another attempt and rolls back failed fulfillment', async () => {
  const database = createDatabase()
  const gateway = provider()
  await initiatePayment(database, payload(), 1, paymentConfig, gateway)
  await initiatePayment(database, payload('request-0002'), 1, paymentConfig, gateway)
  database.exec("CREATE TRIGGER fail_order BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;")
  assert.throws(() => handlePaymentWebhook(database, ...signedEvent(), paymentConfig, webhookGateway()))
  assert.equal(database.prepare('SELECT count(*) AS n FROM orders').get().n, 0)
  database.exec('DROP TRIGGER fail_order;')
  handlePaymentWebhook(database, ...signedEvent(), paymentConfig, webhookGateway())
  assert.throws(() => handlePaymentWebhook(database, ...signedEvent({ order_id: 'order_TestOrder2' }), paymentConfig, webhookGateway()), { code: 'webhook_payment_mismatch' })
  assert.equal(database.prepare('SELECT count(*) AS n FROM orders').get().n, 1)
})

test('webhook overlapping checkout and polling fulfillment still creates exactly one order', async () => {
  for (const path of ['checkout', 'polling']) {
    const database = createDatabase()
    const base = provider()
    const attempt = await initiatePayment(database, payload(), 1, paymentConfig, base)
    let finishFetch
    const gateway = { ...base,
      fetchPayment: () => new Promise((resolve) => { finishFetch = resolve }),
      fetchProviderStatus: () => new Promise((resolve) => { finishFetch = resolve }),
    }
    const pending = path === 'checkout'
      ? verifyPayment(database, { attemptId: attempt.attemptId, razorpay_order_id: attempt.checkout.orderId,
        razorpay_payment_id: 'pay_TestPayment1', razorpay_signature: 'a'.repeat(64) }, 1, paymentConfig, gateway)
      : getPaymentStatus(database, attempt.attemptId, 1, paymentConfig, gateway)
    handlePaymentWebhook(database, ...signedEvent(), paymentConfig, webhookGateway())
    finishFetch(await base.fetchPayment())
    assert.equal((await pending).status, 'paid')
    handlePaymentWebhook(database, ...signedEvent(), paymentConfig, webhookGateway())
    assert.equal(database.prepare('SELECT count(*) AS n FROM orders').get().n, 1)
  }
})

test('public webhook route accepts signed bytes without student auth and limits body size', async () => {
  const database = createDatabase()
  await initiatePayment(database, payload(), 1, paymentConfig, provider())
  const [body, signature] = signedEvent()
  const request = Readable.from([body.subarray(0, 30), body.subarray(30)])
  request.method = 'POST'
  request.headers = { 'x-razorpay-signature': signature }
  let result
  const response = { writeHead(status) { assert.equal(status, 200) }, end(value) { result = JSON.parse(value) } }
  assert.equal(await handlePaymentRoutes(request, response, new URL('http://localhost/api/payments/webhook/razorpay'), database, {}, paymentConfig, webhookGateway()), true)
  assert.deepEqual(result, { received: true })
  await assert.rejects(readRawBody(Readable.from([Buffer.alloc(65537)])), { statusCode: 413 })
  let methodStatus
  await handlePaymentRoutes({ method: 'GET' }, { setHeader() {}, writeHead(status) { methodStatus = status }, end() {} },
    new URL('http://localhost/api/payments/webhook/razorpay'), database, {}, paymentConfig, webhookGateway())
  assert.equal(methodStatus, 405)
})

function payload(idempotencyKey = 'request-0001') {
  return {
    idempotencyKey,
    items: [{ menuItemId: 1, quantity: 2 }],
    pickupMethod: 'asap',
    pickupSlot: null,
    instructions: '',
  }
}

function provider(overrides = {}) {
  let orderCount = 0
  return {
    async createProviderOrder({ amountPaise }) {
      orderCount += 1
      return {
        amountPaise,
        currency: 'INR',
        orderId: `order_TestOrder${orderCount}`,
        providerCode: 'created',
        providerMessage: 'Created.',
      }
    },
    buildSafeCheckoutConfiguration({ amountPaise, orderId }) {
      return { amount: amountPaise, currency: 'INR', keyId: 'rzp_test_example', orderId }
    },
    verifyCheckoutResult: () => true,
    async fetchPayment() {
      return {
        amountPaise: 14000,
        captured: true,
        currency: 'INR',
        orderId: 'order_TestOrder1',
        paymentId: 'pay_TestPayment1',
        providerCode: 'captured',
        providerMessage: 'Captured.',
        status: 'paid',
      }
    },
    async fetchProviderStatus() { return null },
    ...overrides,
  }
}

test('trusted cart computes integer-paise totals and rejects tampering', () => {
  assert.equal(buildTrustedCartSnapshot([{ menuItemId: 1, quantity: 2 }]).totalPaise, 14000)
  assert.throws(() => buildTrustedCartSnapshot([{ menuItemId: 999, quantity: 1 }]))
  assert.throws(() => buildTrustedCartSnapshot([{ menuItemId: 1, quantity: 0 }]))
  assert.throws(() => buildTrustedCartSnapshot([{ menuItemId: 1, quantity: 1, price: 1 }]))
})

test('initiation is idempotent and conflicting reuse is rejected', async () => {
  const database = createDatabase()
  const gateway = provider()
  const first = await initiatePayment(database, payload(), 1, paymentConfig, gateway)
  const second = await initiatePayment(database, payload(), 1, paymentConfig, gateway)
  assert.equal(first.attemptId, second.attemptId)
  assert.equal(second.reused, true)
  await assert.rejects(
    initiatePayment(database, { ...payload(), items: [{ menuItemId: 2, quantity: 1 }] }, 1, paymentConfig, gateway),
    (error) => error.code === 'payment_idempotency_conflict',
  )
})

test('captured verification creates exactly one order and repeated verification is idempotent', async () => {
  const database = createDatabase()
  const gateway = provider()
  const attempt = await initiatePayment(database, payload(), 1, paymentConfig, gateway)
  const checkout = {
    attemptId: attempt.attemptId,
    razorpay_order_id: attempt.checkout.orderId,
    razorpay_payment_id: 'pay_TestPayment1',
    razorpay_signature: 'a'.repeat(64),
  }
  const paid = await verifyPayment(database, checkout, 1, paymentConfig, gateway)
  const repeated = await verifyPayment(database, checkout, 1, paymentConfig, gateway)
  assert.equal(paid.status, 'paid')
  assert.equal(paid.order.id, repeated.order.id)
  assert.equal(database.prepare('SELECT count(*) AS count FROM orders').get().count, 1)
})

test('ownership and invalid signatures are rejected without creating orders', async () => {
  const database = createDatabase()
  const gateway = provider({ verifyCheckoutResult: () => false })
  const attempt = await initiatePayment(database, payload(), 1, paymentConfig, gateway)
  const checkout = {
    attemptId: attempt.attemptId,
    razorpay_order_id: attempt.checkout.orderId,
    razorpay_payment_id: 'pay_TestPayment1',
    razorpay_signature: 'b'.repeat(64),
  }
  await assert.rejects(verifyPayment(database, checkout, 2, paymentConfig, gateway), (error) => error.statusCode === 404)
  await assert.rejects(verifyPayment(database, checkout, 1, paymentConfig, gateway), (error) => error.code === 'payment_signature_invalid')
  assert.equal(database.prepare('SELECT count(*) AS count FROM orders').get().count, 0)
})

test('pending recovery creates no order; captured recovery creates one', async () => {
  const database = createDatabase()
  let recoveredPayment = null
  const gateway = provider({ async fetchProviderStatus() { return recoveredPayment } })
  const attempt = await initiatePayment(database, payload(), 1, paymentConfig, gateway)
  const pending = await getPaymentStatus(database, attempt.attemptId, 1, paymentConfig, gateway)
  assert.equal(pending.order, null)
  recoveredPayment = {
    amountPaise: 14000,
    captured: true,
    currency: 'INR',
    orderId: attempt.checkout.orderId,
    paymentId: 'pay_RecoveryPayment1',
    providerCode: 'captured',
    providerMessage: 'Captured.',
    status: 'paid',
  }
  const paid = await getPaymentStatus(database, attempt.attemptId, 1, paymentConfig, gateway)
  const repeated = await getPaymentStatus(database, attempt.attemptId, 1, paymentConfig, gateway)
  assert.equal(paid.order.id, repeated.order.id)
  assert.equal(database.prepare('SELECT count(*) AS count FROM orders').get().count, 1)
})

test('mismatched amount, currency, or provider order never creates an order', async () => {
  for (const mismatch of ['amount', 'currency', 'order']) {
    const database = createDatabase()
    const base = provider()
    const attempt = await initiatePayment(database, payload(`request-${mismatch}`), 1, paymentConfig, base)
    const payment = {
      amountPaise: mismatch === 'amount' ? 1 : 14000,
      captured: true,
      currency: mismatch === 'currency' ? 'USD' : 'INR',
      orderId: mismatch === 'order' ? 'order_DifferentOrder1' : attempt.checkout.orderId,
      paymentId: `pay_Mismatch${mismatch}1`,
      providerCode: 'captured',
      providerMessage: 'Captured.',
      status: 'paid',
    }
    const gateway = { ...base, async fetchProviderStatus() { return payment } }
    const result = await getPaymentStatus(database, attempt.attemptId, 1, paymentConfig, gateway)
    assert.equal(result.order, null)
    assert.equal(result.status, 'failed')
    assert.equal(database.prepare('SELECT count(*) AS count FROM orders').get().count, 0)
    database.close()
    databases.splice(databases.indexOf(database), 1)
  }
})

test('Razorpay adapter verifies HMAC and normalizes captured payment safely', async () => {
  const keySecret = 'x'.repeat(32)
  const expectedOrderId = 'order_SyntheticOrder1'
  const paymentId = 'pay_SyntheticPayment1'
  const signature = createHmac('sha256', keySecret)
    .update(`${expectedOrderId}|${paymentId}`)
    .digest('hex')
  const responseBody = JSON.stringify({
    id: paymentId,
    order_id: expectedOrderId,
    amount: 14000,
    currency: 'INR',
    status: 'captured',
    captured: true,
  })
  const razorpay = createRazorpayProvider({
    enabled: true,
    provider: 'razorpay',
    razorpay: {
      apiHost: 'https://api.razorpay.com',
      keyId: 'rzp_test_synthetic',
      keySecret,
      requestTimeoutMilliseconds: 1000,
    },
  }, async () => new Response(responseBody, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
  assert.equal(razorpay.verifyCheckoutResult({ expectedOrderId, paymentId, returnedOrderId: expectedOrderId, signature }), true)
  assert.equal(razorpay.verifyCheckoutResult({ expectedOrderId, paymentId, returnedOrderId: expectedOrderId, signature: '0'.repeat(64) }), false)
  const payment = await razorpay.fetchPayment(paymentId)
  assert.equal(payment.status, 'paid')
  assert.equal(payment.captured, true)
  assert.equal(payment.amountPaise, 14000)
})

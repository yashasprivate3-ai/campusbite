import { createHmac, timingSafeEqual } from 'node:crypto'
import { ApiError } from './apiError.js'
import { PaymentProviderError } from './razorpayProvider.js'

const invalid = () => new PaymentProviderError('payment_gateway_invalid_response', 'The payment service returned an invalid response.')
function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw invalid()
  return value
}
function paise(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw invalid()
  return Math.round(value * 100)
}
export function createCashfreeProvider(config, fetchImplementation = fetch) {
  if (!config?.enabled || config.provider !== 'cashfree') return null
  const settings = config.cashfree
  if (!['sandbox', 'production'].includes(settings.environment) ||
      (settings.environment === 'production' && !settings.livePaymentsApproved)) {
    throw new Error('Cashfree production requires explicit live-payment approval.')
  }
  if (!settings.clientId || !settings.clientSecret) throw new Error('Cashfree server credentials are required.')
  const origin = settings.environment === 'sandbox' ? 'https://sandbox.cashfree.com' : 'https://api.cashfree.com'
  async function request(path, options = {}) {
    let response
    try {
      response = await fetchImplementation(`${origin}/pg${path}`, {
        ...options, redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'x-api-version': '2025-01-01',
          'x-client-id': settings.clientId, 'x-client-secret': settings.clientSecret, ...options.headers },
        signal: AbortSignal.timeout(10000),
      })
    } catch {
      throw new PaymentProviderError('payment_gateway_timeout', 'Payment service unavailable. Check payment status before retrying.')
    }
    if (response.status === 404) throw new PaymentProviderError('payment_order_not_found', 'The payment order was not found.')
    if (!response.ok) throw new PaymentProviderError('payment_gateway_rejected', 'Payment service rejected the request.')
    const text = await response.text()
    if (text.length > 65536) throw invalid()
    try { return JSON.parse(text) } catch { throw invalid() }
  }
  function normalize(payment, orderId) {
    if (!payment || typeof payment !== 'object') throw invalid()
    const success = payment.payment_status === 'SUCCESS'
    return { orderId: id(payment.order_id || orderId), paymentId: id(String(payment.cf_payment_id || '')),
      amountPaise: paise(payment.payment_amount), currency: payment.payment_currency,
      captured: success, status: success ? 'paid' : 'pending',
      providerCode: String(payment.payment_status || 'PENDING').slice(0, 40),
      providerMessage: success ? 'Payment confirmed.' : payment.payment_status === 'FAILED'
        ? 'The payment failed. You can retry checkout; no order was created.'
        : payment.payment_status === 'USER_DROPPED' ? 'Checkout was cancelled. No order was created.' : 'Payment is pending.' }
  }
  return Object.freeze({
    name: 'cashfree',
    async createProviderOrder({ amountPaise, attemptId, phoneNumber }) {
      if (!/^\+91[6-9]\d{9}$/.test(phoneNumber || '')) throw invalid()
      const order = await request('/orders', { method: 'POST',
        headers: { 'x-idempotency-key': attemptId.replace(/^pay_/, '') },
        body: JSON.stringify({ order_id: id(attemptId), order_amount: amountPaise / 100, order_currency: 'INR',
          customer_details: { customer_id: attemptId, customer_phone: phoneNumber.slice(3) },
          order_expiry_time: new Date(Date.now() + 15 * 60000).toISOString(),
          order_meta: { return_url: `${config.publicAppUrl}/?payment_return=1` } }),
      })
      if (order.order_id !== attemptId || typeof order.payment_session_id !== 'string' || !order.payment_session_id) throw invalid()
      return { orderId: id(order.order_id), amountPaise: paise(order.order_amount), currency: order.order_currency,
        sessionId: order.payment_session_id, providerCode: 'ACTIVE', providerMessage: 'Payment session created.' }
    },
    async fetchProviderStatus(orderId) {
      const order = await request(`/orders/${encodeURIComponent(id(orderId))}`)
      if (!order || order.order_id !== orderId) throw invalid()
      const payments = await request(`/orders/${encodeURIComponent(id(orderId))}/payments`)
      if (!Array.isArray(payments)) throw invalid()
      const success = payments.find((payment) => payment.payment_status === 'SUCCESS')
      if (success) {
        const result = normalize(success, orderId)
        if (order.order_status !== 'PAID' || paise(order.order_amount) !== result.amountPaise || order.order_currency !== result.currency) throw invalid()
        return result
      }
      if (['EXPIRED', 'TERMINATED'].includes(order.order_status)) {
        return { orderId, amountPaise: paise(order.order_amount), currency: order.order_currency,
          paymentId: null, captured: false, status: order.order_status === 'EXPIRED' ? 'expired' : 'cancelled',
          providerCode: order.order_status, providerMessage: 'The payment session ended without a confirmed payment.' }
      }
      // A failed/dropped payment is not a terminal provider order: a later retry may succeed.
      const latest = payments.at(-1)
      return latest ? normalize(latest, orderId) : null
    },
    parseWebhook(rawBody, signature, timestamp) {
      if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(signature) || typeof timestamp !== 'string' || !/^\d{10,16}$/.test(timestamp)) {
        throw new ApiError(400, 'webhook_signature_invalid', 'Webhook verification failed.')
      }
      const expected = createHmac('sha256', settings.clientSecret).update(timestamp).update(rawBody).digest('base64')
      if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        throw new ApiError(400, 'webhook_signature_invalid', 'Webhook verification failed.')
      }
      let event
      try { event = JSON.parse(rawBody.toString('utf8')) } catch { throw invalid() }
      if (event?.type !== 'PAYMENT_SUCCESS_WEBHOOK') return null
      if (event.data?.payment?.payment_status !== 'SUCCESS') throw invalid()
      const result = normalize(event.data.payment, event.data?.order?.order_id)
      if (result.orderId !== event.data.order.order_id || paise(event.data.order.order_amount) !== result.amountPaise || event.data.order.order_currency !== result.currency) throw invalid()
      return result
    },
    buildSafeCheckoutConfiguration({ sessionId }) {
      if (typeof sessionId !== 'string' || !sessionId) throw invalid()
      return { provider: 'cashfree', paymentSessionId: sessionId, mode: settings.environment }
    },
  })
}

import { createHmac, timingSafeEqual } from 'node:crypto'
import { ApiError } from './apiError.js'
import { PaymentProviderError } from './razorpayProvider.js'

const invalid = () => new PaymentProviderError('payment_gateway_invalid_response', 'The payment service returned an invalid response.')
function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw invalid()
  return value
}
// Cashfree documents customer_id as alphanumeric only (3-50 characters), unlike
// order_id which also allows '_' and '-'. Derive it deterministically from the
// payment attempt so retries of the same attempt always send the same value.
export function cashfreeCustomerId(attemptId) {
  const value = `cust${String(attemptId ?? '').replace(/[^A-Za-z0-9]/g, '')}`
  if (!/^[A-Za-z0-9]{3,50}$/.test(value) || value === 'cust') throw invalid()
  return value
}

const SAFE_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/
function safeText(value, max = 200) {
  if (typeof value !== 'string') return null
  const cleaned = value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\+?\d[\d\s-]{4,}\d/g, '[number]')
    .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? cleaned.slice(0, max) : null
}

// Only the HTTP status and Cashfree's own error code, type and validation message
// are kept, each sanitized and length-limited. Request headers, credentials,
// request bodies and anything that looks like a phone number, email or token
// never reach the diagnostic.
export function sanitizeCashfreeError(httpStatus, text) {
  let body
  try { body = JSON.parse(String(text ?? '').slice(0, 4096)) } catch { body = null }
  const token = (value) => (typeof value === 'string' && SAFE_TOKEN.test(value) && !/[A-Za-z0-9]{24,}/.test(value) ? value : null)
  return {
    httpStatus: Number.isInteger(httpStatus) ? httpStatus : null,
    code: token(body?.code),
    type: token(body?.type),
    message: safeText(body?.message),
  }
}

function operationFor(path, method) {
  if (method === 'POST' && path === '/orders') return 'create_order'
  if (/\/payments$/.test(path)) return 'get_order_payments'
  return 'get_order'
}

const defaultLogger = (line) => console.warn(line)

// Cashfree rejects order_expiry_time unless it is more than 15 minutes and
// less than 30 days away (code order_expiry_time_invalid). The caller passes
// the payment attempt's absolute deadline so the local attempt and the
// Cashfree order expire together; anything not safely inside the window is
// refused here, before any request is sent.
export const CASHFREE_MIN_EXPIRY_MS = 15 * 60_000
export const CASHFREE_MAX_EXPIRY_MS = 30 * 24 * 60 * 60_000
export const CASHFREE_EXPIRY_MARGIN_MS = 60_000
export function cashfreeOrderExpiry(expiresAt, now = Date.now()) {
  const deadline = typeof expiresAt === 'string' || expiresAt instanceof Date ? new Date(expiresAt).getTime() : NaN
  const remaining = deadline - now
  if (!Number.isFinite(deadline) ||
      remaining < CASHFREE_MIN_EXPIRY_MS + CASHFREE_EXPIRY_MARGIN_MS ||
      remaining > CASHFREE_MAX_EXPIRY_MS - CASHFREE_EXPIRY_MARGIN_MS) {
    throw new PaymentProviderError('payment_expiry_unsafe', 'Payment service rejected the request.')
  }
  return new Date(deadline).toISOString()
}

function paise(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw invalid()
  return Math.round(value * 100)
}
export function createCashfreeProvider(config, fetchImplementation = fetch, { logger = defaultLogger } = {}) {
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
    if (!response.ok) {
      let text
      try { text = (await response.text()).slice(0, 4096) } catch { text = '' }
      const diagnostic = { operation: operationFor(path, options.method || 'GET'), ...sanitizeCashfreeError(response.status, text) }
      try { logger(`[campusbite-api] Cashfree API error ${JSON.stringify(diagnostic)}`) } catch { /* logging must not change payment handling */ }
      const error = response.status === 404
        ? new PaymentProviderError('payment_order_not_found', 'The payment order was not found.')
        : new PaymentProviderError('payment_gateway_rejected', 'Payment service rejected the request.')
      error.providerDiagnostic = diagnostic
      throw error
    }
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
    async createProviderOrder({ amountPaise, attemptId, phoneNumber, expiresAt }) {
      if (!/^\+91[6-9]\d{9}$/.test(phoneNumber || '')) throw invalid()
      const orderExpiryTime = cashfreeOrderExpiry(expiresAt)
      const order = await request('/orders', { method: 'POST',
        headers: { 'x-idempotency-key': attemptId.replace(/^pay_/, '') },
        body: JSON.stringify({ order_id: id(attemptId), order_amount: amountPaise / 100, order_currency: 'INR',
          customer_details: { customer_id: cashfreeCustomerId(attemptId), customer_phone: phoneNumber.slice(3) },
          order_expiry_time: orderExpiryTime,
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
        // A payment started before expiry can still complete afterwards, so an
        // in-flight attempt keeps the order payable and its stock held.
        const inFlight = payments.find((payment) => payment.payment_status === 'PENDING')
        if (inFlight) return normalize(inFlight, orderId)
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

import { createHmac, timingSafeEqual } from 'node:crypto'
import { ApiError } from './apiError.js'

const MAX_RESPONSE_BYTES = 64 * 1024
const RAZORPAY_ID = /^(order|pay)_[A-Za-z0-9]{6,80}$/

export class PaymentProviderError extends ApiError {
  constructor(code, message, safeResult = {}) {
    super(502, code, message)
    this.name = 'PaymentProviderError'
    this.safeResult = safeResult
  }
}

function safeText(value, max = 240) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').slice(0, max)
}

function requireObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function validateProviderId(value, prefix) {
  const id = String(value || '')
  if (!RAZORPAY_ID.test(id) || !id.startsWith(`${prefix}_`)) {
    throw new PaymentProviderError(
      'payment_gateway_invalid_response',
      'The payment service returned invalid identifiers.',
    )
  }
  return id
}

function safeProviderError(payload, fallback) {
  const error = requireObject(payload?.error) ? payload.error : {}
  return {
    code: safeText(error.code || fallback, 64),
    message: safeText(error.description || 'The payment service rejected the request.'),
  }
}

function normalizePayment(payment) {
  if (!requireObject(payment)) {
    throw new PaymentProviderError(
      'payment_gateway_invalid_response',
      'The payment service returned an invalid payment.',
    )
  }
  const status = safeText(payment.status, 32).toLowerCase()
  let normalizedStatus = 'pending'
  if (status === 'captured') normalizedStatus = 'paid'
  if (status === 'failed') normalizedStatus = 'failed'
  return Object.freeze({
    amountPaise: Number(payment.amount),
    captured: payment.captured === true || status === 'captured',
    currency: safeText(payment.currency, 8).toUpperCase(),
    orderId: validateProviderId(payment.order_id, 'order'),
    paymentId: validateProviderId(payment.id, 'pay'),
    providerCode: safeText(payment.error_code || status || 'unknown', 64),
    providerMessage: safeText(
      payment.error_description || (status === 'captured' ? 'Payment captured.' : 'Payment pending.'),
    ),
    providerStatus: status,
    status: normalizedStatus,
  })
}

export function createRazorpayProvider(config, fetchImplementation = fetch) {
  if (!config?.enabled || config.provider !== 'razorpay') return null
  const providerConfig = config.razorpay
  const authorization = `Basic ${Buffer.from(
    `${providerConfig.keyId}:${providerConfig.keySecret}`,
  ).toString('base64')}`

  async function request(path, options = {}) {
    let response
    try {
      response = await fetchImplementation(new URL(path, providerConfig.apiHost), {
        ...options,
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(providerConfig.requestTimeoutMilliseconds),
      })
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new PaymentProviderError(
          'payment_gateway_timeout',
          'The payment service timed out. Check payment status before retrying.',
        )
      }
      throw new PaymentProviderError(
        'payment_gateway_unavailable',
        'CampusBite could not reach the payment service.',
      )
    }
    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new PaymentProviderError(
        'payment_gateway_invalid_response',
        'The payment service returned an invalid response.',
      )
    }
    const text = await response.text()
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
      throw new PaymentProviderError(
        'payment_gateway_invalid_response',
        'The payment service returned an invalid response.',
      )
    }
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw new PaymentProviderError(
        'payment_gateway_invalid_response',
        'The payment service returned an unreadable response.',
      )
    }
    if (!response.ok || !requireObject(payload)) {
      const safe = safeProviderError(payload, 'gateway_error')
      throw new PaymentProviderError(
        'payment_gateway_rejected',
        safe.message,
        safe,
      )
    }
    return payload
  }

  return Object.freeze({
    name: 'razorpay',
    parseWebhook(rawBody, signature) {
      if (!providerConfig.webhookSecret) {
        throw new ApiError(503, 'webhook_unavailable', 'Payment webhook is not configured.')
      }
      if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
        throw new ApiError(400, 'webhook_signature_invalid', 'Webhook verification failed.')
      }
      const digest = createHmac('sha256', providerConfig.webhookSecret).update(rawBody).digest()
      if (!timingSafeEqual(digest, Buffer.from(signature, 'hex'))) {
        throw new ApiError(400, 'webhook_signature_invalid', 'Webhook verification failed.')
      }
      let event
      try { event = JSON.parse(rawBody.toString('utf8')) } catch {
        throw new ApiError(400, 'invalid_webhook', 'Invalid webhook event.')
      }
      if (!requireObject(event) || typeof event.event !== 'string') {
        throw new ApiError(400, 'invalid_webhook', 'Invalid webhook event.')
      }
      if (!['payment.captured', 'order.paid'].includes(event.event)) return null
      const payment = event.payload?.payment?.entity
      if (!requireObject(payment) || payment.status !== 'captured' || payment.captured !== true ||
          !Number.isSafeInteger(payment.amount) || payment.amount <= 0 ||
          payment.currency !== 'INR' || typeof payment.id !== 'string' ||
          !/^pay_[A-Za-z0-9]{6,80}$/.test(payment.id) ||
          typeof payment.order_id !== 'string' || !/^order_[A-Za-z0-9]{6,80}$/.test(payment.order_id)) {
        throw new ApiError(400, 'invalid_webhook', 'Invalid captured payment event.')
      }
      // Do not retain provider error descriptions, notes, or personal data.
      return normalizePayment({ id: payment.id, order_id: payment.order_id,
        amount: payment.amount, currency: payment.currency, status: 'captured', captured: true })
    },
    async createProviderOrder({ amountPaise, attemptId }) {
      const order = await request('/v1/orders', {
        method: 'POST',
        body: JSON.stringify({
          amount: amountPaise,
          currency: 'INR',
          receipt: attemptId.slice(0, 40),
          notes: { campusbite_attempt: attemptId.slice(0, 100) },
          payment_capture: 1,
        }),
      })
      return {
        amountPaise: Number(order.amount),
        currency: safeText(order.currency, 8).toUpperCase(),
        orderId: validateProviderId(order.id, 'order'),
        providerCode: safeText(order.status || 'created', 64),
        providerMessage: 'Razorpay order created.',
      }
    },
    verifyCheckoutResult({ expectedOrderId, paymentId, returnedOrderId, signature }) {
      const expected = validateProviderId(expectedOrderId, 'order')
      const returned = validateProviderId(returnedOrderId, 'order')
      const payment = validateProviderId(paymentId, 'pay')
      if (expected !== returned || !/^[a-f0-9]{64}$/i.test(String(signature || ''))) {
        return false
      }
      const digest = createHmac('sha256', providerConfig.keySecret)
        .update(`${expected}|${payment}`)
        .digest()
      const received = Buffer.from(signature, 'hex')
      return received.length === digest.length && timingSafeEqual(received, digest)
    },
    async fetchPayment(paymentId) {
      return normalizePayment(
        await request(`/v1/payments/${encodeURIComponent(validateProviderId(paymentId, 'pay'))}`),
      )
    },
    async fetchProviderStatus(orderId) {
      const expectedOrderId = validateProviderId(orderId, 'order')
      const result = await request(
        `/v1/orders/${encodeURIComponent(expectedOrderId)}/payments`,
      )
      if (!Array.isArray(result.items)) {
        throw new PaymentProviderError(
          'payment_gateway_invalid_response',
          'The payment service returned an invalid status response.',
        )
      }
      const payments = result.items.map(normalizePayment)
      return (
        payments.find((payment) => payment.captured) ||
        payments.find((payment) => payment.status === 'pending') ||
        payments[0] ||
        null
      )
    },
    buildSafeCheckoutConfiguration({ amountPaise, orderId }) {
      return Object.freeze({
        amount: amountPaise,
        currency: 'INR',
        keyId: providerConfig.keyId,
        orderId: validateProviderId(orderId, 'order'),
      })
    },
  })
}

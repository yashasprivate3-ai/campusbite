import { createHash, randomUUID } from 'node:crypto'
import { buildTrustedCartSnapshot } from '../data/menu.js'
import { ApiError, invalidRequest } from './apiError.js'
import { recordAuthEvent } from './auth.js'
import { createPaidOrderInCurrentTransaction, getOrder } from './orders.js'
import { PaymentProviderError } from './razorpayProvider.js'

const ACTIVE_STATUSES = new Set(['created', 'initiated', 'pending'])
const TERMINAL_STATUSES = new Set(['paid', 'failed', 'cancelled', 'expired'])

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRequest(`${label} must be an object.`)
  }
  return value
}

function requireString(value, label, { minLength = 1, maxLength } = {}) {
  if (typeof value !== 'string') throw invalidRequest(`${label} must be a string.`)
  const normalized = value.trim()
  if (normalized.length < minLength) throw invalidRequest(`${label} is required.`)
  if (maxLength && normalized.length > maxLength) {
    throw invalidRequest(`${label} must be ${maxLength} characters or fewer.`)
  }
  return normalized
}

function optionalString(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return ''
  return requireString(value, label, { maxLength })
}

function normalizeCheckout(payload) {
  requireObject(payload, 'Request body')
  const trustedCart = buildTrustedCartSnapshot(payload.items)
  const pickupMethod = requireString(payload.pickupMethod, 'pickupMethod', { maxLength: 20 })
  if (!['asap', 'scheduled'].includes(pickupMethod)) {
    throw invalidRequest('pickupMethod must be either "asap" or "scheduled".')
  }
  const pickupSlot = optionalString(payload.pickupSlot, 'pickupSlot', 80)
  if (pickupMethod === 'scheduled' && !pickupSlot) {
    throw invalidRequest('pickupSlot is required for a scheduled pickup.')
  }
  const checkoutDetails = {
    pickupMethod,
    pickupSlot: pickupMethod === 'scheduled' ? pickupSlot : null,
    instructions: optionalString(payload.instructions, 'instructions', 120),
  }
  const idempotencyKey = requireString(payload.idempotencyKey, 'idempotencyKey', {
    minLength: 8,
    maxLength: 100,
  })
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ checkoutDetails, items: trustedCart.items }))
    .digest('hex')
  return { checkoutDetails, fingerprint, idempotencyKey, trustedCart }
}

function parseJson(value, fallback) {
  try { return JSON.parse(value) } catch { return fallback }
}

function normalizeTimestamp(value) {
  if (!value) return null
  const text = String(value)
  const iso = text.includes('T') ? text : text.replace(' ', 'T')
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? iso : `${iso}Z`)
  return Number.isNaN(date.getTime()) ? text : date.toISOString()
}

function mapAttempt(row, database) {
  return {
    attemptId: row.public_id,
    status: row.status,
    amountPaise: row.amount_paise,
    amount: (row.amount_paise / 100).toFixed(2),
    currency: row.currency,
    cart: parseJson(row.trusted_cart_json, []),
    expiresAt: normalizeTimestamp(row.expires_at),
    order: row.order_id ? getOrder(database, row.order_id, row.student_user_id) : null,
    responseCode: row.response_code || null,
    responseMessage: row.response_message || null,
    verifiedAt: normalizeTimestamp(row.verified_at),
  }
}

function selectAttempt(database, publicId) {
  return database.prepare('SELECT * FROM payment_attempts WHERE public_id = ?').get(publicId)
}

function requireOwnedAttempt(database, publicId, studentUserId) {
  const id = requireString(publicId, 'attemptId', { minLength: 8, maxLength: 100 })
  const attempt = selectAttempt(database, id)
  if (!attempt || attempt.student_user_id !== studentUserId) {
    if (attempt) recordEvent(database, 'PAYMENT_OWNERSHIP_REJECTED', studentUserId, { attemptId: id }, false)
    throw new ApiError(404, 'payment_attempt_not_found', 'The payment attempt was not found.')
  }
  return attempt
}

function recordEvent(database, eventType, userId, metadata = {}, success = true) {
  recordAuthEvent(database, { eventType, metadata, success, userId })
}

function isExpired(row) {
  return new Date(normalizeTimestamp(row.expires_at)).getTime() <= Date.now()
}

function unavailable() {
  return new ApiError(503, 'payments_unavailable', 'Razorpay Test Mode is not configured on this CampusBite server.')
}

function safeProviderResult(error) {
  if (!(error instanceof PaymentProviderError)) return {}
  return {
    code: String(error.safeResult?.code || error.code || '').slice(0, 64),
    message: String(error.safeResult?.message || error.message || '').slice(0, 240),
  }
}

function checkoutResponse(row, database, provider, reused = false) {
  const response = { ...mapAttempt(row, database), reused }
  if (ACTIVE_STATUSES.has(row.status) && !row.provider_order_id.startsWith('pending_')) {
    response.checkout = provider.buildSafeCheckoutConfiguration({
      amountPaise: row.amount_paise,
      orderId: row.provider_order_id,
    })
  }
  return response
}

export async function initiatePayment(database, payload, studentUserId, paymentConfig, provider) {
  if (!paymentConfig.enabled || !provider) throw unavailable()
  const normalized = normalizeCheckout(payload)
  let attempt = database.prepare(
    'SELECT * FROM payment_attempts WHERE student_user_id = ? AND idempotency_key = ?',
  ).get(studentUserId, normalized.idempotencyKey)
  if (attempt) {
    if (attempt.request_fingerprint !== normalized.fingerprint) {
      throw new ApiError(409, 'payment_idempotency_conflict', 'This payment request ID was already used for a different cart.')
    }
    if (attempt.status === 'paid' || (ACTIVE_STATUSES.has(attempt.status) && !isExpired(attempt))) {
      recordEvent(database, 'PAYMENT_INITIATION_REUSED', studentUserId, { attemptId: attempt.public_id })
      return checkoutResponse(attempt, database, provider, true)
    }
    throw new ApiError(409, 'payment_attempt_terminal', 'This payment attempt has ended. Start a new payment from the saved cart.', { status: attempt.status })
  }

  const now = new Date()
  const publicId = `pay_${randomUUID()}`
  const placeholderOrderId = `pending_${randomUUID()}`
  const expiresAt = new Date(now.getTime() + paymentConfig.razorpay.attemptLifetimeMinutes * 60_000)
  database.prepare(`INSERT INTO payment_attempts (
    public_id, student_user_id, provider, provider_order_id, amount_paise,
    currency, trusted_cart_json, checkout_details_json, request_fingerprint,
    idempotency_key, status, expires_at, created_at, updated_at
  ) VALUES (?, ?, 'razorpay', ?, ?, 'INR', ?, ?, ?, ?, 'created', ?, ?, ?)`)
    .run(publicId, studentUserId, placeholderOrderId, normalized.trustedCart.totalPaise,
      JSON.stringify(normalized.trustedCart.items), JSON.stringify(normalized.checkoutDetails),
      normalized.fingerprint, normalized.idempotencyKey, expiresAt.toISOString(),
      now.toISOString(), now.toISOString())
  recordEvent(database, 'PAYMENT_INITIATION_REQUESTED', studentUserId, { attemptId: publicId, provider: 'razorpay' })

  try {
    const created = await provider.createProviderOrder({
      amountPaise: normalized.trustedCart.totalPaise,
      attemptId: publicId,
    })
    if (created.amountPaise !== normalized.trustedCart.totalPaise || created.currency !== 'INR') {
      throw new PaymentProviderError('payment_gateway_mismatch', 'The payment service returned a mismatched order.')
    }
    const updatedAt = new Date().toISOString()
    database.prepare(`UPDATE payment_attempts SET provider_order_id = ?, status = 'initiated',
      initiated_at = ?, response_code = ?, response_message = ?, updated_at = ?
      WHERE public_id = ? AND status = 'created'`)
      .run(created.orderId, updatedAt, created.providerCode, created.providerMessage, updatedAt, publicId)
    recordEvent(database, 'PROVIDER_ORDER_CREATED', studentUserId, { attemptId: publicId, provider: 'razorpay' })
    recordEvent(database, 'PAYMENT_INITIATION_SUCCEEDED', studentUserId, { attemptId: publicId })
  } catch (error) {
    const safe = safeProviderResult(error)
    const pending = error.code === 'payment_gateway_timeout'
    database.prepare(`UPDATE payment_attempts SET status = ?, response_code = ?,
      response_message = ?, updated_at = ? WHERE public_id = ? AND order_id IS NULL`)
      .run(pending ? 'pending' : 'failed', safe.code || error.code || 'gateway_error',
        safe.message || 'Payment initiation failed.', new Date().toISOString(), publicId)
    recordEvent(database, 'PAYMENT_INITIATION_FAILED', studentUserId, { attemptId: publicId, reason: error.code || 'gateway_error' }, false)
    throw error
  }
  attempt = selectAttempt(database, publicId)
  return checkoutResponse(attempt, database, provider)
}

function updateNonPaid(database, row, providerPayment, status = providerPayment?.status || 'pending') {
  database.prepare(`UPDATE payment_attempts SET status = ?,
    provider_payment_id = COALESCE(?, provider_payment_id), response_code = ?,
    response_message = ?, updated_at = ? WHERE id = ? AND order_id IS NULL`)
    .run(status, providerPayment?.paymentId || null, providerPayment?.providerCode || status,
      providerPayment?.providerMessage || 'Payment pending.', new Date().toISOString(), row.id)
}

function rejectMismatch(database, row, studentUserId, reason) {
  updateNonPaid(database, row, null, 'failed')
  recordEvent(database, `PAYMENT_${reason.toUpperCase()}_MISMATCH_REJECTED`, studentUserId, { attemptId: row.public_id }, false)
  return mapAttempt(selectAttempt(database, row.public_id), database)
}

function fulfillCapturedPayment(database, row, studentUserId, payment, signatureVerifiedAt = null) {
  if (payment.orderId !== row.provider_order_id) return rejectMismatch(database, row, studentUserId, 'order')
  if (payment.amountPaise !== row.amount_paise) return rejectMismatch(database, row, studentUserId, 'amount')
  if (payment.currency !== row.currency || payment.currency !== 'INR') return rejectMismatch(database, row, studentUserId, 'currency')
  if (!payment.captured || payment.status !== 'paid') {
    updateNonPaid(database, row, payment, payment.status)
    recordEvent(database, payment.status === 'failed' ? 'PAYMENT_FAILED' : 'PAYMENT_PENDING', studentUserId, { attemptId: row.public_id }, payment.status !== 'failed')
    return mapAttempt(selectAttempt(database, row.public_id), database)
  }

  database.exec('BEGIN IMMEDIATE;')
  try {
    const current = database.prepare('SELECT * FROM payment_attempts WHERE id = ?').get(row.id)
    if (current.status === 'paid' && current.order_id) {
      recordEvent(database, 'PAYMENT_VERIFICATION_IDEMPOTENT', studentUserId, { attemptId: current.public_id })
      database.exec('COMMIT;')
      return mapAttempt(current, database)
    }
    const items = parseJson(current.trusted_cart_json, null)
    const checkoutDetails = parseJson(current.checkout_details_json, null)
    if (!Array.isArray(items) || !checkoutDetails) throw new Error('Stored trusted payment snapshot is invalid.')
    const orderResult = createPaidOrderInCurrentTransaction(database, {
      attemptPublicId: current.public_id,
      checkoutDetails,
      items,
      totalPaise: current.amount_paise,
    }, studentUserId)
    const now = new Date().toISOString()
    database.prepare(`UPDATE payment_attempts SET status = 'paid', provider_payment_id = ?,
      provider_signature_verified_at = COALESCE(?, provider_signature_verified_at), captured_at = ?,
      verified_at = ?, order_id = ?, response_code = ?, response_message = ?, updated_at = ?
      WHERE id = ? AND order_id IS NULL`)
      .run(payment.paymentId, signatureVerifiedAt, now, now, orderResult.order.id,
        payment.providerCode, payment.providerMessage, now, current.id)
    recordEvent(database, 'PAYMENT_CAPTURED', studentUserId, { attemptId: current.public_id })
    recordEvent(database, 'PAYMENT_VERIFICATION_SUCCEEDED', studentUserId, { attemptId: current.public_id, orderId: orderResult.order.id })
    recordEvent(database, 'ORDER_CREATED_FROM_PAYMENT', studentUserId, { attemptId: current.public_id, orderId: orderResult.order.id })
    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }
  return mapAttempt(selectAttempt(database, row.public_id), database)
}

export async function verifyPayment(database, payload, studentUserId, paymentConfig, provider) {
  if (!paymentConfig.enabled || !provider) throw unavailable()
  requireObject(payload, 'Request body')
  const row = requireOwnedAttempt(database, payload.attemptId, studentUserId)
  if (row.status === 'paid' && row.order_id) {
    recordEvent(database, 'PAYMENT_VERIFICATION_IDEMPOTENT', studentUserId, { attemptId: row.public_id })
    return mapAttempt(row, database)
  }
  const paymentId = requireString(payload.razorpay_payment_id, 'razorpay_payment_id', { maxLength: 100 })
  const returnedOrderId = requireString(payload.razorpay_order_id, 'razorpay_order_id', { maxLength: 100 })
  const signature = requireString(payload.razorpay_signature, 'razorpay_signature', { maxLength: 128 })
  if (!provider.verifyCheckoutResult({ expectedOrderId: row.provider_order_id, paymentId, returnedOrderId, signature })) {
    recordEvent(database, 'PAYMENT_VERIFICATION_FAILED', studentUserId, { attemptId: row.public_id, reason: 'signature_or_order' }, false)
    throw new ApiError(400, 'payment_signature_invalid', 'Payment verification failed.')
  }
  const signatureVerifiedAt = new Date().toISOString()
  const payment = await provider.fetchPayment(paymentId)
  if (payment.paymentId !== paymentId) return rejectMismatch(database, row, studentUserId, 'payment')
  return fulfillCapturedPayment(database, row, studentUserId, payment, signatureVerifiedAt)
}

export function handlePaymentWebhook(database, rawBody, signature, paymentConfig, provider) {
  if (!paymentConfig.enabled || provider?.name !== 'razorpay') throw unavailable()
  const payment = provider.parseWebhook(rawBody, signature)
  if (!payment) return
  const row = database.prepare(
    "SELECT * FROM payment_attempts WHERE provider = ? AND provider_order_id = ?",
  ).get(provider.name, payment.orderId)
  // Unrelated merchant orders are acknowledged without exposing local state.
  if (!row) return
  if (payment.amountPaise !== row.amount_paise || payment.currency !== row.currency ||
      !payment.captured || payment.status !== 'paid') {
    throw new ApiError(400, 'webhook_payment_mismatch', 'Webhook payment does not match the stored attempt.')
  }
  const linked = database.prepare(
    'SELECT id FROM payment_attempts WHERE provider = ? AND provider_payment_id = ?',
  ).get(provider.name, payment.paymentId)
  if ((linked && linked.id !== row.id) || (row.order_id && row.provider_payment_id !== payment.paymentId)) {
    throw new ApiError(400, 'webhook_payment_mismatch', 'Webhook payment does not match the stored attempt.')
  }
  // Durable attempt/order uniqueness is the deduplication boundary, including
  // different event IDs for the same capture and retries after process restart.
  if (row.status === 'paid' && row.order_id) return
  fulfillCapturedPayment(database, row, row.student_user_id, payment, new Date().toISOString())
}

export async function getPaymentStatus(database, attemptId, studentUserId, paymentConfig, provider) {
  const row = requireOwnedAttempt(database, attemptId, studentUserId)
  if (!ACTIVE_STATUSES.has(row.status) || TERMINAL_STATUSES.has(row.status)) return mapAttempt(row, database)
  if (!paymentConfig.enabled || !provider) throw unavailable()
  if (isExpired(row)) {
    updateNonPaid(database, row, null, 'expired')
    return mapAttempt(selectAttempt(database, row.public_id), database)
  }
  const payment = await provider.fetchProviderStatus(row.provider_order_id)
  if (!payment) {
    recordEvent(database, 'PAYMENT_PENDING', studentUserId, { attemptId: row.public_id })
    return mapAttempt(row, database)
  }
  return fulfillCapturedPayment(database, row, studentUserId, payment)
}

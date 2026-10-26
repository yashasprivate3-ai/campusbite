import { BRAND } from '../../shared/brand.js'
import { reserveCartStock } from './menuAvailability.js'
import { createHash, randomUUID } from 'node:crypto'
import { buildTrustedCartSnapshot } from '../data/menu.js'
import { ApiError, invalidRequest } from './apiError.js'
import { recordAuthEvent } from './auth.js'
import { createPaidOrderInCurrentTransaction, getOrder } from './orders.js'
import { PaymentProviderError } from './razorpayProvider.js'
import { campusDate } from '../../shared/pickupPolicy.js'

const ACTIVE_STATUSES = new Set(['created', 'initiated', 'pending'])
const TERMINAL_STATUSES = new Set(['paid', 'failed', 'cancelled', 'expired'])
// Reconciliation waits this long after the local checkout expiry before asking
// the provider, so Cashfree has time to mark its own order as expired.
export const RELEASE_GRACE_MS = 2 * 60_000
export const CASHFREE_ATTEMPT_LIFETIME_MINUTES = 20
const CAPTURED_UNFULFILLED = 'captured_unfulfilled'

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

export function listPaymentReconciliationHolds(database, now = new Date(), { automaticRelease = false } = {}) {
  const rows = database.prepare(`
    SELECT p.id, p.public_id, p.provider, p.provider_order_id,
      p.provider_payment_id, p.status, p.amount_paise, p.currency,
      p.expires_at, p.created_at, p.updated_at,
      r.service_date, r.menu_item_id, r.quantity
    FROM payment_attempts p
    JOIN stock_reservations r ON r.attempt_id = p.id
    WHERE r.status = 'held'
      AND p.order_id IS NULL
      AND (
        p.status IN ('failed', 'cancelled', 'expired')
        OR julianday(p.expires_at) <= julianday(?)
      )
    ORDER BY p.updated_at ASC, p.id ASC, r.menu_item_id ASC
  `).all(now.toISOString())

  const byAttempt = new Map()
  for (const row of rows) {
    let attempt = byAttempt.get(row.id)
    if (!attempt) {
      attempt = {
        attemptId: row.public_id,
        provider: row.provider,
        providerOrderId: row.provider_order_id,
        providerPaymentId: row.provider_payment_id || null,
        localStatus: row.status,
        amountPaise: row.amount_paise,
        currency: row.currency,
        expiresAt: normalizeTimestamp(row.expires_at),
        createdAt: normalizeTimestamp(row.created_at),
        updatedAt: normalizeTimestamp(row.updated_at),
        reason: TERMINAL_STATUSES.has(row.status)
          ? `local_${row.status}_provider_confirmation_required`
          : 'local_expiry_provider_confirmation_required',
        reservations: [],
      }
      byAttempt.set(row.id, attempt)
    }
    attempt.reservations.push({
      serviceDate: row.service_date,
      menuItemId: row.menu_item_id,
      quantity: row.quantity,
    })
  }

  // Payments captured after their stock was released and could not be re-reserved.
  // No order exists for these; the owner must refund them.
  const capturedUnfulfilled = database.prepare(`
    SELECT public_id, provider, provider_order_id, provider_payment_id, status,
      amount_paise, currency, updated_at
    FROM payment_attempts
    WHERE response_code = ? AND order_id IS NULL
    ORDER BY updated_at ASC, id ASC
  `).all(CAPTURED_UNFULFILLED).map(row => ({
    attemptId: row.public_id,
    provider: row.provider,
    providerOrderId: row.provider_order_id,
    providerPaymentId: row.provider_payment_id || null,
    localStatus: row.status,
    amountPaise: row.amount_paise,
    currency: row.currency,
    updatedAt: normalizeTimestamp(row.updated_at),
    reason: 'captured_after_release_refund_required',
  }))

  return {
    automaticReleaseEnabled: automaticRelease === true,
    holds: [...byAttempt.values()],
    capturedUnfulfilled,
  }
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

function releaseHeldReservations(database, attemptId, now) {
  return database.prepare(`UPDATE stock_reservations SET status = 'released', released_at = ?
    WHERE attempt_id = ? AND status = 'held'`).run(now, attemptId).changes
}

// Marks an attempt as ended and releases its held stock in one transaction.
// Only called after the provider has confirmed that its order can no longer be paid.
function settleEndedWithoutPayment(database, row, status, providerCode, providerMessage) {
  database.exec('BEGIN IMMEDIATE;')
  try {
    const current = database.prepare('SELECT * FROM payment_attempts WHERE id = ?').get(row.id)
    if (current.order_id || current.status === 'paid') {
      database.exec('COMMIT;')
      return
    }
    const now = new Date().toISOString()
    database.prepare(`UPDATE payment_attempts SET status = ?, response_code = ?, response_message = ?, updated_at = ?
      WHERE id = ? AND order_id IS NULL`).run(status, providerCode || status, providerMessage || 'Payment ended.', now, current.id)
    const released = releaseHeldReservations(database, current.id, now)
    if (released > 0) {
      recordEvent(database, 'STOCK_RESERVATION_RELEASED', current.student_user_id, { attemptId: current.public_id, reason: status })
    }
    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }
}

// Re-holds released stock for a late successful payment, only for today's service
// date and only if every item still has enough unreserved stock. Returns false
// (and changes nothing) if that is not possible.
function reacquireReleasedReservations(database, attemptId) {
  const rows = database.prepare(`SELECT service_date, menu_item_id, quantity FROM stock_reservations
    WHERE attempt_id = ? AND status = 'released'`).all(attemptId)
  const today = campusDate(new Date())
  for (const reservation of rows) {
    if (reservation.service_date !== today) return false
    const stock = database.prepare(`SELECT s.quantity - COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r
      WHERE r.service_date = s.service_date AND r.menu_item_id = s.menu_item_id
        AND r.status IN ('held', 'consumed')), 0) AS remaining
      FROM daily_menu_stock s WHERE s.service_date = ? AND s.menu_item_id = ?`)
      .get(reservation.service_date, reservation.menu_item_id)
    if (!stock || stock.remaining < reservation.quantity) return false
  }
  database.prepare(`UPDATE stock_reservations SET status = 'held', released_at = NULL
    WHERE attempt_id = ? AND status = 'released'`).run(attemptId)
  return true
}

function unavailable() {
  return new ApiError(503, 'payments_unavailable', `Payments are not configured on this ${BRAND.name} server.`)
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
  if (ACTIVE_STATUSES.has(row.status) && row.provider === provider.name &&
      !row.provider_order_id.startsWith('pending_') && (row.provider !== 'cashfree' || row.provider_session_id)) {
    response.checkout = provider.buildSafeCheckoutConfiguration({
      amountPaise: row.amount_paise,
      orderId: row.provider_order_id,
      sessionId: row.provider_session_id,
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
  const placeholderOrderId = paymentConfig.provider === 'cashfree' ? publicId : `pending_${randomUUID()}`
  // Cashfree requires an order expiry more than 15 minutes away, so its attempts
  // use a 20-minute deadline shared with the Cashfree order. Razorpay is unchanged.
  const lifetimeMinutes = paymentConfig.provider === 'cashfree'
    ? CASHFREE_ATTEMPT_LIFETIME_MINUTES
    : (paymentConfig.attemptLifetimeMinutes || paymentConfig.razorpay?.attemptLifetimeMinutes || 15)
  const expiresAt = new Date(now.getTime() + lifetimeMinutes * 60_000)
  database.exec('BEGIN IMMEDIATE;')
  try {
    database.prepare(`INSERT INTO payment_attempts (
      public_id, student_user_id, provider, provider_order_id, amount_paise,
      currency, trusted_cart_json, checkout_details_json, request_fingerprint,
      idempotency_key, status, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, 'created', ?, ?, ?)`)
      .run(publicId, studentUserId, paymentConfig.provider, placeholderOrderId, normalized.trustedCart.totalPaise,
        JSON.stringify(normalized.trustedCart.items), JSON.stringify(normalized.checkoutDetails),
        normalized.fingerprint, normalized.idempotencyKey, expiresAt.toISOString(),
        now.toISOString(), now.toISOString())
    const insertedAttempt = selectAttempt(database, publicId)
    reserveCartStock(database, insertedAttempt.id, normalized.trustedCart, normalized.checkoutDetails, paymentConfig.orderingClock?.() || new Date())
    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }
  recordEvent(database, 'PAYMENT_INITIATION_REQUESTED', studentUserId, { attemptId: publicId, provider: paymentConfig.provider })

  try {
    const created = await provider.createProviderOrder({
      amountPaise: normalized.trustedCart.totalPaise,
      attemptId: publicId,
      phoneNumber: database.prepare('SELECT phone_number FROM users WHERE id = ?').get(studentUserId)?.phone_number,
      expiresAt: expiresAt.toISOString(),
    })
    if (created.amountPaise !== normalized.trustedCart.totalPaise || created.currency !== 'INR') {
      throw new PaymentProviderError('payment_gateway_mismatch', 'The payment service returned a mismatched order.')
    }
    const updatedAt = new Date().toISOString()
    database.prepare(`UPDATE payment_attempts SET provider_order_id = ?, provider_session_id = ?, status = 'initiated',
      initiated_at = ?, response_code = ?, response_message = ?, updated_at = ?
      WHERE public_id = ? AND status = 'created'`)
      .run(created.orderId, created.sessionId || null, updatedAt, created.providerCode, created.providerMessage, updatedAt, publicId)
    recordEvent(database, 'PROVIDER_ORDER_CREATED', studentUserId, { attemptId: publicId, provider: paymentConfig.provider })
    recordEvent(database, 'PAYMENT_INITIATION_SUCCEEDED', studentUserId, { attemptId: publicId })
  } catch (error) {
    const safe = safeProviderResult(error)
    const pending = error.code === 'payment_gateway_timeout'
    database.prepare(`UPDATE payment_attempts SET status = ?, response_code = ?,
      response_message = ?, updated_at = ? WHERE public_id = ? AND order_id IS NULL`)
      .run(pending ? 'pending' : 'failed', safe.code || error.code || 'gateway_error',
        safe.message || 'Payment initiation failed.', new Date().toISOString(), publicId)
    const diagnostic = error.providerDiagnostic
    recordEvent(database, 'PAYMENT_INITIATION_FAILED', studentUserId, {
      attemptId: publicId,
      reason: error.code || 'gateway_error',
      ...(diagnostic ? { providerHttpStatus: diagnostic.httpStatus, providerCode: diagnostic.code, providerType: diagnostic.type } : {}),
    }, false)
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

function consumeMatchingReservations(database, attemptId, items) {
  const expected = new Map()
  for (const item of items) {
    if (!Number.isSafeInteger(item?.menuItemId) || !Number.isSafeInteger(item?.quantity) ||
        item.quantity < 1 || expected.has(item.menuItemId)) {
      throw new Error('Stored trusted payment snapshot is invalid.')
    }
    expected.set(item.menuItemId, item.quantity)
  }

  const reservationRows = database.prepare(`
    SELECT menu_item_id AS menuItemId, quantity, status
    FROM stock_reservations
    WHERE attempt_id = ?
  `).all(attemptId)
  const seen = new Set()
  const reservationsMatch = reservationRows.length === expected.size &&
    reservationRows.every((reservation) => {
      if (seen.has(reservation.menuItemId)) return false
      seen.add(reservation.menuItemId)
      return reservation.status === 'held' &&
        expected.get(reservation.menuItemId) === reservation.quantity
    })

  if (!reservationsMatch || seen.size !== expected.size) {
    throw new Error('Payment stock reservations do not match the trusted cart.')
  }

  const consumed = database.prepare(`
    UPDATE stock_reservations
    SET status = 'consumed'
    WHERE attempt_id = ? AND status = 'held'
  `).run(attemptId)
  if (consumed.changes !== expected.size) {
    throw new Error('Payment stock reservations were not consumed safely.')
  }
}

function fulfillCapturedPayment(database, row, studentUserId, payment, signatureVerifiedAt = null) {
  if (payment.orderId !== row.provider_order_id) return rejectMismatch(database, row, studentUserId, 'order')
  if (payment.amountPaise !== row.amount_paise) return rejectMismatch(database, row, studentUserId, 'amount')
  if (payment.currency !== row.currency || payment.currency !== 'INR') return rejectMismatch(database, row, studentUserId, 'currency')
  if (!payment.captured || payment.status !== 'paid') {
    // Cashfree reports 'expired'/'cancelled' only when its order has ended (EXPIRED/TERMINATED)
    // with no successful payment, so held stock can be released safely and idempotently.
    if (row.provider === 'cashfree' && ['expired', 'cancelled'].includes(payment.status)) {
      settleEndedWithoutPayment(database, row, payment.status, payment.providerCode, payment.providerMessage)
      return mapAttempt(selectAttempt(database, row.public_id), database)
    }
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
    const reservationStates = database.prepare('SELECT status FROM stock_reservations WHERE attempt_id = ?').all(current.id)
    const releasedEarlier = TERMINAL_STATUSES.has(current.status) && current.status !== 'paid' &&
      reservationStates.length > 0 && reservationStates.every(reservation => reservation.status === 'released')
    if (releasedEarlier) {
      if (current.response_code === CAPTURED_UNFULFILLED && current.provider_payment_id === payment.paymentId) {
        database.exec('COMMIT;')
        return mapAttempt(current, database)
      }
      if (!reacquireReleasedReservations(database, current.id)) {
        // Never oversell and never drop a captured payment: record it for an owner refund.
        const now = new Date().toISOString()
        database.prepare(`UPDATE payment_attempts SET provider_payment_id = ?, captured_at = ?, verified_at = ?,
          response_code = ?, response_message = ?, updated_at = ? WHERE id = ? AND order_id IS NULL`)
          .run(payment.paymentId, now, now, CAPTURED_UNFULFILLED,
            'Payment received after this checkout ended and the items are no longer available. A refund is required.',
            now, current.id)
        recordEvent(database, 'PAYMENT_CAPTURED_AFTER_RELEASE', studentUserId, { attemptId: current.public_id }, false)
        database.exec('COMMIT;')
        return mapAttempt(selectAttempt(database, current.public_id), database)
      }
      recordEvent(database, 'STOCK_RESERVATION_REACQUIRED', studentUserId, { attemptId: current.public_id })
    }
    consumeMatchingReservations(database, current.id, items)
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
  if (row.provider !== provider.name) throw unavailable()
  if (provider.name === 'cashfree') {
    const payment = await provider.fetchProviderStatus(row.provider_order_id)
    return payment ? fulfillCapturedPayment(database, row, studentUserId, payment) : mapAttempt(row, database)
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

export function handlePaymentWebhook(database, rawBody, signature, paymentConfig, provider, timestamp) {
  if (!paymentConfig.enabled || !['razorpay', 'cashfree'].includes(provider?.name)) throw unavailable()
  const payment = provider.parseWebhook(rawBody, signature, timestamp)
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
  if (row.status === 'paid' || (row.provider !== 'cashfree' && (!ACTIVE_STATUSES.has(row.status) || TERMINAL_STATUSES.has(row.status)))) return mapAttempt(row, database)
  if (!paymentConfig.enabled || !provider) throw unavailable()
  if (isExpired(row) && row.provider !== 'cashfree') {
    updateNonPaid(database, row, null, 'expired')
    return mapAttempt(selectAttempt(database, row.public_id), database)
  }
  if (row.provider !== provider.name) throw unavailable()
  const payment = await provider.fetchProviderStatus(row.provider_order_id)
  if (!payment) {
    recordEvent(database, 'PAYMENT_PENDING', studentUserId, { attemptId: row.public_id })
    return mapAttempt(row, database)
  }
  return fulfillCapturedPayment(database, row, studentUserId, payment)
}

// Automatic, idempotent release of stock held by Cashfree checkouts that ended
// without payment. Each run asks Cashfree for the real order state; anything
// uncertain (still payable, pending, or a provider error) keeps its stock held
// and is retried on the next run. A late success creates the order normally.
export async function reconcilePaymentHolds(database, paymentConfig, provider, now = new Date(), { limit = 50 } = {}) {
  const summary = { checked: 0, released: 0, fulfilled: 0, kept: 0, deferred: 0 }
  if (!paymentConfig?.enabled || provider?.name !== 'cashfree') return summary
  const cutoff = new Date(now.getTime() - RELEASE_GRACE_MS).toISOString()
  const rows = database.prepare(`
    SELECT DISTINCT p.*
    FROM payment_attempts p
    JOIN stock_reservations r ON r.attempt_id = p.id
    WHERE p.provider = 'cashfree'
      AND p.order_id IS NULL
      AND r.status = 'held'
      AND julianday(p.expires_at) <= julianday(?)
    ORDER BY p.id ASC
    LIMIT ?
  `).all(cutoff, limit)

  for (const row of rows) {
    summary.checked += 1
    try {
      const payment = await provider.fetchProviderStatus(row.provider_order_id)
      if (!payment) {
        summary.kept += 1
        continue
      }
      const result = fulfillCapturedPayment(database, row, row.student_user_id, payment)
      if (result.status === 'paid') summary.fulfilled += 1
      else if (result.status === 'expired' || result.status === 'cancelled') summary.released += 1
      else summary.kept += 1
    } catch (error) {
      // Cashfree has no order with this ID and the checkout never received a session,
      // so nothing can ever be paid against it.
      if (error?.code === 'payment_order_not_found' && !row.provider_session_id) {
        settleEndedWithoutPayment(database, row, 'failed', 'ORDER_NOT_FOUND',
          'The payment session was never opened. No payment was taken.')
        summary.released += 1
      } else {
        summary.deferred += 1
      }
    }
  }
  return summary
}

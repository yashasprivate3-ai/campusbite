import { createHash, randomUUID } from 'node:crypto'
import { buildTrustedCartSnapshot } from '../data/menu.js'
import { ApiError, invalidRequest } from './apiError.js'
import { recordAuthEvent } from './auth.js'
import { createPaidOrderInCurrentTransaction, getOrder } from './orders.js'
import { PaytmGatewayError } from './paytmClient.js'

const ACTIVE_PAYMENT_STATUSES = new Set(['created', 'initiated', 'pending'])
const TERMINAL_PAYMENT_STATUSES = new Set(['paid', 'failed', 'cancelled', 'expired'])

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
  const pickupMethod = requireString(payload.pickupMethod, 'pickupMethod', {
    maxLength: 20,
  })
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
  const idempotencyKey = requireString(
    payload.idempotencyKey,
    'idempotencyKey',
    { minLength: 8, maxLength: 100 },
  )
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ checkoutDetails, items: trustedCart.items }))
    .digest('hex')

  return { checkoutDetails, fingerprint, idempotencyKey, trustedCart }
}

function normalizeTimestamp(value) {
  if (!value) return null
  const text = String(value)
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
  const isoValue = text.includes('T') ? text : text.replace(' ', 'T')
  const date = new Date(hasTimeZone ? isoValue : `${isoValue}Z`)
  return Number.isNaN(date.getTime()) ? text : date.toISOString()
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function mapAttempt(row, database) {
  const order = row.order_id
    ? getOrder(database, row.order_id, row.student_user_id)
    : null
  return {
    attemptId: row.public_id,
    status: row.status,
    amountPaise: row.amount_paise,
    amount: (row.amount_paise / 100).toFixed(2),
    currency: row.currency,
    cart: parseJson(row.trusted_cart_json, []),
    expiresAt: normalizeTimestamp(row.expires_at),
    order,
    responseCode: row.response_code || null,
    responseMessage: row.response_message || null,
    verifiedAt: normalizeTimestamp(row.verified_at),
  }
}

function selectAttemptByPublicId(database, publicId) {
  return database
    .prepare('SELECT * FROM payment_attempts WHERE public_id = ?')
    .get(publicId)
}

function requireOwnedAttempt(database, publicId, studentUserId) {
  const normalizedId = requireString(publicId, 'attemptId', {
    minLength: 8,
    maxLength: 100,
  })
  const attempt = selectAttemptByPublicId(database, normalizedId)

  if (!attempt || attempt.student_user_id !== studentUserId) {
    if (attempt && attempt.student_user_id !== studentUserId) {
      recordAuthEvent(database, {
        eventType: 'PAYMENT_OWNERSHIP_REJECTED',
        success: false,
        userId: studentUserId,
        metadata: { attemptId: normalizedId },
      })
    }
    throw new ApiError(404, 'payment_attempt_not_found', 'The payment attempt was not found.')
  }

  return attempt
}

function safeGatewayResult(error) {
  if (!(error instanceof PaytmGatewayError)) return {}
  return {
    responseCode: String(error.safeResult?.resultCode || '').slice(0, 64),
    responseMessage: String(
      error.safeResult?.resultMessage || error.message || '',
    ).slice(0, 240),
  }
}

function recordPaymentEvent(database, eventType, userId, metadata = {}, success = true) {
  recordAuthEvent(database, { eventType, metadata, success, userId })
}

function isExpired(row) {
  const expiresAt = new Date(normalizeTimestamp(row.expires_at))
  return Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()
}

function checkoutResponse(row, database, paymentConfig, reused = false) {
  const attempt = mapAttempt(row, database)
  const response = { ...attempt, reused }

  if (row.checkout_token && ACTIVE_PAYMENT_STATUSES.has(row.status)) {
    response.checkout = {
      mid: paymentConfig.paytm.mid,
      orderId: row.provider_order_id,
      amount: attempt.amount,
      transactionToken: row.checkout_token,
      checkoutHost: paymentConfig.paytm.checkoutHost,
      environment: paymentConfig.paytm.environment,
    }
  }

  return response
}

function paymentUnavailable() {
  return new ApiError(
    503,
    'payments_unavailable',
    'Paytm staging payments are not configured on this CampusBite server.',
  )
}

export async function initiatePaytmPayment(
  database,
  payload,
  studentUserId,
  paymentConfig,
  paytmClient,
) {
  if (!paymentConfig.enabled || !paytmClient) throw paymentUnavailable()
  const normalized = normalizeCheckout(payload)
  let attempt = database
    .prepare(
      `SELECT * FROM payment_attempts
        WHERE student_user_id = ? AND idempotency_key = ?`,
    )
    .get(studentUserId, normalized.idempotencyKey)

  if (attempt) {
    if (attempt.request_fingerprint !== normalized.fingerprint) {
      throw new ApiError(
        409,
        'payment_idempotency_conflict',
        'This payment request ID was already used for a different cart.',
      )
    }

    if (attempt.status === 'paid' || (ACTIVE_PAYMENT_STATUSES.has(attempt.status) && !isExpired(attempt))) {
      return checkoutResponse(attempt, database, paymentConfig, true)
    }

    throw new ApiError(
      409,
      'payment_attempt_terminal',
      'This payment attempt has ended. Start a new payment from the saved cart.',
      { status: attempt.status },
    )
  }

  const now = new Date()
  const expiresAt = new Date(
    now.getTime() + paymentConfig.paytm.attemptLifetimeMinutes * 60 * 1000,
  )
  const publicId = `pay_${randomUUID()}`
  const providerOrderId = `CBP_${randomUUID().replaceAll('-', '')}`

  database.exec('BEGIN IMMEDIATE;')
  try {
    database
      .prepare(
        `INSERT INTO payment_attempts (
           public_id, student_user_id, provider, provider_order_id,
           amount_paise, currency, trusted_cart_json, checkout_details_json,
           request_fingerprint, idempotency_key, status, expires_at,
           created_at, updated_at
         ) VALUES (?, ?, 'paytm', ?, ?, 'INR', ?, ?, ?, ?, 'created', ?, ?, ?)`,
      )
      .run(
        publicId,
        studentUserId,
        providerOrderId,
        normalized.trustedCart.totalPaise,
        JSON.stringify(normalized.trustedCart.items),
        JSON.stringify(normalized.checkoutDetails),
        normalized.fingerprint,
        normalized.idempotencyKey,
        expiresAt.toISOString(),
        now.toISOString(),
        now.toISOString(),
      )
    recordPaymentEvent(
      database,
      'PAYMENT_INITIATION_REQUESTED',
      studentUserId,
      { attemptId: publicId, provider: 'paytm' },
    )
    database
      .prepare(
        `UPDATE payment_attempts
            SET status = 'pending', initiated_at = ?, updated_at = ?
          WHERE public_id = ? AND status = 'created'`,
      )
      .run(now.toISOString(), now.toISOString(), publicId)
    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }

  try {
    const gatewayResult = await paytmClient.initiate({
      amount: (normalized.trustedCart.totalPaise / 100).toFixed(2),
      customerId: `student_${studentUserId}`,
      orderId: providerOrderId,
    })
    const updatedAt = new Date().toISOString()
    database
      .prepare(
        `UPDATE payment_attempts
            SET status = 'initiated', checkout_token = ?, response_code = ?,
                response_message = ?, updated_at = ?
          WHERE public_id = ? AND order_id IS NULL`,
      )
      .run(
        gatewayResult.transactionToken,
        gatewayResult.resultCode,
        gatewayResult.resultMessage,
        updatedAt,
        publicId,
      )
    recordPaymentEvent(database, 'PAYTM_INITIATION_SUCCEEDED', studentUserId, {
      attemptId: publicId,
      responseCode: gatewayResult.resultCode,
    })
  } catch (error) {
    const uncertain = error.code === 'payment_gateway_timeout'
    const safeResult = safeGatewayResult(error)
    database
      .prepare(
        `UPDATE payment_attempts
            SET status = ?, response_code = ?, response_message = ?,
                updated_at = ?
          WHERE public_id = ? AND order_id IS NULL`,
      )
      .run(
        uncertain ? 'pending' : 'failed',
        safeResult.responseCode || error.code || 'gateway_error',
        safeResult.responseMessage || error.message,
        new Date().toISOString(),
        publicId,
      )
    recordPaymentEvent(
      database,
      'PAYTM_INITIATION_FAILED',
      studentUserId,
      { attemptId: publicId, reason: error.code || 'gateway_error' },
      false,
    )
    throw error
  }

  attempt = selectAttemptByPublicId(database, publicId)
  return checkoutResponse(attempt, database, paymentConfig)
}

function parseGatewayAmount(value) {
  const normalized = String(value || '')
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null
  const [rupees, fraction = ''] = normalized.split('.')
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(paise) ? paise : null
}

function updateNonPaidAttempt(database, row, status, gatewayResult) {
  database
    .prepare(
      `UPDATE payment_attempts
          SET status = ?, provider_txn_id = COALESCE(?, provider_txn_id),
              response_code = ?, response_message = ?, updated_at = ?,
              checkout_token = CASE WHEN ? IN ('failed', 'cancelled', 'expired') THEN NULL ELSE checkout_token END
        WHERE id = ? AND order_id IS NULL`,
    )
    .run(
      status,
      gatewayResult.txnId || null,
      gatewayResult.resultCode,
      gatewayResult.resultMessage,
      new Date().toISOString(),
      status,
      row.id,
    )
}

async function refreshPaytmAttempt(
  database,
  row,
  studentUserId,
  paymentConfig,
  paytmClient,
) {
  if (row.status === 'paid' && row.order_id) {
    recordPaymentEvent(database, 'PAYMENT_CONFIRMATION_IDEMPOTENT', studentUserId, {
      attemptId: row.public_id,
    })
    return mapAttempt(row, database)
  }

  if (TERMINAL_PAYMENT_STATUSES.has(row.status)) return mapAttempt(row, database)
  if (!paymentConfig.enabled || !paytmClient) throw paymentUnavailable()

  let gatewayResult
  try {
    gatewayResult = await paytmClient.getStatus({ orderId: row.provider_order_id })
  } catch (error) {
    recordPaymentEvent(
      database,
      'PAYMENT_STATUS_CHECK_FAILED',
      studentUserId,
      { attemptId: row.public_id, reason: error.code || 'gateway_error' },
      false,
    )
    throw error
  }

  recordPaymentEvent(database, 'PAYMENT_STATUS_CHECKED', studentUserId, {
    attemptId: row.public_id,
    responseCode: gatewayResult.resultCode,
    status: gatewayResult.resultStatus,
  })

  const gatewayAmount = parseGatewayAmount(gatewayResult.txnAmount)
  const identityMatches =
    String(gatewayResult.mid || '') === paymentConfig.paytm.mid &&
    String(gatewayResult.orderId || '') === row.provider_order_id
  const currency = String(gatewayResult.currency || gatewayResult.txnAmount?.currency || 'INR')
  const amountMatches = gatewayAmount === row.amount_paise

  if (!identityMatches || !amountMatches || currency !== 'INR') {
    updateNonPaidAttempt(database, row, 'failed', {
      ...gatewayResult,
      resultCode: 'gateway_mismatch',
      resultMessage: 'Gateway response did not match the payment attempt.',
    })
    recordPaymentEvent(
      database,
      'PAYMENT_AMOUNT_MISMATCH_REJECTED',
      studentUserId,
      { attemptId: row.public_id, reason: identityMatches ? 'amount_or_currency' : 'identity' },
      false,
    )
    return mapAttempt(selectAttemptByPublicId(database, row.public_id), database)
  }

  if (gatewayResult.resultStatus !== 'TXN_SUCCESS') {
    let nextStatus = 'pending'
    if (gatewayResult.resultStatus === 'TXN_FAILURE') nextStatus = 'failed'
    if (gatewayResult.resultStatus === 'NO_RECORD_FOUND' && isExpired(row)) {
      nextStatus = 'expired'
    }
    updateNonPaidAttempt(database, row, nextStatus, gatewayResult)
    recordPaymentEvent(
      database,
      nextStatus === 'pending' ? 'PAYMENT_PENDING' : 'PAYMENT_FAILED',
      studentUserId,
      { attemptId: row.public_id, responseCode: gatewayResult.resultCode },
      nextStatus === 'pending',
    )
    return mapAttempt(selectAttemptByPublicId(database, row.public_id), database)
  }

  if (String(gatewayResult.paymentMode || '').toUpperCase() !== 'UPI') {
    updateNonPaidAttempt(database, row, 'failed', {
      ...gatewayResult,
      resultCode: 'unsupported_payment_mode',
      resultMessage: 'CampusBite V1 accepts verified UPI payments only.',
    })
    recordPaymentEvent(
      database,
      'PAYMENT_MODE_REJECTED',
      studentUserId,
      { attemptId: row.public_id, paymentMode: String(gatewayResult.paymentMode || '').slice(0, 20) },
      false,
    )
    return mapAttempt(selectAttemptByPublicId(database, row.public_id), database)
  }

  database.exec('BEGIN IMMEDIATE;')
  try {
    const current = database
      .prepare('SELECT * FROM payment_attempts WHERE id = ?')
      .get(row.id)
    if (current.status === 'paid' && current.order_id) {
      database.exec('COMMIT;')
      return mapAttempt(current, database)
    }

    const trustedItems = parseJson(current.trusted_cart_json, null)
    const checkoutDetails = parseJson(current.checkout_details_json, null)
    if (!Array.isArray(trustedItems) || !checkoutDetails) {
      throw new Error('Stored trusted payment snapshot is invalid.')
    }

    const orderResult = createPaidOrderInCurrentTransaction(
      database,
      {
        attemptPublicId: current.public_id,
        checkoutDetails,
        items: trustedItems,
        totalPaise: current.amount_paise,
      },
      studentUserId,
    )
    const verifiedAt = new Date().toISOString()
    database
      .prepare(
        `UPDATE payment_attempts
            SET status = 'paid', provider_txn_id = ?, response_code = ?,
                response_message = ?, verified_at = ?, order_id = ?,
                checkout_token = NULL, updated_at = ?
          WHERE id = ? AND order_id IS NULL`,
      )
      .run(
        String(gatewayResult.txnId || '').slice(0, 120) || null,
        gatewayResult.resultCode,
        gatewayResult.resultMessage,
        verifiedAt,
        orderResult.order.id,
        verifiedAt,
        current.id,
      )
    recordPaymentEvent(database, 'PAYMENT_CONFIRMED', studentUserId, {
      attemptId: current.public_id,
      orderId: orderResult.order.id,
      responseCode: gatewayResult.resultCode,
    })
    recordPaymentEvent(database, 'ORDER_CREATED_FROM_PAYMENT', studentUserId, {
      attemptId: current.public_id,
      orderId: orderResult.order.id,
    })
    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }

  return mapAttempt(selectAttemptByPublicId(database, row.public_id), database)
}

export async function confirmPaytmPayment(
  database,
  attemptId,
  studentUserId,
  paymentConfig,
  paytmClient,
) {
  const row = requireOwnedAttempt(database, attemptId, studentUserId)
  return refreshPaytmAttempt(
    database,
    row,
    studentUserId,
    paymentConfig,
    paytmClient,
  )
}

export async function getPaytmPaymentStatus(
  database,
  attemptId,
  studentUserId,
  paymentConfig,
  paytmClient,
) {
  const row = requireOwnedAttempt(database, attemptId, studentUserId)
  return ACTIVE_PAYMENT_STATUSES.has(row.status)
    ? refreshPaytmAttempt(
        database,
        row,
        studentUserId,
        paymentConfig,
        paytmClient,
      )
    : mapAttempt(row, database)
}

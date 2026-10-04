import {
  optionalAuth,
  requireRole,
  requireStudentPhoneVerified,
  ROLES,
} from '../services/authorization.js'
import {
  getPaymentStatus,
  handlePaymentWebhook,
  initiatePayment,
  verifyPayment,
} from '../services/payments.js'
import {
  readJsonBody,
  readRawBody,
  sendJson,
  sendMethodNotAllowed,
} from '../services/http.js'

function requireStudent(database, request, authConfig, requireVerifiedPhone) {
  const authContext = requireRole(
    database,
    optionalAuth(database, request, authConfig),
    ROLES.STUDENT,
    request,
  )
  return requireVerifiedPhone
    ? requireStudentPhoneVerified(authContext)
    : authContext
}

export async function handlePaymentRoutes(
  request,
  response,
  requestUrl,
  database,
  authConfig,
  paymentConfig,
  paymentProvider,
) {
  if (requestUrl.pathname === '/api/payments/webhook/razorpay') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return true
    }
    handlePaymentWebhook(database, await readRawBody(request),
      request.headers['x-razorpay-signature'], paymentConfig, paymentProvider)
    sendJson(response, 200, { received: true })
    return true
  }
  if (requestUrl.pathname === '/api/payments/initiate') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return true
    }
    const authContext = requireStudent(database, request, authConfig, true)
    const attempt = await initiatePayment(
      database,
      await readJsonBody(request),
      authContext.internalUserId,
      paymentConfig,
      paymentProvider,
    )
    sendJson(response, attempt.reused ? 200 : 201, { attempt })
    return true
  }

  if (requestUrl.pathname === '/api/payments/verify') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return true
    }
    const authContext = requireStudent(database, request, authConfig, true)
    const attempt = await verifyPayment(
      database,
      await readJsonBody(request),
      authContext.internalUserId,
      paymentConfig,
      paymentProvider,
    )
    sendJson(response, 200, { attempt })
    return true
  }

  const statusMatch = requestUrl.pathname.match(
    /^\/api\/payments\/([^/]+)\/status$/,
  )
  if (statusMatch) {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return true
    }
    const authContext = requireStudent(database, request, authConfig, true)
    const attempt = await getPaymentStatus(
      database,
      decodeURIComponent(statusMatch[1]),
      authContext.internalUserId,
      paymentConfig,
      paymentProvider,
    )
    sendJson(response, 200, { attempt })
    return true
  }

  return false
}

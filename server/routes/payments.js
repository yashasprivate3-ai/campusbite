import {
  optionalAuth,
  requireRole,
  requireStudentPhoneVerified,
  ROLES,
} from '../services/authorization.js'
import {
  confirmPaytmPayment,
  getPaytmPaymentStatus,
  initiatePaytmPayment,
} from '../services/payments.js'
import {
  readJsonBody,
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
  paytmClient,
) {
  if (requestUrl.pathname === '/api/payments/paytm/initiate') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return true
    }
    const authContext = requireStudent(database, request, authConfig, true)
    const attempt = await initiatePaytmPayment(
      database,
      await readJsonBody(request),
      authContext.internalUserId,
      paymentConfig,
      paytmClient,
    )
    sendJson(response, attempt.reused ? 200 : 201, { attempt })
    return true
  }

  if (requestUrl.pathname === '/api/payments/paytm/confirm') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return true
    }
    const authContext = requireStudent(database, request, authConfig, false)
    const payload = await readJsonBody(request)
    const attempt = await confirmPaytmPayment(
      database,
      payload.attemptId,
      authContext.internalUserId,
      paymentConfig,
      paytmClient,
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
    const authContext = requireStudent(database, request, authConfig, false)
    const attempt = await getPaytmPaymentStatus(
      database,
      decodeURIComponent(statusMatch[1]),
      authContext.internalUserId,
      paymentConfig,
      paytmClient,
    )
    sendJson(response, 200, { attempt })
    return true
  }

  return false
}

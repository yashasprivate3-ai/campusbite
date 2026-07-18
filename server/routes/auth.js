import {
  authenticateLocalUser,
  createClearSessionCookie,
  createSession,
  createSessionCookie,
  recordAuthEvent,
  revokeRequestSession,
} from '../services/auth.js'
import {
  optionalAuth,
  requireAuth,
  requireRole,
  ROLES,
} from '../services/authorization.js'
import {
  normalizeGoogleCredential,
  resolveGoogleStudent,
  verifyGoogleCredential,
} from '../services/googleAuth.js'
import {
  readJsonBody,
  sendJson,
  sendMethodNotAllowed,
} from '../services/http.js'
import { addFailedLoginDelay } from '../services/loginThrottle.js'
import { updateStudentPhone } from '../services/phoneProfile.js'
import {
  requestPhoneVerification,
  verifyPhoneCode,
} from '../services/phoneVerification.js'

export async function handleAuthRoutes(
  request,
  response,
  requestUrl,
  database,
  authConfig,
  loginThrottle,
  phoneVerificationProvider,
) {
  if (requestUrl.pathname === '/api/auth/login') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return true
    }

    const payload = await readJsonBody(request)
    const throttleKey = loginThrottle.assertAllowed(
      request,
      payload?.identifier,
    )

    try {
      const authenticated = authenticateLocalUser(database, payload, authConfig)
      const session = createSession(
        database,
        authenticated.internalUserId,
        request,
        authConfig,
      )
      loginThrottle.reset(throttleKey)
      response.setHeader(
        'Set-Cookie',
        createSessionCookie(session.rawToken, session.expiresAt, authConfig),
      )
      sendJson(response, 200, { user: authenticated.user })
      return true
    } catch (error) {
      if (
        error.code === 'invalid_credentials' ||
        error.code === 'account_disabled'
      ) {
        loginThrottle.recordFailure(throttleKey)
        await addFailedLoginDelay()
      }
      throw error
    }
  }

  if (requestUrl.pathname === '/api/auth/logout') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return true
    }

    revokeRequestSession(database, request, authConfig)
    response.setHeader('Set-Cookie', createClearSessionCookie(authConfig))
    sendJson(response, 200, { status: 'ok' })
    return true
  }

  if (requestUrl.pathname === '/api/auth/google') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return true
    }

    const throttleKey = loginThrottle.assertAllowed(request, 'google')

    try {
      const credential = normalizeGoogleCredential(await readJsonBody(request))
      const verifiedIdentity = await verifyGoogleCredential(
        credential,
        authConfig.google,
      )
      const authenticated = resolveGoogleStudent(database, verifiedIdentity)
      const session = createSession(
        database,
        authenticated.internalUserId,
        request,
        authConfig,
        { provider: 'GOOGLE', successEvent: 'GOOGLE_LOGIN_SUCCEEDED' },
      )

      loginThrottle.reset(throttleKey)
      response.setHeader(
        'Set-Cookie',
        createSessionCookie(session.rawToken, session.expiresAt, authConfig),
      )
      sendJson(response, 200, {
        onboardingRequired: authenticated.user.onboardingRequired,
        user: authenticated.user,
      })
      return true
    } catch (error) {
      if (
        error.code === 'invalid_request' ||
        error.code === 'google_authentication_failed'
      ) {
        loginThrottle.recordFailure(throttleKey)
        recordAuthEvent(database, {
          eventType: 'GOOGLE_LOGIN_FAILED',
          success: false,
          metadata: {
            provider: 'GOOGLE',
            reason: error.auditReason || error.code,
          },
        })
        await addFailedLoginDelay()
      }
      throw error
    }
  }

  if (requestUrl.pathname === '/api/auth/profile/phone') {
    if (request.method !== 'PATCH') {
      sendMethodNotAllowed(response, ['PATCH'])
      return true
    }

    const authContext = requireRole(
      database,
      optionalAuth(database, request, authConfig),
      ROLES.STUDENT,
      request,
    )
    const user = updateStudentPhone(
      database,
      authContext.internalUserId,
      await readJsonBody(request),
    )
    sendJson(response, 200, {
      onboardingRequired: user.onboardingRequired,
      user,
    })
    return true
  }

  if (requestUrl.pathname === '/api/auth/phone-verification/request') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return true
    }

    const authContext = requireRole(
      database,
      optionalAuth(database, request, authConfig),
      ROLES.STUDENT,
      request,
    )
    const challenge = await requestPhoneVerification(
      database,
      authContext.internalUserId,
      request,
      authConfig.otp,
      phoneVerificationProvider,
    )
    sendJson(response, 201, challenge)
    return true
  }

  if (requestUrl.pathname === '/api/auth/phone-verification/verify') {
    if (request.method !== 'POST') {
      sendMethodNotAllowed(response, ['POST'])
      return true
    }

    const authContext = requireRole(
      database,
      optionalAuth(database, request, authConfig),
      ROLES.STUDENT,
      request,
    )
    const result = verifyPhoneCode(
      database,
      authContext.internalUserId,
      await readJsonBody(request),
      authConfig.otp,
    )
    sendJson(response, 200, result)
    return true
  }

  if (requestUrl.pathname === '/api/auth/me') {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return true
    }

    const authContext = requireAuth(
      optionalAuth(database, request, authConfig),
    )
    sendJson(response, 200, { user: authContext.user })
    return true
  }

  return false
}

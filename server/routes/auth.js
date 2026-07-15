import {
  authenticateLocalUser,
  createClearSessionCookie,
  createSession,
  createSessionCookie,
  revokeRequestSession,
} from '../services/auth.js'
import { optionalAuth, requireAuth } from '../services/authorization.js'
import {
  readJsonBody,
  sendJson,
  sendMethodNotAllowed,
} from '../services/http.js'
import { addFailedLoginDelay } from '../services/loginThrottle.js'

export async function handleAuthRoutes(
  request,
  response,
  requestUrl,
  database,
  authConfig,
  loginThrottle,
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

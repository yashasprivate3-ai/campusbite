import { ApiError } from './apiError.js'
import { recordAuthEvent, resolveSession } from './auth.js'

export const ROLES = Object.freeze({
  KITCHEN: 'KITCHEN',
  OWNER: 'OWNER',
  STUDENT: 'STUDENT',
})

const forbiddenAuditTimes = new Map()

export function optionalAuth(database, request, authConfig) {
  return resolveSession(database, request, authConfig)
}

export function requireAuth(authContext) {
  if (!authContext) {
    throw new ApiError(
      401,
      'authentication_required',
      'Sign in to continue.',
    )
  }

  return authContext
}

function recordForbiddenAccess(database, authContext, request) {
  const path = String(request.url || '/').split('?')[0].slice(0, 160)
  const method = String(request.method || 'UNKNOWN').slice(0, 12)
  const key = `${authContext.internalUserId}|${method}|${path}`
  const now = Date.now()
  const lastRecorded = forbiddenAuditTimes.get(key) || 0

  if (now - lastRecorded < 60_000) return

  forbiddenAuditTimes.set(key, now)
  recordAuthEvent(database, {
    eventType: 'FORBIDDEN_ACCESS',
    success: false,
    userId: authContext.internalUserId,
    metadata: { method, path, role: authContext.user.role },
  })

  if (forbiddenAuditTimes.size > 1000) {
    for (const [candidateKey, recordedAt] of forbiddenAuditTimes) {
      if (now - recordedAt >= 60_000) forbiddenAuditTimes.delete(candidateKey)
    }
  }
}

export function requireAnyRole(
  database,
  authContext,
  roles,
  request,
) {
  const authenticated = requireAuth(authContext)

  if (!roles.includes(authenticated.user.role)) {
    recordForbiddenAccess(database, authenticated, request)
    throw new ApiError(
      403,
      'forbidden',
      'Your account cannot access this resource.',
    )
  }

  return authenticated
}

export function requireRole(database, authContext, role, request) {
  return requireAnyRole(database, authContext, [role], request)
}

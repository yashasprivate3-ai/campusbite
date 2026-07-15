import { createHash, randomBytes } from 'node:crypto'
import { ApiError, invalidRequest } from './apiError.js'
import { hashPassword, verifyPassword } from './passwords.js'

const DUMMY_PASSWORD_HASH = hashPassword('CampusBite-unavailable-account')

function hashValue(value) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeTimestamp(timestamp) {
  if (!timestamp) return null
  const value = String(timestamp)
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  const isoValue = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(hasTimeZone ? isoValue : `${isoValue}Z`)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function normalizeLoginIdentifier(value) {
  if (typeof value !== 'string') {
    throw invalidRequest('Login identifier must be a string.')
  }

  const identifier = value.trim().toLowerCase()

  if (identifier.length < 3 || identifier.length > 160 || /[\r\n]/.test(identifier)) {
    throw invalidRequest('Enter a valid login identifier.')
  }

  return identifier
}

function normalizeLoginPassword(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw invalidRequest('Enter a valid password.')
  }

  return value
}

function mapSafeUser(row) {
  return {
    publicId: row.public_id,
    role: row.role,
    displayName: row.display_name,
    email: row.email,
    phoneNumber: row.phone_number,
    phoneVerified: Boolean(row.phone_verified),
    status: row.status,
    createdAt: normalizeTimestamp(row.user_created_at),
    updatedAt: normalizeTimestamp(row.user_updated_at),
  }
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) =>
        ['string', 'number', 'boolean'].includes(typeof value),
      )
      .map(([key, value]) => [key.slice(0, 80), String(value).slice(0, 240)]),
  )
}

export function recordAuthEvent(
  database,
  { eventType, metadata = {}, success, userId = null },
) {
  database
    .prepare(
      `INSERT INTO auth_events (user_id, event_type, success, metadata_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      userId,
      String(eventType).slice(0, 80),
      success ? 1 : 0,
      JSON.stringify(sanitizeMetadata(metadata)),
    )
}

function findLocalIdentity(database, identifier) {
  return database
    .prepare(
      `SELECT ai.id AS identity_id, ai.password_hash,
              u.id AS user_id, u.public_id, u.role, u.display_name,
              u.email, u.phone_number, u.phone_verified, u.status,
              u.created_at AS user_created_at,
              u.updated_at AS user_updated_at
         FROM auth_identities ai
         JOIN users u ON u.id = ai.user_id
        WHERE ai.provider = 'LOCAL'
          AND lower(ai.login_identifier) = ?`,
    )
    .get(identifier)
}

export function authenticateLocalUser(database, payload, authConfig) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidRequest('Request body must be an object.')
  }

  const identifier = normalizeLoginIdentifier(payload.identifier)
  const password = normalizeLoginPassword(payload.password)
  const identity = findLocalIdentity(database, identifier)
  const passwordMatches = verifyPassword(
    password,
    identity?.password_hash || DUMMY_PASSWORD_HASH,
  )
  const identifierHash = hashValue(identifier).slice(0, 16)

  if (
    !identity ||
    !passwordMatches ||
    (identity.role === 'STUDENT' && !authConfig.developmentAccountsEnabled)
  ) {
    recordAuthEvent(database, {
      eventType: 'LOGIN_FAILED',
      success: false,
      userId: identity?.user_id || null,
      metadata: { identifierHash, provider: 'LOCAL' },
    })
    throw new ApiError(
      401,
      'invalid_credentials',
      'Login identifier or password is incorrect.',
    )
  }

  if (identity.status === 'DISABLED') {
    recordAuthEvent(database, {
      eventType: 'DISABLED_ACCOUNT_LOGIN_ATTEMPT',
      success: false,
      userId: identity.user_id,
      metadata: { provider: 'LOCAL', role: identity.role },
    })
    throw new ApiError(
      403,
      'account_disabled',
      'This account is disabled. Contact the CampusBite owner.',
    )
  }

  return {
    internalUserId: identity.user_id,
    user: mapSafeUser(identity),
  }
}

function readCookie(request, cookieName) {
  const cookieHeader = request.headers.cookie
  if (!cookieHeader) return null

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    const name = part.slice(0, separator).trim()
    if (name !== cookieName) continue

    const value = part.slice(separator + 1).trim()
    return /^[A-Za-z0-9_-]{40,100}$/.test(value) ? value : null
  }

  return null
}

function getRequestMetadata(request) {
  const userAgent = String(request.headers['user-agent'] || '')
    .split('')
    .filter((character) => {
      const codePoint = character.charCodeAt(0)
      return codePoint > 31 && codePoint !== 127
    })
    .join('')
    .slice(0, 256)
  const createdIp = String(request.socket.remoteAddress || '').slice(0, 64)
  return { createdIp: createdIp || null, userAgent: userAgent || null }
}

export function createSession(database, internalUserId, request, authConfig) {
  const rawToken = randomBytes(32).toString('base64url')
  const tokenHash = hashValue(rawToken)
  const createdAt = new Date()
  const expiresAt = new Date(
    createdAt.getTime() + authConfig.sessionTtlHours * 60 * 60 * 1000,
  )
  const metadata = getRequestMetadata(request)

  database.exec('BEGIN IMMEDIATE;')

  try {
    database
      .prepare(
        `INSERT INTO sessions (
           user_id, token_hash, created_at, expires_at, last_used_at,
           user_agent, created_ip
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        internalUserId,
        tokenHash,
        createdAt.toISOString(),
        expiresAt.toISOString(),
        createdAt.toISOString(),
        metadata.userAgent,
        metadata.createdIp,
      )

    recordAuthEvent(database, {
      eventType: 'LOGIN_SUCCEEDED',
      success: true,
      userId: internalUserId,
      metadata: { provider: 'LOCAL' },
    })
    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }

  return { rawToken, expiresAt }
}

export function createSessionCookie(rawToken, expiresAt, authConfig) {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  )
  const attributes = [
    `${authConfig.cookieName}=${rawToken}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api',
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${expiresAt.toUTCString()}`,
  ]

  if (authConfig.cookieSecure) attributes.push('Secure')
  return attributes.join('; ')
}

export function createClearSessionCookie(authConfig) {
  const attributes = [
    `${authConfig.cookieName}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]

  if (authConfig.cookieSecure) attributes.push('Secure')
  return attributes.join('; ')
}

function findSession(database, tokenHash) {
  return database
    .prepare(
      `SELECT s.id AS session_id, s.user_id, s.expires_at, s.last_used_at,
              s.revoked_at, u.public_id, u.role, u.display_name, u.email,
              u.phone_number, u.phone_verified, u.status,
              u.created_at AS user_created_at,
              u.updated_at AS user_updated_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(tokenHash)
}

function revokeInvalidSession(database, session, eventType, metadata) {
  database.exec('BEGIN IMMEDIATE;')

  try {
    const result = database
      .prepare(
        `UPDATE sessions
            SET revoked_at = CURRENT_TIMESTAMP
          WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(session.session_id)

    if (result.changes > 0) {
      recordAuthEvent(database, {
        eventType,
        success: false,
        userId: session.user_id,
        metadata,
      })
    }
    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }
}

export function resolveSession(database, request, authConfig) {
  const rawToken = readCookie(request, authConfig.cookieName)
  if (!rawToken) return null

  const session = findSession(database, hashValue(rawToken))
  if (!session || session.revoked_at) return null

  const now = new Date()
  const expiresAt = new Date(session.expires_at)

  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    revokeInvalidSession(database, session, 'SESSION_EXPIRED', {
      reason: 'expired',
    })
    return null
  }

  if (session.status !== 'ACTIVE') {
    revokeInvalidSession(database, session, 'SESSION_REVOKED', {
      reason: 'account_disabled',
    })
    return null
  }

  const lastUsedAt = new Date(session.last_used_at)
  const touchAfterMilliseconds = authConfig.sessionTouchMinutes * 60 * 1000

  if (
    Number.isNaN(lastUsedAt.getTime()) ||
    now.getTime() - lastUsedAt.getTime() >= touchAfterMilliseconds
  ) {
    database
      .prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?')
      .run(now.toISOString(), session.session_id)
  }

  return {
    internalUserId: session.user_id,
    sessionId: session.session_id,
    user: mapSafeUser(session),
  }
}

export function revokeRequestSession(database, request, authConfig) {
  const rawToken = readCookie(request, authConfig.cookieName)
  if (!rawToken) return false

  const session = findSession(database, hashValue(rawToken))
  if (!session || session.revoked_at) return false

  database.exec('BEGIN IMMEDIATE;')

  try {
    const result = database
      .prepare(
        `UPDATE sessions
            SET revoked_at = CURRENT_TIMESTAMP
          WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(session.session_id)

    if (result.changes > 0) {
      recordAuthEvent(database, {
        eventType: 'LOGOUT',
        success: true,
        userId: session.user_id,
        metadata: { reason: 'user_logout' },
      })
      database.exec('COMMIT;')
      return true
    }

    database.exec('COMMIT;')
    return false
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }
}

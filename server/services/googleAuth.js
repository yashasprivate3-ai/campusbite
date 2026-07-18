import { randomUUID } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'
import { ApiError, invalidRequest } from './apiError.js'
import { getSafeUserById, recordAuthEvent } from './auth.js'

const GOOGLE_ISSUERS = new Set([
  'accounts.google.com',
  'https://accounts.google.com',
])
const googleClient = new OAuth2Client()

function googleAuthenticationFailure(reason) {
  const error = new ApiError(
    401,
    'google_authentication_failed',
    'Google sign-in could not be verified. Please try again.',
  )
  error.auditReason = reason
  return error
}

function googleIdentityConflict(database, userId = null) {
  recordAuthEvent(database, {
    eventType: 'GOOGLE_IDENTITY_CONFLICT',
    success: false,
    userId,
    metadata: { provider: 'GOOGLE' },
  })
  throw new ApiError(
    409,
    'google_identity_conflict',
    'This Google account cannot be linked automatically. Contact the CampusBite owner.',
  )
}

function normalizePictureUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null

  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export function normalizeGoogleCredential(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidRequest('Request body must be an object.')
  }

  if (typeof payload.credential !== 'string' || !payload.credential.trim()) {
    throw invalidRequest('Google credential is required.')
  }

  const credential = payload.credential.trim()
  if (credential.length > 20_000 || credential.split('.').length !== 3) {
    const error = invalidRequest('Google credential is malformed.')
    error.auditReason = 'malformed_credential'
    throw error
  }

  return credential
}

function ensureGoogleConfigured(googleConfig) {
  if (!googleConfig?.configured) {
    throw new ApiError(
      503,
      'google_not_configured',
      'Google sign-in requires local configuration. Owner and Kitchen login remain available.',
    )
  }
}

export function validateVerifiedGoogleClaims(payload, expectedAudience) {
  const nowInSeconds = Math.floor(Date.now() / 1000)
  const audienceMatches = Array.isArray(payload?.aud)
    ? payload.aud.includes(expectedAudience)
    : payload?.aud === expectedAudience

  if (!audienceMatches) throw googleAuthenticationFailure('wrong_audience')
  if (!GOOGLE_ISSUERS.has(payload?.iss)) {
    throw googleAuthenticationFailure('invalid_issuer')
  }
  if (!Number.isFinite(Number(payload?.exp)) || Number(payload.exp) <= nowInSeconds) {
    throw googleAuthenticationFailure('expired_token')
  }
  if (typeof payload?.sub !== 'string' || !payload.sub || payload.sub.length > 255) {
    throw googleAuthenticationFailure('missing_subject')
  }
  if (
    typeof payload?.email !== 'string' ||
    !payload.email.includes('@') ||
    payload.email.length > 320
  ) {
    throw googleAuthenticationFailure('missing_email')
  }
  if (payload.email_verified !== true) {
    throw googleAuthenticationFailure('unverified_email')
  }

  const email = payload.email.trim().toLowerCase()
  const displayName =
    typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim().slice(0, 120)
      : email.split('@')[0].slice(0, 120)

  return {
    displayName,
    email,
    pictureUrl: normalizePictureUrl(payload.picture),
    subject: payload.sub,
  }
}

export async function verifyGoogleCredential(
  credential,
  googleConfig,
  verificationClient = googleClient,
) {
  ensureGoogleConfigured(googleConfig)

  let ticket
  try {
    ticket = await verificationClient.verifyIdToken({
      audience: googleConfig.clientId,
      idToken: credential,
    })
  } catch {
    throw googleAuthenticationFailure('verification_failed')
  }

  return validateVerifiedGoogleClaims(
    ticket.getPayload(),
    googleConfig.clientId,
  )
}

function findGoogleIdentity(database, subject) {
  return database
    .prepare(
      `SELECT ai.id AS identity_id, u.id AS user_id, u.role, u.status
         FROM auth_identities ai
         JOIN users u ON u.id = ai.user_id
        WHERE ai.provider = 'GOOGLE' AND ai.provider_subject = ?`,
    )
    .get(subject)
}

function findUserByEmail(database, email, excludedUserId = null) {
  return excludedUserId === null
    ? database.prepare('SELECT id, role FROM users WHERE lower(email) = ?').get(email)
    : database
        .prepare('SELECT id, role FROM users WHERE lower(email) = ? AND id != ?')
        .get(email, excludedUserId)
}

export function resolveGoogleStudent(database, verifiedIdentity) {
  const identity = findGoogleIdentity(database, verifiedIdentity.subject)
  const loginTime = new Date().toISOString()

  if (identity) {
    if (identity.role !== 'STUDENT') {
      googleIdentityConflict(database, identity.user_id)
    }
    if (identity.status !== 'ACTIVE') {
      recordAuthEvent(database, {
        eventType: 'GOOGLE_LOGIN_FAILED',
        success: false,
        userId: identity.user_id,
        metadata: { provider: 'GOOGLE', reason: 'account_disabled' },
      })
      throw new ApiError(
        403,
        'account_disabled',
        'This account is disabled. Contact the CampusBite owner.',
      )
    }
    if (findUserByEmail(database, verifiedIdentity.email, identity.user_id)) {
      googleIdentityConflict(database, identity.user_id)
    }

    database.exec('BEGIN IMMEDIATE;')
    try {
      database
        .prepare(
          `UPDATE users
              SET display_name = ?, email = ?, email_verified = 1,
                  profile_picture_url = ?, last_login_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          verifiedIdentity.displayName,
          verifiedIdentity.email,
          verifiedIdentity.pictureUrl,
          loginTime,
          loginTime,
          identity.user_id,
        )
      database
        .prepare(
          `UPDATE auth_identities
              SET last_used_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(loginTime, loginTime, identity.identity_id)
      database.exec('COMMIT;')
    } catch (error) {
      database.exec('ROLLBACK;')
      throw error
    }

    const user = getSafeUserById(database, identity.user_id)
    return { created: false, internalUserId: identity.user_id, user }
  }

  const conflictingUser = findUserByEmail(database, verifiedIdentity.email)
  if (conflictingUser) googleIdentityConflict(database, conflictingUser.id)

  database.exec('BEGIN IMMEDIATE;')
  try {
    const userResult = database
      .prepare(
        `INSERT INTO users (
           public_id, role, display_name, email, phone_verified,
           profile_picture_url, email_verified, status, last_login_at
         ) VALUES (?, 'STUDENT', ?, ?, 0, ?, 1, 'ACTIVE', ?)`,
      )
      .run(
        `usr_${randomUUID()}`,
        verifiedIdentity.displayName,
        verifiedIdentity.email,
        verifiedIdentity.pictureUrl,
        loginTime,
      )
    const userId = Number(userResult.lastInsertRowid)

    database
      .prepare(
        `INSERT INTO auth_identities (
           user_id, provider, provider_subject, last_used_at
         ) VALUES (?, 'GOOGLE', ?, ?)`,
      )
      .run(userId, verifiedIdentity.subject, loginTime)
    recordAuthEvent(database, {
      eventType: 'GOOGLE_ACCOUNT_CREATED',
      success: true,
      userId,
      metadata: { provider: 'GOOGLE', role: 'STUDENT' },
    })
    database.exec('COMMIT;')

    const user = getSafeUserById(database, userId)
    return { created: true, internalUserId: userId, user }
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }
}

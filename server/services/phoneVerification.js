import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { isIP } from 'node:net'
import { ApiError, invalidRequest } from './apiError.js'
import { getSafeUserById, recordAuthEvent } from './auth.js'

function maskPhoneNumber(phoneNumber) {
  return `${phoneNumber.slice(0, 3)}******${phoneNumber.slice(-4)}`
}

function createHmacHex(secret, value) {
  return createHmac('sha256', secret).update(value).digest('hex')
}

function hashOtp(config, challengeId, userId, phoneNumber, code) {
  return createHmacHex(
    config.hashSecret,
    `${challengeId}:${userId}:${phoneNumber}:${code}`,
  )
}

function getRequestIpHash(request, config) {
  const forwardedAddress = String(
    request.headers?.['x-vercel-forwarded-for'] || '',
  )
    .split(',')[0]
    .trim()
  const address = (
    isIP(forwardedAddress)
      ? forwardedAddress
      : String(request.socket.remoteAddress || 'unknown')
  ).slice(0, 128)
  return createHmacHex(config.hashSecret, `ip:${address}`)
}

function normalizeOtp(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidRequest('Request body must be an object.')
  }

  if (typeof payload.code !== 'string' || !/^\d{6}$/.test(payload.code)) {
    throw new ApiError(
      400,
      'otp_invalid_format',
      'Enter the six-digit verification code.',
    )
  }

  return payload.code
}

function normalizeMsg91AccessToken(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidRequest('Request body must be an object.')
  }

  if (
    typeof payload.accessToken !== 'string' ||
    !payload.accessToken.trim() ||
    payload.accessToken.length > 8192
  ) {
    throw new ApiError(400, 'msg91_access_token_invalid', 'MSG91 verification could not be completed.')
  }

  return payload.accessToken.trim()
}

function getStudentPhone(database, userId) {
  return database
    .prepare(
      `SELECT phone_number, phone_verified
         FROM users
        WHERE id = ? AND role = 'STUDENT' AND status = 'ACTIVE'`,
    )
    .get(userId)
}

function requireStudentPhone(database, userId) {
  const student = getStudentPhone(database, userId)

  if (!student?.phone_number) {
    throw new ApiError(
      403,
      'phone_onboarding_required',
      'Add your phone number before requesting verification.',
    )
  }

  return student
}

function recordFailure(database, userId, reason, phoneNumber, extra = {}) {
  recordAuthEvent(database, {
    eventType: 'PHONE_VERIFICATION_FAILED',
    success: false,
    userId,
    metadata: {
      maskedPhone: maskPhoneNumber(phoneNumber),
      reason,
      ...extra,
    },
  })
}

function latestChallenge(database, userId) {
  return database
    .prepare(
      `SELECT *
         FROM phone_verification_challenges
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
    )
    .get(userId)
}

function countRecentRequests(
  database,
  whereClause,
  values,
  cutoff,
  table = 'phone_verification_challenges',
) {
  return Number(
    database
      .prepare(
        `SELECT COUNT(*) AS count
           FROM ${table}
          WHERE ${whereClause} AND created_at >= ?`,
      )
      .get(...values, cutoff).count,
  )
}

function createRateLimitError(database, userId, phoneNumber, dimension) {
  recordAuthEvent(database, {
    eventType: 'PHONE_VERIFICATION_RATE_LIMITED',
    success: false,
    userId,
    metadata: {
      dimension,
      maskedPhone: maskPhoneNumber(phoneNumber),
    },
  })
  return new ApiError(
    429,
    'otp_rate_limit_reached',
    'Too many verification requests. Please try again later.',
  )
}

function throwRateLimit(database, userId, phoneNumber, dimension) {
  throw createRateLimitError(database, userId, phoneNumber, dimension)
}

export async function requestPhoneVerification(
  database,
  userId,
  request,
  config,
  provider,
) {
  if (provider.name === 'msg91') {
    throw new ApiError(
      409,
      'msg91_widget_required',
      'Complete phone verification through the MSG91 verification flow.',
    )
  }

  const student = requireStudentPhone(database, userId)
  const phoneNumber = student.phone_number

  if (student.phone_verified) {
    throw new ApiError(
      409,
      'phone_already_verified',
      'This phone number is already verified.',
    )
  }

  const now = new Date()
  const previous = latestChallenge(database, userId)

  if (
    previous &&
    previous.phone_number === phoneNumber &&
    !previous.consumed_at &&
    new Date(previous.resend_available_at) > now
  ) {
    recordFailure(database, userId, 'cooldown_active', phoneNumber)
    throw new ApiError(
      429,
      'otp_cooldown_active',
      'Please wait before requesting another verification code.',
      { resendAvailableAt: previous.resend_available_at },
    )
  }

  const requestIpHash = getRequestIpHash(request, config)
  const cutoff = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const userPhoneCount = countRecentRequests(
    database,
    'user_id = ? AND phone_number = ?',
    [userId, phoneNumber],
    cutoff,
  )
  if (userPhoneCount >= config.userPhoneRequestsPerHour) {
    throwRateLimit(database, userId, phoneNumber, 'user_phone')
  }

  const ipCount = countRecentRequests(
    database,
    'request_ip_hash = ?',
    [requestIpHash],
    cutoff,
  )
  if (ipCount >= config.ipRequestsPerHour) {
    throwRateLimit(database, userId, phoneNumber, 'ip')
  }

  const challengeId = randomUUID()
  const expiresAt = new Date(
    now.getTime() + config.expiresMinutes * 60 * 1000,
  )
  const resendAvailableAt = new Date(
    now.getTime() + config.resendCooldownSeconds * 1000,
  )
  const code =
    provider.name === 'development'
      ? config.developmentCode
      : String(randomInt(0, 1_000_000)).padStart(6, '0')
  const otpHash = hashOtp(config, challengeId, userId, phoneNumber, code)

  database.exec('BEGIN IMMEDIATE;')
  try {
    database
      .prepare(
        `UPDATE phone_verification_challenges
            SET invalidated_at = ?, updated_at = ?
          WHERE user_id = ? AND consumed_at IS NULL AND invalidated_at IS NULL`,
      )
      .run(now.toISOString(), now.toISOString(), userId)
    database
      .prepare(
        `INSERT INTO phone_verification_challenges (
           public_id, user_id, phone_number, otp_hash, provider,
           expires_at, resend_available_at, request_ip_hash,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        challengeId,
        userId,
        phoneNumber,
        otpHash,
        provider.name,
        expiresAt.toISOString(),
        resendAvailableAt.toISOString(),
        requestIpHash,
        now.toISOString(),
        now.toISOString(),
      )
    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }

  let deliveryResult
  try {
    deliveryResult = await provider.deliver({ code, phoneNumber })
  } catch (error) {
    const failedAt = new Date().toISOString()
    database
      .prepare(
        `UPDATE phone_verification_challenges
            SET invalidated_at = ?, updated_at = ?
          WHERE public_id = ? AND invalidated_at IS NULL`,
      )
      .run(failedAt, failedAt, challengeId)
    recordFailure(database, userId, 'delivery_failed', phoneNumber, {
      provider: provider.name,
    })
    throw error
  }

  recordAuthEvent(database, {
    eventType: 'PHONE_VERIFICATION_REQUESTED',
    success: true,
    userId,
    metadata: {
      challengeId,
      maskedPhone: maskPhoneNumber(phoneNumber),
      provider: provider.name,
      ...(deliveryResult?.audit?.templateName
        ? { templateName: deliveryResult.audit.templateName }
        : {}),
    },
  })

  return {
    challengeCreated: true,
    expiresAt: expiresAt.toISOString(),
    maskedPhone: maskPhoneNumber(phoneNumber),
    provider: provider.name,
    resendAvailableAt: resendAvailableAt.toISOString(),
  }
}

export function requestMsg91PhoneVerification(
  database,
  userId,
  request,
  config,
  provider,
) {
  if (provider?.name !== 'msg91') {
    throw new ApiError(
      409,
      'msg91_not_configured',
      'MSG91 phone verification is not configured.',
    )
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const cutoff = new Date(
    now.getTime() - 60 * 60 * 1000,
  ).toISOString()
  const requestIpHash = getRequestIpHash(request, config)
  const expiresAt = new Date(
    now.getTime() + config.expiresMinutes * 60 * 1000,
  ).toISOString()
  const resendAvailableAt = new Date(
    now.getTime() + config.resendCooldownSeconds * 1000,
  ).toISOString()
  let outcome
  let phoneNumber

  database.exec('BEGIN IMMEDIATE;')
  try {
    const student = requireStudentPhone(database, userId)
    phoneNumber = student.phone_number
    database
      .prepare('DELETE FROM msg91_otp_requests WHERE created_at < ?')
      .run(cutoff)
    if (student.phone_verified) {
      outcome = new ApiError(
        409,
        'phone_already_verified',
        'This phone number is already verified.',
      )
    } else {
      const previous = database
        .prepare(
          `SELECT resend_available_at
             FROM msg91_otp_requests
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 1`,
        )
        .get(userId)

      if (previous && new Date(previous.resend_available_at) > now) {
        recordFailure(database, userId, 'cooldown_active', student.phone_number, {
          provider: 'msg91',
        })
        outcome = new ApiError(
          429,
          'otp_cooldown_active',
          'Please wait before requesting another verification code.',
          { resendAvailableAt: previous.resend_available_at },
        )
      } else {
        const accountRequests = countRecentRequests(
          database,
          'user_id = ?',
          [userId],
          cutoff,
          'msg91_otp_requests',
        )
        const phoneRequests = countRecentRequests(
          database,
          'phone_number = ?',
          [student.phone_number],
          cutoff,
          'msg91_otp_requests',
        )
        const ipRequests = countRecentRequests(
          database,
          'request_ip_hash = ?',
          [requestIpHash],
          cutoff,
          'msg91_otp_requests',
        )

        if (
          accountRequests >= config.userPhoneRequestsPerHour ||
          phoneRequests >= config.userPhoneRequestsPerHour
        ) {
          outcome = createRateLimitError(
            database,
            userId,
            student.phone_number,
            accountRequests >= config.userPhoneRequestsPerHour
              ? 'account'
              : 'phone',
          )
        } else if (ipRequests >= config.ipRequestsPerHour) {
          outcome = createRateLimitError(
            database,
            userId,
            student.phone_number,
            'ip',
          )
        } else {
          database
            .prepare(
              `INSERT INTO msg91_otp_requests (
                 user_id, phone_number, request_ip_hash, created_at,
                 resend_available_at, expires_at
               ) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              userId,
              student.phone_number,
              requestIpHash,
              nowIso,
              resendAvailableAt,
              expiresAt,
            )
          recordAuthEvent(database, {
            eventType: 'PHONE_VERIFICATION_REQUESTED',
            success: true,
            userId,
            metadata: {
              maskedPhone: maskPhoneNumber(student.phone_number),
              provider: 'msg91',
            },
          })
        }
      }
    }

    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }

  if (outcome) throw outcome

  return {
    expiresAt,
    maskedPhone: maskPhoneNumber(phoneNumber),
    provider: 'msg91',
    requestAuthorized: true,
    resendAvailableAt,
  }
}

function safeOtpMatch(expectedHash, candidateHash) {
  const expected = Buffer.from(String(expectedHash), 'hex')
  const candidate = Buffer.from(String(candidateHash), 'hex')
  return expected.length === candidate.length && timingSafeEqual(expected, candidate)
}

export function verifyPhoneCode(database, userId, payload, config) {
  const student = requireStudentPhone(database, userId)
  const phoneNumber = student.phone_number
  let code

  try {
    code = normalizeOtp(payload)
  } catch (error) {
    recordFailure(database, userId, 'invalid_format', phoneNumber)
    throw error
  }

  const now = new Date()
  let outcome

  database.exec('BEGIN IMMEDIATE;')
  try {
    const challenge = latestChallenge(database, userId)

    if (!challenge) {
      recordFailure(database, userId, 'challenge_not_found', phoneNumber)
      outcome = {
        error: new ApiError(
          404,
          'otp_challenge_not_found',
          'Request a verification code before trying to verify.',
        ),
      }
    } else if (challenge.phone_number !== phoneNumber) {
      recordFailure(database, userId, 'phone_changed', phoneNumber)
      outcome = {
        error: new ApiError(
          409,
          'otp_phone_changed',
          'Your phone number changed. Request a new verification code.',
        ),
      }
    } else if (challenge.consumed_at) {
      recordFailure(database, userId, 'already_consumed', phoneNumber)
      outcome = {
        error: new ApiError(
          409,
          'otp_already_consumed',
          'This verification code has already been used.',
        ),
      }
    } else if (challenge.invalidated_at) {
      const attemptLimitReached = challenge.failed_attempts >= config.maxAttempts
      recordFailure(
        database,
        userId,
        attemptLimitReached ? 'attempt_limit_reached' : 'challenge_invalidated',
        phoneNumber,
      )
      outcome = {
        error: new ApiError(
          429,
          attemptLimitReached
            ? 'otp_attempt_limit_reached'
            : 'otp_challenge_invalidated',
          attemptLimitReached
            ? 'Too many incorrect attempts. Request a new verification code.'
            : 'This verification code is no longer active. Request a new code.',
        ),
      }
    } else if (new Date(challenge.expires_at) <= now) {
      database
        .prepare(
          `UPDATE phone_verification_challenges
              SET invalidated_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(now.toISOString(), now.toISOString(), challenge.id)
      recordFailure(database, userId, 'expired', phoneNumber)
      outcome = {
        error: new ApiError(
          410,
          'otp_expired',
          'This verification code has expired. Request a new code.',
        ),
      }
    } else {
      const candidateHash = hashOtp(
        config,
        challenge.public_id,
        userId,
        phoneNumber,
        code,
      )

      if (!safeOtpMatch(challenge.otp_hash, candidateHash)) {
        const failedAttempts = challenge.failed_attempts + 1
        const attemptsRemaining = Math.max(0, config.maxAttempts - failedAttempts)
        database
          .prepare(
            `UPDATE phone_verification_challenges
                SET failed_attempts = ?,
                    invalidated_at = CASE WHEN ? = 0 THEN ? ELSE invalidated_at END,
                    updated_at = ?
              WHERE id = ?`,
          )
          .run(
            failedAttempts,
            attemptsRemaining,
            now.toISOString(),
            now.toISOString(),
            challenge.id,
          )
        recordFailure(database, userId, 'incorrect_code', phoneNumber, {
          attemptsRemaining,
        })
        outcome = {
          error: new ApiError(
            attemptsRemaining === 0 ? 429 : 400,
            attemptsRemaining === 0
              ? 'otp_attempt_limit_reached'
              : 'otp_incorrect',
            attemptsRemaining === 0
              ? 'Too many incorrect attempts. Request a new verification code.'
              : 'The verification code is incorrect.',
            { attemptsRemaining },
          ),
        }
      } else {
        const duplicate = database
          .prepare(
            `SELECT id
               FROM users
              WHERE phone_number = ? AND phone_verified = 1 AND id != ?
              LIMIT 1`,
          )
          .get(phoneNumber, userId)

        if (duplicate) {
          recordFailure(database, userId, 'phone_unavailable', phoneNumber)
          outcome = {
            error: new ApiError(
              409,
              'phone_unavailable',
              'This phone number cannot be verified for this account.',
            ),
          }
        } else {
          database
            .prepare(
              `UPDATE users
                  SET phone_verified = 1, phone_verified_at = ?, updated_at = ?
                WHERE id = ? AND phone_number = ?`,
            )
            .run(now.toISOString(), now.toISOString(), userId, phoneNumber)
          database
            .prepare(
              `UPDATE phone_verification_challenges
                  SET consumed_at = ?, updated_at = ?
                WHERE id = ?`,
            )
            .run(now.toISOString(), now.toISOString(), challenge.id)
          database
            .prepare(
              `UPDATE phone_verification_challenges
                  SET invalidated_at = ?, updated_at = ?
                WHERE user_id = ? AND id != ?
                  AND consumed_at IS NULL AND invalidated_at IS NULL`,
            )
            .run(now.toISOString(), now.toISOString(), userId, challenge.id)
          recordAuthEvent(database, {
            eventType: 'PHONE_VERIFICATION_SUCCEEDED',
            success: true,
            userId,
            metadata: {
              challengeId: challenge.public_id,
              maskedPhone: maskPhoneNumber(phoneNumber),
            },
          })
          outcome = { verified: true }
        }
      }
    }

    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }

  if (outcome.error) throw outcome.error

  return {
    maskedPhone: maskPhoneNumber(phoneNumber),
    user: getSafeUserById(database, userId),
    verified: true,
  }
}

export async function verifyMsg91Phone(database, userId, payload, config, provider) {
  if (
    provider?.name !== 'msg91' ||
    typeof provider.verifyAccessToken !== 'function'
  ) {
    throw new ApiError(
      409,
      'msg91_not_configured',
      'MSG91 verification is not configured.',
    )
  }

  const accessToken = normalizeMsg91AccessToken(payload)
  const tokenHash = createHmacHex(config.hashSecret, `msg91:${accessToken}`)
  if (
    database
      .prepare('SELECT 1 FROM msg91_access_token_uses WHERE token_hash = ?')
      .get(tokenHash)
  ) {
    const replayStudent = getStudentPhone(database, userId)
    if (replayStudent?.phone_number) {
      recordFailure(
        database,
        userId,
        'msg91_access_token_reused',
        replayStudent.phone_number,
        { provider: 'msg91' },
      )
    }
    throw new ApiError(
      409,
      'msg91_access_token_reused',
      'This MSG91 verification has already been used.',
    )
  }
  const student = requireStudentPhone(database, userId)
  if (student.phone_verified) {
    throw new ApiError(409, 'phone_already_verified', 'This phone number is already verified.')
  }

  const nowBeforeVerification = new Date()
  const requestAttempt = database
    .prepare(
      `SELECT id
         FROM msg91_otp_requests
        WHERE user_id = ? AND phone_number = ? AND consumed_at IS NULL
          AND expires_at > ?
        ORDER BY id DESC
        LIMIT 1`,
    )
    .get(userId, student.phone_number, nowBeforeVerification.toISOString())

  if (!requestAttempt) {
    recordFailure(database, userId, 'msg91_request_missing', student.phone_number, {
      provider: 'msg91',
    })
    throw new ApiError(
      409,
      'msg91_request_required',
      'Request a new MSG91 code before verifying your phone.',
    )
  }

  let verifiedIdentity
  try {
    verifiedIdentity = await provider.verifyAccessToken(accessToken)
  } catch (error) {
    recordFailure(
      database,
      userId,
      'msg91_access_token_rejected',
      student.phone_number,
      { provider: 'msg91' },
    )
    throw error
  }
  const now = new Date().toISOString()
  let outcome

  database.exec('BEGIN IMMEDIATE;')
  try {
    if (
      database
        .prepare('SELECT 1 FROM msg91_access_token_uses WHERE token_hash = ?')
        .get(tokenHash)
    ) {
      recordFailure(database, userId, 'msg91_access_token_reused', student.phone_number, {
        provider: 'msg91',
      })
      outcome = new ApiError(
        409,
        'msg91_access_token_reused',
        'This MSG91 verification has already been used.',
      )
    } else {
      const currentStudent = requireStudentPhone(database, userId)
      const activeRequest = database
        .prepare(
          `SELECT id
             FROM msg91_otp_requests
            WHERE user_id = ? AND phone_number = ? AND consumed_at IS NULL
            AND expires_at > ?
            ORDER BY id DESC
            LIMIT 1`,
        )
        .get(userId, currentStudent.phone_number, now)

      if (!activeRequest) {
        recordFailure(
          database,
          userId,
          'msg91_request_missing',
          currentStudent.phone_number,
          { provider: 'msg91' },
        )
        outcome = new ApiError(
          409,
          'msg91_request_required',
          'Request a new MSG91 code before verifying your phone.',
        )
      } else {
        database.prepare(
          `INSERT INTO msg91_access_token_uses
            (token_hash, user_id, consumed_at) VALUES (?, ?, ?)`,
        ).run(tokenHash, userId, now)
        database.prepare(
          `UPDATE msg91_otp_requests
            SET consumed_at = ?
            WHERE id = ? AND consumed_at IS NULL`,
        ).run(now, activeRequest.id)

        if (currentStudent.phone_verified) {
          outcome = new ApiError(
            409,
            'phone_already_verified',
            'This phone number is already verified.',
          )
        } else if (verifiedIdentity.phoneNumber !== currentStudent.phone_number) {
          recordFailure(
            database,
            userId,
            'msg91_phone_mismatch',
            currentStudent.phone_number,
            { provider: 'msg91' },
          )
          outcome = new ApiError(
            409,
            'msg91_phone_mismatch',
            'The verified phone does not match this account.',
          )
        } else if (
          database
            .prepare(
              `SELECT id FROM users
                WHERE phone_number = ? AND phone_verified = 1 AND id != ?
                LIMIT 1`,
            )
            .get(currentStudent.phone_number, userId)
        ) {
          recordFailure(
            database,
            userId,
            'phone_unavailable',
            currentStudent.phone_number,
            { provider: 'msg91' },
          )
          outcome = new ApiError(
            409,
            'phone_unavailable',
            'This phone number cannot be verified for this account.',
          )
        } else {
          const update = database.prepare(
            `UPDATE users
             SET phone_verified = 1, phone_verified_at = ?, updated_at = ?
             WHERE id = ? AND phone_number = ? AND phone_verified = 0`,
          ).run(
            now,
            now,
            userId,
            currentStudent.phone_number,
          )
          if (update.changes !== 1) {
            throw new Error('MSG91 phone activation lost its account binding.')
          }
          recordAuthEvent(database, {
            eventType: 'PHONE_VERIFICATION_SUCCEEDED',
            success: true,
            userId,
            metadata: { provider: 'msg91' },
          })
        }
      }
    }

    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }

  if (outcome) throw outcome

  return {
    maskedPhone: maskPhoneNumber(verifiedIdentity.phoneNumber),
    user: getSafeUserById(database, userId),
    verified: true,
  }
}

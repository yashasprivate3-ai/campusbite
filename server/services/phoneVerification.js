import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
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
  const address = String(request.socket.remoteAddress || 'unknown').slice(0, 128)
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

function countRecentRequests(database, whereClause, values, cutoff) {
  return Number(
    database
      .prepare(
        `SELECT COUNT(*) AS count
           FROM phone_verification_challenges
          WHERE ${whereClause} AND created_at >= ?`,
      )
      .get(...values, cutoff).count,
  )
}

function throwRateLimit(database, userId, phoneNumber, dimension) {
  recordAuthEvent(database, {
    eventType: 'PHONE_VERIFICATION_RATE_LIMITED',
    success: false,
    userId,
    metadata: {
      dimension,
      maskedPhone: maskPhoneNumber(phoneNumber),
    },
  })
  throw new ApiError(
    429,
    'otp_rate_limit_reached',
    'Too many verification requests. Please try again later.',
  )
}

export async function requestPhoneVerification(
  database,
  userId,
  request,
  config,
  provider,
) {
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

  try {
    await provider.deliver({ code, phoneNumber })
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
    },
  })

  return {
    challengeCreated: true,
    expiresAt: expiresAt.toISOString(),
    maskedPhone: maskPhoneNumber(phoneNumber),
    resendAvailableAt: resendAvailableAt.toISOString(),
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

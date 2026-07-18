import { invalidRequest } from './apiError.js'
import { getSafeUserById, recordAuthEvent } from './auth.js'

export function normalizeIndianMobileNumber(value) {
  if (typeof value !== 'string') {
    throw invalidRequest('Phone number must be a string.')
  }

  const compact = value.trim().replace(/[\s()-]/g, '')
  let nationalNumber = compact

  if (compact.startsWith('+91')) nationalNumber = compact.slice(3)
  else if (compact.startsWith('91') && compact.length === 12) {
    nationalNumber = compact.slice(2)
  } else if (compact.startsWith('0') && compact.length === 11) {
    nationalNumber = compact.slice(1)
  }

  if (!/^[6-9]\d{9}$/.test(nationalNumber)) {
    throw invalidRequest(
      'Enter a valid 10-digit Indian mobile number beginning with 6, 7, 8 or 9.',
    )
  }

  return `+91${nationalNumber}`
}

export function updateStudentPhone(database, userId, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidRequest('Request body must be an object.')
  }

  const phoneNumber = normalizeIndianMobileNumber(payload.phoneNumber)
  const current = database
    .prepare(
      `SELECT phone_number, phone_verified, onboarding_completed_at
         FROM users
        WHERE id = ? AND role = 'STUDENT'`,
    )
    .get(userId)

  if (!current) throw invalidRequest('Student profile is unavailable.')

  const changed = current.phone_number !== phoneNumber
  const firstPhone = !current.phone_number
  const completedNow = !current.onboarding_completed_at
  const updatedAt = new Date().toISOString()

  database.exec('BEGIN IMMEDIATE;')
  try {
    database
      .prepare(
        `UPDATE users
            SET phone_number = ?,
                phone_verified = CASE WHEN ? THEN 0 ELSE phone_verified END,
                onboarding_completed_at = COALESCE(onboarding_completed_at, ?),
                updated_at = ?
          WHERE id = ?`,
      )
      .run(phoneNumber, changed ? 1 : 0, updatedAt, updatedAt, userId)

    if (changed) {
      recordAuthEvent(database, {
        eventType: firstPhone ? 'PHONE_ADDED' : 'PHONE_CHANGED',
        success: true,
        userId,
        metadata: { phoneVerified: false },
      })
    }
    if (completedNow) {
      recordAuthEvent(database, {
        eventType: 'PHONE_ONBOARDING_COMPLETED',
        success: true,
        userId,
        metadata: { phoneVerified: false },
      })
    }

    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }

  return getSafeUserById(database, userId)
}

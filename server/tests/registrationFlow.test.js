import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initializeDatabase } from '../db.js'
import { resolveGoogleStudent } from '../services/googleAuth.js'
import { getSafeUserById } from '../services/auth.js'
import { updateStudentPhone } from '../services/phoneProfile.js'
import { requestPhoneVerification, verifyPhoneCode } from '../services/phoneVerification.js'
import { requireStudentPhoneVerified } from '../services/authorization.js'
import { registrationStep } from '../../src/auth/registrationStep.js'

const identity = { subject: 'synthetic-registration', email: 'registration@example.test', displayName: 'Test Student', pictureUrl: null }
const config = { developmentCode: '123456', expiresMinutes: 5, hashSecret: 'synthetic-test-secret-at-least-32-characters', ipRequestsPerHour: 20, maxAttempts: 5, resendCooldownSeconds: 60, userPhoneRequestsPerHour: 5 }
const request = { socket: { remoteAddress: '127.0.0.1' } }

test('new Google registration moves from phone to verification, and only verified sessions reach workspace', async () => {
  const database = initializeDatabase(':memory:')
  try {
    const { internalUserId, user } = resolveGoogleStudent(database, identity)
    assert.equal(registrationStep(user), 'phone')
    assert.throws(() => requireStudentPhoneVerified({ user }), { code: 'phone_onboarding_required' })
    const saved = updateStudentPhone(database, internalUserId, { phoneNumber: '9000000021' })
    assert.equal(saved.onboardingRequired, false)
    assert.equal(saved.phoneVerified, false)
    assert.equal(registrationStep(saved), 'verification')
    assert.throws(() => requireStudentPhoneVerified({ user: saved }), { code: 'phone_verification_required' })
    // Session reload and a returning Google login must retain the gate.
    assert.equal(registrationStep(getSafeUserById(database, internalUserId)), 'verification')
    assert.equal(registrationStep(resolveGoogleStudent(database, identity).user), 'verification')
    let deliveries = 0
    const provider = { name: 'development', async deliver() { deliveries++ } }
    await requestPhoneVerification(database, internalUserId, request, config, provider)
    assert.equal(deliveries, 1)
    await assert.rejects(requestPhoneVerification(database, internalUserId, request, config, provider), { code: 'otp_cooldown_active' })
    assert.equal(deliveries, 1)
    assert.throws(() => verifyPhoneCode(database, internalUserId, { code: '000000' }, config))
    assert.equal(registrationStep(getSafeUserById(database, internalUserId)), 'verification')
    verifyPhoneCode(database, internalUserId, { code: '123456' }, config)
    const verified = getSafeUserById(database, internalUserId)
    assert.equal(registrationStep(verified), 'workspace')
    assert.doesNotThrow(() => requireStudentPhoneVerified({ user: verified }))
    assert.equal(registrationStep(resolveGoogleStudent(database, identity).user), 'workspace')
  } finally { database.close() }
})

test('role gates leave owner and kitchen authentication unchanged', () => {
  for (const role of ['OWNER', 'KITCHEN']) {
    assert.equal(registrationStep({ role, phoneNumber: null, phoneVerified: false }), 'workspace')
  }
  assert.equal(registrationStep({ role: 'STUDENT', phoneNumber: '+919000000021', phoneVerified: true }), 'workspace')
  assert.equal(registrationStep({ role: 'STUDENT', phoneNumber: '+919000000021', phoneVerified: false }), 'verification')
})

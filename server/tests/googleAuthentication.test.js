import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { test } from 'node:test'
import { OAuth2Client } from 'google-auth-library'
import { initializeDatabase } from '../db.js'
import { normalizeGoogleCredential, verifyGoogleCredential, resolveGoogleStudent } from '../services/googleAuth.js'
import { requireGoogleJsonRequest } from '../services/googleRequest.js'
import { createSession, resolveSession, revokeRequestSession, createSessionCookie } from '../services/auth.js'
import { updateStudentPhone } from '../services/phoneProfile.js'
import { requestPhoneVerification, verifyPhoneCode } from '../services/phoneVerification.js'
import { requireStudentPhoneVerified } from '../services/authorization.js'
import { registrationStep } from '../../src/auth/registrationStep.js'
import { createGoogleIdentityLoader } from '../../src/services/googleIdentityScript.js'
import { handleAuthRoutes } from '../routes/auth.js'

const audience = 'synthetic-web-client'
const googleConfig = { configured: true, clientId: audience }
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const client = new OAuth2Client()
// Only certificate retrieval is replaced: signatures/issuer/audience/time are
// checked by the real installed Google library, with no network requests.
client.getFederatedSignonCertsAsync = async () => ({ certs: { synthetic: pair.publicKey.export({ type: 'spki', format: 'pem' }) } })
function claims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000)
  return { sub: 'google-subject', aud: audience, iss: 'https://accounts.google.com', iat: now - 10, exp: now + 600,
    email: 'student@example.test', email_verified: true, name: 'Test Student', ...overrides }
}
function token(payload, privateKey = pair.privateKey) {
  const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url')
  const data = `${encode({ alg: 'RS256', kid: 'synthetic' })}.${encode(payload)}`
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`
}

test('real Google library verifies a signed synthetic credential and passes expected audience', async () => {
  const result = await verifyGoogleCredential(token(claims()), googleConfig, client)
  assert.equal(result.subject, 'google-subject')
  assert.equal(result.displayName, 'Test Student')
})

test('forged, expired, wrong audience/issuer and unverified-email tokens are rejected offline', async () => {
  const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  const now = Math.floor(Date.now() / 1000)
  const invalidTokens = [token(claims(), wrongKey), token(claims({ exp: now - 1 })),
    token(claims({ aud: 'another-client' })), token(claims({ iss: 'https://attacker.example' })),
    token(claims({ email_verified: false })), token(claims({ sub: '' })), 'forged.payload.signature']
  for (const credential of invalidTokens) {
    await assert.rejects(verifyGoogleCredential(credential, googleConfig, client), { code: 'google_authentication_failed' })
  }
})

test('Google malformed credentials and unavailable configuration fail before verification', async () => {
  for (const payload of [null, [], {}, { credential: '' }, { credential: 'not-a-jwt' }, { credential: 'a'.repeat(20001) }]) {
    assert.throws(() => normalizeGoogleCredential(payload), { code: 'invalid_request' })
  }
  await assert.rejects(verifyGoogleCredential('x.y.z', { configured: false }, { verifyIdToken() { assert.fail('must not verify') } }), { code: 'google_not_configured' })
  await assert.rejects(verifyGoogleCredential('x.y.z', googleConfig, { async verifyIdToken() { throw new Error('private-provider-details') } }), error => {
    assert.doesNotMatch(error.message, /private-provider-details/)
    return error.code === 'google_authentication_failed'
  })
})

test('Google callback endpoint rejects simple browser requests and cross-site JSON', () => {
  for (const contentType of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
    assert.throws(() => requireGoogleJsonRequest({ headers: { 'content-type': contentType } }), { code: 'google_json_required' })
  }
  assert.throws(() => requireGoogleJsonRequest({ headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } }), { code: 'google_request_forbidden' })
  assert.doesNotThrow(() => requireGoogleJsonRequest({ headers: { 'content-type': 'application/json; charset=UTF-8', 'sec-fetch-site': 'same-origin' } }))
})

test('Google route applies request protection before parsing or touching accounts', async () => {
  for (const headers of [{ 'content-type': 'text/plain' }, { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }]) {
    const request = { method: 'POST', headers, [Symbol.asyncIterator]() { assert.fail('must reject before reading credential') } }
    await assert.rejects(handleAuthRoutes(request, {}, new URL('http://localhost/api/auth/google'), null, null, null, null),
      error => ['google_json_required', 'google_request_forbidden'].includes(error.code))
  }
})

test('returning Google identity preserves saved phone and creates private revocable sessions', () => {
  const db = initializeDatabase(':memory:')
  try {
    const identity = { subject: 'session-google', email: 'session@example.test', displayName: 'Student Name', pictureUrl: null }
    const first = resolveGoogleStudent(db, identity)
    updateStudentPhone(db, first.internalUserId, { course: 'BSc', studentClass: 'Year 1 A', phoneNumber: '9000000041' })
    db.prepare('UPDATE users SET phone_verified = 1 WHERE id = ?').run(first.internalUserId)
    const returned = resolveGoogleStudent(db, identity)
    assert.equal(returned.internalUserId, first.internalUserId)
    assert.equal(returned.created, false)
    assert.equal(returned.user.displayName, 'Student Name')
    assert.equal(returned.user.phoneNumber, '+919000000041')
    assert.equal(registrationStep(returned.user), 'workspace')
    const settings = { cookieName: 'synthetic_session', cookieSecure: true, sessionTtlHours: 1, sessionTouchMinutes: 15 }
    const request = { headers: { 'user-agent': 'synthetic-test' }, socket: { remoteAddress: '127.0.0.1' } }
    const session = createSession(db, first.internalUserId, request, settings, { provider: 'GOOGLE' })
    const stored = db.prepare('SELECT token_hash FROM sessions').get()
    assert.notEqual(stored.token_hash, session.rawToken)
    request.headers.cookie = `${settings.cookieName}=${session.rawToken}`
    assert.equal(resolveSession(db, request, settings).user.phoneVerified, true)
    const cookie = createSessionCookie(session.rawToken, session.expiresAt, settings)
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api']) assert.ok(cookie.includes(part))
    assert.doesNotMatch(cookie, /Domain=/)
    revokeRequestSession(db, request, settings)
    assert.equal(resolveSession(db, request, settings), null)
    const expired = createSession(db, first.internalUserId, request, settings)
    db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00Z'").run()
    request.headers.cookie = `${settings.cookieName}=${expired.rawToken}`
    assert.equal(resolveSession(db, request, settings), null)
  } finally { db.close() }
})

test('Google cannot link by email into staff accounts or authenticate a disabled student', () => {
  const db = initializeDatabase(':memory:')
  try {
    for (const role of ['OWNER', 'KITCHEN']) {
      db.prepare('INSERT INTO users (public_id, role, display_name, email, status) VALUES (?, ?, ?, ?, ?)').run(role, role, role, `${role.toLowerCase()}@example.test`, 'ACTIVE')
      assert.throws(() => resolveGoogleStudent(db, { subject: role, email: `${role.toLowerCase()}@example.test`, displayName: 'Attacker', pictureUrl: null }), { code: 'google_identity_conflict' })
    }
    const identity = { subject: 'disabled', email: 'disabled@example.test', displayName: 'Disabled', pictureUrl: null }
    const student = resolveGoogleStudent(db, identity)
    db.prepare("UPDATE users SET status = 'DISABLED' WHERE id = ?").run(student.internalUserId)
    assert.throws(() => resolveGoogleStudent(db, identity), { code: 'account_disabled' })
  } finally { db.close() }
})

test('changing verified phone resets access and invalidates previous OTP challenges', async () => {
  const db = initializeDatabase(':memory:')
  try {
    const { internalUserId } = resolveGoogleStudent(db, { subject: 'phone-change', email: 'phone@example.test', displayName: 'Phone Student', pictureUrl: null })
    updateStudentPhone(db, internalUserId, { course: 'BSc', studentClass: 'Year 1 A', phoneNumber: '9000000042' })
    const config = { developmentCode: '123456', expiresMinutes: 5, hashSecret: 'synthetic-secret-at-least-32-characters', ipRequestsPerHour: 20, maxAttempts: 5, resendCooldownSeconds: 60, userPhoneRequestsPerHour: 5 }
    await requestPhoneVerification(db, internalUserId, { socket: { remoteAddress: '127.0.0.1' } }, config, { name: 'development', async deliver() {} })
    verifyPhoneCode(db, internalUserId, { code: '123456' }, config)
    const unchanged = updateStudentPhone(db, internalUserId, { course: 'BSc', studentClass: 'Year 1 A', phoneNumber: '+919000000042' })
    assert.equal(unchanged.phoneVerified, true)
    const changed = updateStudentPhone(db, internalUserId, { course: 'BSc', studentClass: 'Year 1 A', phoneNumber: '9000000043', phoneVerified: true })
    assert.equal(changed.phoneVerified, false)
    assert.equal(changed.phoneVerifiedAt, null)
    assert.equal(registrationStep(changed), 'verification')
    assert.throws(() => requireStudentPhoneVerified({ user: changed }), { code: 'phone_verification_required' })
    assert.throws(() => verifyPhoneCode(db, internalUserId, { code: '123456' }, config))
    await requestPhoneVerification(db, internalUserId, { socket: { remoteAddress: '127.0.0.1' } }, config, { name: 'development', async deliver() {} })
    updateStudentPhone(db, internalUserId, { course: 'BSc', studentClass: 'Year 1 A', phoneNumber: '9000000044' })
    const oldChallenge = db.prepare('SELECT invalidated_at FROM phone_verification_challenges WHERE phone_number = ?').get('+919000000043')
    assert.ok(oldChallenge.invalidated_at)
    assert.throws(() => verifyPhoneCode(db, internalUserId, { code: '123456' }, config), { code: 'otp_phone_changed' })
  } finally { db.close() }
})

test('Google script loader shares in-flight work and recovers after failed or incomplete loading', async () => {
  const windowObject = {}
  let script
  const documentObject = { getElementById() { return script }, createElement() {
    const element = new EventTarget()
    element.remove = () => { script = undefined }
    return element
  }, head: { appendChild(element) { script = element; element.parentNode = this } } }
  const load = createGoogleIdentityLoader(windowObject, documentObject)
  const first = load()
  assert.equal(first, load())
  const rejected = assert.rejects(first, /could not be loaded/)
  script.dispatchEvent(new Event('error'))
  await rejected
  assert.equal(script, undefined)
  const incomplete = load()
  const incompleteRejected = assert.rejects(incomplete, /could not be loaded/)
  script.dispatchEvent(new Event('load'))
  await incompleteRejected
  const retry = load()
  windowObject.google = { accounts: { id: {} } }
  script.dispatchEvent(new Event('load'))
  assert.equal(await retry, windowObject.google)
})

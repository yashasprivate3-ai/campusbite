import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { initializeDatabase } from '../db.js'
import {
  buildAuthenticationTemplatePayload,
  createMetaWhatsAppProvider,
  normalizeMetaRecipient,
} from '../services/metaWhatsappProvider.js'
import {
  requestPhoneVerification,
  verifyPhoneCode,
} from '../services/phoneVerification.js'
import { validateVerifiedGoogleClaims } from '../services/googleAuth.js'
import { updateOrderStatus } from '../services/orders.js'

const databases = []
const otpConfig = {
  developmentCode: '123456',
  expiresMinutes: 5,
  hashSecret: 'synthetic-test-secret-at-least-32-characters',
  ipRequestsPerHour: 20,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  userPhoneRequestsPerHour: 5,
}
const request = { socket: { remoteAddress: '127.0.0.1' } }
const developmentProvider = {
  name: 'development',
  async deliver({ code }) {
    assert.equal(code, otpConfig.developmentCode)
  },
}

function createDatabase() {
  const database = initializeDatabase(':memory:')
  databases.push(database)
  database.prepare(`INSERT INTO users
    (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES ('otp-student', 'STUDENT', 'OTP Student', '+919000000010', 0, 'ACTIVE')`).run()
  return database
}

function metaConfig(overrides = {}) {
  return {
    accessToken: 'synthetic-token-never-logged',
    graphVersion: 'v23.0',
    phoneNumberId: '1234567890',
    requestTimeoutMilliseconds: 1000,
    templateLanguage: 'en',
    templateName: 'campusbite_phone_verification',
    wabaId: '9876543210',
    ...overrides,
  }
}

afterEach(() => {
  while (databases.length) databases.pop().close()
})

test('Meta authentication payload maps recipient and OTP to body and copy-code button', () => {
  assert.equal(normalizeMetaRecipient('+919000000010'), '919000000010')
  const payload = buildAuthenticationTemplatePayload({
    code: '654321',
    language: 'en',
    phoneNumber: '+919000000010',
    templateName: 'campusbite_phone_verification',
  })
  assert.equal(payload.to, '919000000010')
  assert.equal(payload.template.components[0].parameters[0].text, '654321')
  assert.equal(payload.template.components[1].parameters[0].text, '654321')
  assert.equal(payload.template.components[1].sub_type, 'url')
})

test('Meta provider validates configuration and recipient', () => {
  assert.throws(() => createMetaWhatsAppProvider(metaConfig({ accessToken: '' })), /ACCESS_TOKEN/)
  assert.throws(() => createMetaWhatsAppProvider(metaConfig({ graphVersion: 'latest' })), /GRAPH_VERSION/)
  assert.throws(() => normalizeMetaRecipient('09000000010'), (error) => error.code === 'otp_invalid_recipient')
})

test('Meta provider validates success response without exposing provider data', async () => {
  let requestOptions
  const provider = createMetaWhatsAppProvider(metaConfig(), async (_url, options) => {
    requestOptions = options
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.synthetic' }] }), { status: 200 })
  })
  const result = await provider.deliver({ code: '654321', phoneNumber: '+919000000010' })
  assert.deepEqual(result, { audit: { templateName: 'campusbite_phone_verification' } })
  assert.equal(JSON.parse(requestOptions.body).to, '919000000010')
  assert.match(requestOptions.headers.Authorization, /^Bearer /)
})

test('Meta provider maps invalid template and invalid recipient responses', async () => {
  const invalidTemplate = createMetaWhatsAppProvider(metaConfig(), async () =>
    new Response(JSON.stringify({ error: { code: 132001 } }), { status: 400 }),
  )
  await assert.rejects(
    invalidTemplate.deliver({ code: '654321', phoneNumber: '+919000000010' }),
    (error) => error.code === 'otp_template_invalid',
  )
  const invalidRecipient = createMetaWhatsAppProvider(metaConfig(), async () =>
    new Response(JSON.stringify({ error: { code: 131030 } }), { status: 400 }),
  )
  await assert.rejects(
    invalidRecipient.deliver({ code: '654321', phoneNumber: '+919000000010' }),
    (error) => error.code === 'otp_invalid_recipient',
  )
})

test('Meta provider retries one transient response and maps timeout safely', async () => {
  let attempts = 0
  const retrying = createMetaWhatsAppProvider(metaConfig(), async () => {
    attempts += 1
    return attempts === 1
      ? new Response('{}', { status: 503 })
      : new Response(JSON.stringify({ messages: [{ id: 'wamid.synthetic' }] }), { status: 200 })
  })
  await retrying.deliver({ code: '654321', phoneNumber: '+919000000010' })
  assert.equal(attempts, 2)

  const timeout = createMetaWhatsAppProvider(metaConfig(), async () => {
    const error = new Error('synthetic timeout')
    error.name = 'TimeoutError'
    throw error
  })
  await assert.rejects(
    timeout.deliver({ code: '654321', phoneNumber: '+919000000010' }),
    (error) => error.code === 'otp_provider_timeout',
  )
})

test('OTP cooldown, expiry, and single-use behavior remain enforced', async () => {
  const database = createDatabase()
  await requestPhoneVerification(database, 1, request, otpConfig, developmentProvider)
  await assert.rejects(
    requestPhoneVerification(database, 1, request, otpConfig, developmentProvider),
    (error) => error.code === 'otp_cooldown_active',
  )
  database.prepare(`UPDATE phone_verification_challenges SET expires_at = '2000-01-01T00:00:00.000Z'`).run()
  assert.throws(
    () => verifyPhoneCode(database, 1, { code: '123456' }, otpConfig),
    (error) => error.code === 'otp_expired',
  )
})

test('resend invalidates the old challenge and correct OTP is consumed once', async () => {
  const database = createDatabase()
  await requestPhoneVerification(database, 1, request, otpConfig, developmentProvider)
  database.prepare(`UPDATE phone_verification_challenges SET resend_available_at = '2000-01-01T00:00:00.000Z'`).run()
  await requestPhoneVerification(database, 1, request, otpConfig, developmentProvider)
  const challenges = database.prepare('SELECT invalidated_at FROM phone_verification_challenges ORDER BY id').all()
  assert.ok(challenges[0].invalidated_at)
  assert.equal(challenges[1].invalidated_at, null)
  assert.equal(verifyPhoneCode(database, 1, { code: '123456' }, otpConfig).verified, true)
  assert.throws(
    () => verifyPhoneCode(database, 1, { code: '123456' }, otpConfig),
    (error) => error.code === 'otp_already_consumed',
  )
})

test('request rate limits and verified phone uniqueness remain enforced', async () => {
  const database = createDatabase()
  const strictConfig = { ...otpConfig, userPhoneRequestsPerHour: 1 }
  await requestPhoneVerification(database, 1, request, strictConfig, developmentProvider)
  database.prepare(`UPDATE phone_verification_challenges SET resend_available_at = '2000-01-01T00:00:00.000Z'`).run()
  await assert.rejects(
    requestPhoneVerification(database, 1, request, strictConfig, developmentProvider),
    (error) => error.code === 'otp_rate_limit_reached',
  )

  database.prepare(`INSERT INTO users
    (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES ('verified-student', 'STUDENT', 'Verified Student', '+919000000010', 1, 'ACTIVE')`).run()
  assert.throws(
    () => verifyPhoneCode(database, 1, { code: '123456' }, otpConfig),
    (error) => error.code === 'phone_unavailable',
  )
})

test('Google verified-claim validation remains intact', () => {
  const claims = validateVerifiedGoogleClaims({
    aud: 'synthetic-client-id',
    email: 'Student@Example.com',
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 300,
    iss: 'https://accounts.google.com',
    name: 'Student Example',
    sub: 'google-subject-synthetic',
  }, 'synthetic-client-id')
  assert.equal(claims.email, 'student@example.com')
  assert.equal(claims.subject, 'google-subject-synthetic')
  assert.throws(
    () => validateVerifiedGoogleClaims({ ...claims, aud: 'wrong' }, 'synthetic-client-id'),
    (error) => error.code === 'google_authentication_failed',
  )
})

test('Kitchen order lifecycle remains strictly sequential', () => {
  const database = createDatabase()
  const result = database.prepare(`INSERT INTO orders
    (token, pickup_method, instructions, total_amount, status)
    VALUES ('SYNTHETIC-KITCHEN', 'asap', '', 7000, 'new')`).run()
  const orderId = Number(result.lastInsertRowid)
  assert.equal(updateOrderStatus(database, orderId, { status: 'preparing' }).status, 'preparing')
  assert.equal(updateOrderStatus(database, orderId, { status: 'ready' }).status, 'ready')
  assert.throws(
    () => updateOrderStatus(database, orderId, { status: 'preparing' }),
    (error) => error.code === 'invalid_status_transition',
  )
})

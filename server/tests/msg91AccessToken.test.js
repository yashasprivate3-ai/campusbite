import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { initializeDatabase } from '../db.js'
import {
  checkMsg91AccessToken,
  createMsg91AccessTokenVerifier,
} from '../services/msg91AccessToken.js'
import {
  requestMsg91PhoneVerification,
  verifyMsg91Phone,
} from '../services/phoneVerification.js'
import { createPhoneVerificationProvider } from '../services/phoneVerificationProvider.js'

const databases = []
const temporaryDirectories = []
const token = 'synthetic-access-token'
const key = 'synthetic-server-key'
const otpConfig = {
  expiresMinutes: 5,
  hashSecret: 'synthetic-test-secret-at-least-32-characters',
  ipRequestsPerHour: 20,
  resendCooldownSeconds: 60,
  userPhoneRequestsPerHour: 5,
}
const request = { socket: { remoteAddress: '127.0.0.1' } }
const reply = (body, status = 200) => async () =>
  new Response(JSON.stringify(body), { status })

// Fixtures use the inserted user ids so tests also run against pre-populated databases.
let studentId
function createDatabase(phoneNumber = '+919000000010') {
  const database = initializeDatabase(':memory:')
  databases.push(database)
  studentId = Number(database.prepare(`INSERT INTO users
    (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES ('msg91-student', 'STUDENT', 'MSG91 Student', ?, 0, 'ACTIVE')`).run(phoneNumber).lastInsertRowid)
  return database
}

function provider(result = { phoneNumber: '+919000000010' }) {
  return {
    name: 'msg91',
    async verifyAccessToken() { return result },
  }
}

function authorizeRequest(database, userId = studentId, requestContext = request) {
  return requestMsg91PhoneVerification(
    database,
    userId,
    requestContext,
    otpConfig,
    provider(),
  )
}

afterEach(() => {
  while (databases.length) databases.pop().close()
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop(), { recursive: true, force: true })
})

test('schema 11 upgrades add durable MSG91 replay protection without losing existing records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'campusbite-msg91-'))
  temporaryDirectories.push(directory)
  const filename = join(directory, 'campusbite.db')
  const before = initializeDatabase(filename)
  before.prepare(`INSERT INTO users
    (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES ('existing-student', 'STUDENT', 'Existing Student', '+919000000011', 0, 'ACTIVE')`).run()
  before.exec('DROP TABLE msg91_access_token_uses; PRAGMA user_version = 11;')
  before.close()

  const after = initializeDatabase(filename)
  databases.push(after)
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 13)
  assert.equal(after.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'msg91_access_token_uses'").get().name, 'msg91_access_token_uses')
  assert.equal(after.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'msg91_otp_requests'").get().name, 'msg91_otp_requests')
  assert.equal(after.prepare("SELECT display_name FROM users WHERE public_id = 'existing-student'").get().display_name, 'Existing Student')
})

test('MSG91 provider requires a server AuthKey and preserves other provider selection', () => {
  assert.throws(
    () => createPhoneVerificationProvider({ provider: 'msg91', msg91: {} }, true),
    /CAMPUSBITE_MSG91_AUTHKEY/,
  )
  const msg91 = createPhoneVerificationProvider({
    provider: 'msg91',
    msg91: { authkey: key, requestTimeoutMilliseconds: 1000 },
  }, true)
  assert.equal(msg91.name, 'msg91')
  assert.equal(typeof msg91.verifyAccessToken, 'function')
})

test('MSG91 verification uses the documented endpoint, headers and JSON credentials', async () => {
  const result = await checkMsg91AccessToken(token, key, async (url, options) => {
    assert.equal(url, 'https://control.msg91.com/api/v5/widget/verifyAccessToken')
    assert.equal(options.method, 'POST')
    assert.equal(options.redirect, 'error')
    assert.equal(options.headers.authkey, undefined)
    assert.equal(options.headers.Accept, 'application/json')
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.ok(options.signal instanceof AbortSignal)
    assert.deepEqual(JSON.parse(options.body), {
      authkey: key,
      'access-token': token,
    })
    return new Response('{"type":"success","message":"919000000010"}')
  })
  assert.deepEqual(result, { phoneNumber: '+919000000010' })
})

test('MSG91 rejects invalid tokens and non-authoritative response shapes', async () => {
  const forbidden = () => { assert.fail('Unexpected provider request') }
  const verifier = createMsg91AccessTokenVerifier(
    { authkey: key, requestTimeoutMilliseconds: 1000 },
    forbidden,
  )
  for (const value of [null, '', ' ', {}, 'a'.repeat(8193)]) {
    await assert.rejects(verifier(value), error => error.code === 'msg91_access_token_invalid')
  }

  for (const body of [
    null,
    [],
    { type: 'error', message: '919000000010' },
    { type: 'success' },
    { type: 'success', message: '+919000000010' },
    { type: 'success', message: 'student@example.com' },
    { verified: true, phoneNumber: '919000000010' },
  ]) {
    const invalid = createMsg91AccessTokenVerifier(
      { authkey: key, requestTimeoutMilliseconds: 1000 },
      reply(body),
    )
    await assert.rejects(invalid(token), error => error.code === 'msg91_response_invalid')
  }
})

test('MSG91 rejects provider replay code 702 without exposing its response message', async () => {
  const verifier = createMsg91AccessTokenVerifier(
    { authkey: key, requestTimeoutMilliseconds: 1000 },
    reply({
      message: 'access-token already verified',
      type: 'error',
      code: 702,
    }),
  )

  await assert.rejects(verifier(token), error => {
    assert.equal(error.statusCode, 409)
    assert.equal(error.code, 'msg91_access_token_reused')
    assert.doesNotMatch(error.message, /access-token already verified/)
    return true
  })
})

test('MSG91 provider failures are generic and never expose tokens, keys or phone values', async () => {
  for (const fetchImplementation of [
    reply({ type: 'error', message: token }, 401),
    async () => new Response(token),
    async () => { throw new Error(`${token} ${key} 919000000010`) },
  ]) {
    const verifier = createMsg91AccessTokenVerifier(
      { authkey: key, requestTimeoutMilliseconds: 1000 },
      fetchImplementation,
    )
    await assert.rejects(verifier(token), error => {
      assert.equal(error.code, 'msg91_verification_failed')
      assert.doesNotMatch(error.message, /synthetic|919000000010/)
      return true
    })
  }
})

test('MSG91 timeout failures are generic and never expose credentials', async () => {
  const verifier = createMsg91AccessTokenVerifier(
    { authkey: key, requestTimeoutMilliseconds: 1000 },
    async () => {
      throw new DOMException(token + ' ' + key, 'TimeoutError')
    },
  )

  await assert.rejects(verifier(token), error => {
    assert.equal(error.code, 'msg91_verification_failed')
    assert.doesNotMatch(error.message, /synthetic-access-token|synthetic-server-key/)
    return true
  })
})

test('MSG91 activation trusts only provider phone and binds it to the authenticated student', async () => {
  const database = createDatabase()
  authorizeRequest(database)
  const result = await verifyMsg91Phone(
    database,
    studentId,
    { accessToken: token, phoneNumber: '+919999999999', verified: true },
    otpConfig,
    provider(),
  )
  assert.equal(result.verified, true)
  assert.equal(result.user.phoneVerified, true)
  assert.equal(result.user.phoneNumber, '+919000000010')
  assert.equal(database.prepare('SELECT count(*) AS count FROM msg91_access_token_uses').get().count, 1)
  assert.equal(database.prepare('SELECT consumed_at IS NOT NULL AS consumed FROM msg91_otp_requests').get().consumed, 1)
  const stored = JSON.stringify(database.prepare('SELECT * FROM msg91_access_token_uses').get())
  assert.doesNotMatch(stored, /synthetic-access-token|919000000010/)
})

test('MSG91 preflight enforces resend cooldown and account request limits', () => {
  const database = createDatabase()
  const oneRequestConfig = { ...otpConfig, userPhoneRequestsPerHour: 1 }

  requestMsg91PhoneVerification(database, studentId, request, oneRequestConfig, provider())
  assert.throws(
    () => requestMsg91PhoneVerification(database, studentId, request, oneRequestConfig, provider()),
    error => error.code === 'otp_cooldown_active',
  )

  database.prepare(
    `UPDATE msg91_otp_requests
        SET resend_available_at = '2000-01-01T00:00:00.000Z'`,
  ).run()
  assert.throws(
    () => requestMsg91PhoneVerification(database, studentId, request, oneRequestConfig, provider()),
    error => error.code === 'otp_rate_limit_reached',
  )
  assert.equal(database.prepare('SELECT count(*) AS count FROM msg91_otp_requests').get().count, 1)
})

test('MSG91 preflight enforces phone and client-IP caps across accounts', () => {
  const database = createDatabase()
  const otherStudentId = Number(database.prepare(`INSERT INTO users
    (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES ('shared-ip-student', 'STUDENT', 'Shared IP', '+919000000011', 0, 'ACTIVE')`).run().lastInsertRowid)
  const strictConfig = { ...otpConfig, ipRequestsPerHour: 1, userPhoneRequestsPerHour: 5 }

  requestMsg91PhoneVerification(database, studentId, request, strictConfig, provider())
  assert.throws(
    () => requestMsg91PhoneVerification(database, otherStudentId, request, strictConfig, provider()),
    error => error.code === 'otp_rate_limit_reached',
  )
  assert.equal(database.prepare('SELECT count(*) AS count FROM msg91_otp_requests').get().count, 1)
})

test('MSG91 phone cap applies across accounts even when their client IPs differ', () => {
  const database = createDatabase('+919000000010')
  const otherStudentId = Number(database.prepare(`INSERT INTO users
    (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES ('shared-phone-student', 'STUDENT', 'Shared Phone', '+919000000010', 0, 'ACTIVE')`).run().lastInsertRowid)
  const strictConfig = { ...otpConfig, userPhoneRequestsPerHour: 1 }
  const otherRequest = {
    headers: { 'x-vercel-forwarded-for': '198.51.100.27' },
    socket: { remoteAddress: '127.0.0.1' },
  }

  requestMsg91PhoneVerification(database, studentId, request, strictConfig, provider())
  assert.throws(
    () => requestMsg91PhoneVerification(database, otherStudentId, otherRequest, strictConfig, provider()),
    error => error.code === 'otp_rate_limit_reached',
  )
  assert.equal(database.prepare('SELECT count(*) AS count FROM msg91_otp_requests').get().count, 1)
})

test('MSG91 verification requires a recent authorized request', async () => {
  const database = createDatabase()
  await assert.rejects(
    verifyMsg91Phone(database, studentId, { accessToken: token }, otpConfig, provider()),
    error => error.code === 'msg91_request_required',
  )
})

test('MSG91 access-token rejections are audited without sensitive values', async () => {
  const database = createDatabase()
  authorizeRequest(database)
  const rejectedProvider = {
    name: 'msg91',
    async verifyAccessToken() {
      const error = new Error(`${token} ${key}`)
      error.code = 'msg91_verification_failed'
      throw error
    },
  }

  await assert.rejects(
    verifyMsg91Phone(database, studentId, { accessToken: token }, otpConfig, rejectedProvider),
    error => error.code === 'msg91_verification_failed',
  )
  const event = database.prepare(
    `SELECT metadata_json FROM auth_events
      WHERE event_type = 'PHONE_VERIFICATION_FAILED'
      ORDER BY id DESC LIMIT 1`,
  ).get()
  assert.ok(event)
  assert.match(event.metadata_json, /msg91_access_token_rejected/)
  assert.doesNotMatch(event.metadata_json, /synthetic-access-token|synthetic-server-key/)
})

test('MSG91 phone mismatch fails closed and consumes the verified token against replay', async () => {
  const database = createDatabase()
  authorizeRequest(database)
  await assert.rejects(
    verifyMsg91Phone(database, studentId, { accessToken: token }, otpConfig, provider({ phoneNumber: '+919000000099' })),
    error => error.code === 'msg91_phone_mismatch',
  )
  assert.equal(database.prepare('SELECT phone_verified FROM users WHERE id = ?').get(studentId).phone_verified, 0)
  assert.equal(database.prepare('SELECT count(*) AS count FROM msg91_access_token_uses').get().count, 1)
  await assert.rejects(
    verifyMsg91Phone(database, studentId, { accessToken: token }, otpConfig, provider()),
    error => error.code === 'msg91_access_token_reused',
  )
})

test('MSG91 rejects token replay and duplicate phone activation', async () => {
  const database = createDatabase()
  const otherStudentId = Number(database.prepare(`INSERT INTO users
    (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES ('other-student', 'STUDENT', 'Other', '+919000000010', 0, 'ACTIVE')`).run().lastInsertRowid)
  authorizeRequest(database, studentId)
  await verifyMsg91Phone(database, studentId, { accessToken: token }, otpConfig, provider())
  await assert.rejects(
    verifyMsg91Phone(database, studentId, { accessToken: token }, otpConfig, provider()),
    error => error.code === 'msg91_access_token_reused',
  )

  authorizeRequest(database, otherStudentId)
  await assert.rejects(
    verifyMsg91Phone(database, otherStudentId, { accessToken: 'other-token' }, otpConfig, provider()),
    error => error.code === 'phone_unavailable',
  )
  assert.equal(database.prepare('SELECT phone_verified FROM users WHERE id = ?').get(otherStudentId).phone_verified, 0)
})

test('concurrent MSG91 verification permits one activation and rejects the duplicate token', async () => {
  const database = createDatabase()
  authorizeRequest(database)
  let release
  const gate = new Promise(resolve => { release = resolve })
  let calls = 0
  const concurrentProvider = {
    name: 'msg91',
    async verifyAccessToken() {
      calls += 1
      await gate
      return { phoneNumber: '+919000000010' }
    },
  }

  const first = verifyMsg91Phone(database, studentId, { accessToken: token }, otpConfig, concurrentProvider)
  const second = verifyMsg91Phone(database, studentId, { accessToken: token }, otpConfig, concurrentProvider)
  release()
  const results = await Promise.allSettled([first, second])
  assert.equal(calls, 2)
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const rejected = results.find(result => result.status === 'rejected')
  assert.ok(['msg91_access_token_reused', 'phone_already_verified'].includes(rejected.reason.code))
  assert.equal(database.prepare('SELECT count(*) AS count FROM msg91_access_token_uses').get().count, 1)
  assert.equal(database.prepare('SELECT phone_verified FROM users WHERE id = ?').get(studentId).phone_verified, 1)
})

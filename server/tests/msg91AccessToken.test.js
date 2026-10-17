import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkMsg91AccessToken } from '../services/msg91AccessToken.js'
import { createPhoneVerificationProvider } from '../services/phoneVerificationProvider.js'

const token = 'synthetic-access-token'
const key = 'synthetic-server-key'
const reply = body => async () => new Response(JSON.stringify(body))

test('MSG91 activation remains blocked, including production', () => {
  for (const production of [false, true]) {
    assert.throws(() => createPhoneVerificationProvider({ provider: 'msg91' }, production), /not enabled/)
  }
})

test('MSG91 probe validates inputs before any provider request', async () => {
  const forbidden = () => { assert.fail('Unexpected provider request') }
  for (const value of [null, '', ' ', {}, 'a'.repeat(8193)]) {
    await assert.rejects(checkMsg91AccessToken(value, key, forbidden), /missing or invalid/)
  }
  await assert.rejects(checkMsg91AccessToken(token, '', forbidden), /not configured/)
})

test('MSG91 probe posts credentials only to fixed backend endpoint and rejects redirects', async () => {
  await checkMsg91AccessToken(token, key, async (url, options) => {
    assert.equal(url, 'https://control.msg91.com/api/v5/widget/verifyAccessToken')
    assert.equal(options.method, 'POST')
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
    assert.deepEqual(JSON.parse(options.body), { authkey: key, 'access-token': token })
    return new Response('{"type":"success"}')
  })
})

test('MSG91 success, phone claims and repeated token probes never authorize', async () => {
  for (const body of [
    { type: 'success', message: 'verified' },
    { type: 'success', identifier: '919000000010', data: { phoneVerified: true } },
    { verified: true, phoneNumber: '+919000000011', expired: false },
  ]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await checkMsg91AccessToken(token, key, reply(body))
      assert.equal(result.phoneVerified, false)
      assert.equal(result.authorizationGranted, false)
      assert.doesNotMatch(JSON.stringify(result), /91900000001|verified"/)
    }
  }
})

test('MSG91 errors, malformed bodies and transport failures fail without leaking private content', async () => {
  for (const transport of [
    reply({ type: 'error', message: token }), reply({ error: key }),
    reply(null), reply([]), reply('invalid'),
    async () => new Response(token, { status: 401 }),
    async () => new Response(token),
    async () => { throw new Error(`${token} ${key}`) },
    async () => { throw new DOMException(token, 'TimeoutError') },
  ]) {
    await assert.rejects(checkMsg91AccessToken(token, key, transport), error => {
      assert.doesNotMatch(error.message, /synthetic/)
      return /MSG91/.test(error.message)
    })
  }
})

test('MSG91 diagnostics never return values or arbitrary field names', async () => {
  const result = await checkMsg91AccessToken(token, key, reply({ [token]: key, message: token }))
  assert.deepEqual(result.responseFields, [{ field: 'message', type: 'string' }])
  assert.doesNotMatch(JSON.stringify(result), /synthetic/)
})

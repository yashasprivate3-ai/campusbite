import assert from 'node:assert/strict'
import { spawnSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createSessionCookie, createClearSessionCookie } from '../services/auth.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const configUrl = new URL('../config.js', import.meta.url).href
const vercelUrl = new URL('../../vercel.ts', import.meta.url).href
// Never inherit credentials or load the developer's .env in configuration tests.
const baseEnvironment = {
  SystemRoot: process.env.SystemRoot || '',
  PATH: process.env.PATH || '',
  NODE_ENV: 'production',
  CAMPUSBITE_OTP_PROVIDER: 'meta-whatsapp',
  CAMPUSBITE_OTP_HASH_SECRET: 'synthetic-test-secret-at-least-32-characters',
  CAMPUSBITE_PAYMENT_PROVIDER: 'razorpay',
  RAZORPAY_ENVIRONMENT: 'test',
  RAZORPAY_KEY_ID: 'rzp_test_synthetic',
  RAZORPAY_KEY_SECRET: 'synthetic-api-secret',
  CAMPUSBITE_PUBLIC_APP_URL: 'https://frontend.example.com',
}
const noPrivateEnv = 'process.loadEnvFile = () => {};'

function evaluate(url, exportName, overrides = {}) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `${noPrivateEnv} const module = await import(${JSON.stringify(url)}); console.log(JSON.stringify(module[${JSON.stringify(exportName)}]));`,
  ], { cwd: root, env: { ...baseEnvironment, ...overrides }, encoding: 'utf8', timeout: 10000 })
  assert.ifError(result.error)
  return result
}

function config(overrides = {}) {
  const result = evaluate(configUrl, 'serverConfig', overrides)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('production permits test payments while retaining secure cookies and disabling dev accounts', () => {
  const result = config({ CAMPUSBITE_DEV_ACCOUNTS_ENABLED: 'true', CAMPUSBITE_DEV_RESET_PASSWORDS: 'true', CAMPUSBITE_AUTH_COOKIE_SECURE: 'false' })
  assert.equal(result.payments.enabled, true)
  assert.equal(result.payments.razorpay.environment, 'test')
  assert.equal(result.host, '0.0.0.0')
  assert.equal(result.auth.developmentAccountsEnabled, false)
  assert.equal(result.auth.resetDevelopmentPasswords, false)
  assert.equal(result.auth.cookieSecure, true)
  for (const cookie of [createSessionCookie('synthetic', new Date(Date.now() + 60000), result.auth), createClearSessionCookie(result.auth)]) {
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api']) assert.ok(cookie.split('; ').includes(attribute))
    assert.doesNotMatch(cookie, /Domain=/)
  }
})

test('live environment and live or malformed keys remain blocked even with a test label', () => {
  for (const overrides of [{ RAZORPAY_ENVIRONMENT: 'live' }, { RAZORPAY_KEY_ID: 'rzp_live_synthetic' }, { RAZORPAY_KEY_ID: 'invalid' }]) {
    const result = evaluate(configUrl, 'serverConfig', overrides)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /test|Test Mode/)
  }
})

test('production still rejects missing payment credentials, insecure frontend and development OTP', () => {
  for (const [overrides, message] of [
    [{ RAZORPAY_KEY_ID: '' }, /RAZORPAY_KEY_ID/],
    [{ RAZORPAY_KEY_SECRET: '' }, /RAZORPAY_KEY_SECRET/],
    [{ CAMPUSBITE_PUBLIC_APP_URL: '' }, /absolute URL/],
    [{ CAMPUSBITE_PUBLIC_APP_URL: 'http://frontend.example.com' }, /HTTPS/],
    [{ CAMPUSBITE_OTP_PROVIDER: 'development' }, /cannot run in production/],
    [{ CAMPUSBITE_OTP_HASH_SECRET: '' }, /at least 32/],
  ]) {
    const result = evaluate(configUrl, 'serverConfig', overrides)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, message)
  }
})

test('Google configuration requires matching frontend and backend client IDs', () => {
  assert.equal(config({ CAMPUSBITE_GOOGLE_LOGIN_ENABLED: 'true', GOOGLE_CLIENT_ID: 'synthetic', VITE_GOOGLE_CLIENT_ID: 'different' }).auth.google.configured, false)
  assert.equal(config({ CAMPUSBITE_GOOGLE_LOGIN_ENABLED: 'true', GOOGLE_CLIENT_ID: 'synthetic', VITE_GOOGLE_CLIENT_ID: 'synthetic' }).auth.google.configured, true)
})

test('Railway PORT wins in production; local port, host override and defaults are preserved', () => {
  assert.equal(config({ PORT: '8080', CAMPUSBITE_API_PORT: '3002' }).port, 8080)
  assert.equal(config({ CAMPUSBITE_API_PORT: '3002' }).port, 3002)
  assert.equal(config().port, 3001)
  const local = config({ NODE_ENV: 'development', PORT: '8080', CAMPUSBITE_API_PORT: '3002' })
  assert.equal(local.port, 3002)
  assert.equal(local.host, '127.0.0.1')
  assert.equal(config({ CAMPUSBITE_API_HOST: '127.0.0.2' }).host, '127.0.0.2')
  for (const value of ['0', '-1', '65536', '1.5', 'invalid']) {
    const result = evaluate(configUrl, 'serverConfig', { PORT: value })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Invalid PORT/)
  }
})

test('SQLite keeps an explicitly configured volume path and local fallback', () => {
  assert.equal(config({ CAMPUSBITE_DB_PATH: '/app/data/campusbite.db' }).databasePath, path.resolve('/app/data/campusbite.db'))
  assert.equal(config().databasePath, path.join(root, 'data/campusbite.db'))
})

test('Vercel keeps API prefix and prohibits shared caching; demo has no backend routes', () => {
  const result = evaluate(vercelUrl, 'config', { CAMPUSBITE_BACKEND_URL: 'https://backend.example.com/' })
  assert.equal(result.status, 0, result.stderr)
  const value = JSON.parse(result.stdout)
  assert.deepEqual(value.rewrites, [{ source: '/api/:path*', destination: 'https://backend.example.com/api/:path*' }])
  assert.ok(value.headers[0].headers.every(({ value }) => value === 'no-store'))
  const demo = evaluate(vercelUrl, 'config', { VITE_DEMO_MODE: 'true' })
  assert.equal(demo.status, 0, demo.stderr)
  assert.deepEqual(JSON.parse(demo.stdout).rewrites, [])
})

test('Vercel connected configuration fails closed for missing or unsafe backend origins', () => {
  for (const url of ['', 'http://backend.example.com', 'https://user:pass@backend.example.com', 'https://backend.example.com/api', 'https://backend.example.com?q=1', 'https://backend.example.com/#fragment']) {
    const result = evaluate(vercelUrl, 'config', { CAMPUSBITE_BACKEND_URL: url })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /CAMPUSBITE_BACKEND_URL/)
  }
})

test('production entry point starts on platform PORT with synthetic providers and an isolated database', { timeout: 15000 }, async () => {
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'campusbite-startup-'))
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `${noPrivateEnv} globalThis.fetch = () => { throw new Error('Provider network access forbidden in smoke test'); }; await import(${JSON.stringify(new URL('../index.js', import.meta.url).href)});`,
  ], { cwd: root, env: { ...baseEnvironment, PORT: String(port), CAMPUSBITE_API_PORT: '1',
    CAMPUSBITE_DB_PATH: path.join(databaseDirectory, 'synthetic.db'),
    CAMPUSBITE_META_WHATSAPP_ACCESS_TOKEN: 'synthetic',
    CAMPUSBITE_META_WHATSAPP_PHONE_NUMBER_ID: '123456',
    CAMPUSBITE_META_WHATSAPP_WABA_ID: '123456',
    CAMPUSBITE_META_WHATSAPP_TEMPLATE_NAME: 'synthetic',
    CAMPUSBITE_META_WHATSAPP_GRAPH_VERSION: 'v23.0',
  }, stdio: ['ignore', 'pipe', 'pipe'] })
  const closed = once(child, 'close')
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timed out')), 8000)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Startup exited early')) })
      child.stdout.on('data', (chunk) => {
        if (chunk.toString().includes(`Listening at http://0.0.0.0:${port}`)) { clearTimeout(timer); resolve() }
      })
    })
    const response = await fetch(`http://127.0.0.1:${port}/api/health`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  } finally {
    child.kill()
    await closed
    rmSync(databaseDirectory, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

test('the app initializes identity only from the server session', () => {
  const authContext = read('src/auth/AuthContext.jsx')

  assert.match(authContext, /export function AuthProvider\(\{ children \}\)/)
  assert.match(authContext, /useState\(null\)/)
  assert.match(authContext, /useState\(true\)/)
  assert.match(authContext, /getCurrentUser\(\{ signal \}\)/)
  assert.doesNotMatch(authContext, /campusbite-user|__setRole/)
})

test('login keeps Google and password authentication without client role controls', () => {
  const loginScreen = read('src/components/LoginScreen.jsx')

  assert.match(loginScreen, /<GoogleSignInButton/)
  assert.match(loginScreen, /await login\(identifier, password\)/)
  assert.doesNotMatch(loginScreen, /setUser|localStorage|data-pilot|1-Tap/)
})

test('pilot injection and credential scripts are not present', () => {
  for (const script of [
    'perfect_pilot.cjs',
    'launch_live_now.cjs',
    'unlock_pilot.cjs',
    'deploy_pilot.cjs',
  ]) {
    assert.equal(existsSync(path.join(root, script)), false, `${script} remains`)
  }
})

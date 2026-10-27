import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { initializeDatabase } from '../db.js'
import { initiatePayment } from '../services/payments.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

test('payments switched off: initiation is refused before any attempt or stock hold', async (t) => {
  const db = initializeDatabase(':memory:')
  t.after(() => db.close())
  await assert.rejects(
    initiatePayment(db, { idempotencyKey: 'off-1', items: [{ menuItemId: 1, quantity: 1 }], pickupMethod: 'asap' }, 1, { enabled: false }, null),
    { code: 'payments_unavailable' },
  )
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_attempts').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM stock_reservations').get().n, 0)
})

test('the menu API tells the app whether payments are switched on', () => {
  const server = read('server/index.js')
  assert.match(server, /paymentsEnabled: Boolean\(serverConfig\.payments\.enabled && paymentProvider\)/)
})

test('checkout never invites payment while the server reports payments off', () => {
  const app = read('src/App.jsx')
  assert.match(app, /const paymentsOff = liveMenu\?\.menu\?\.paymentsEnabled === false/)
  assert.match(app, /cartItems\.length === 0 \|\| paymentsOff\) return/)
  assert.match(app, /disabled=\{isSubmittingOrder \|\| \(paymentsOff && user\.phoneVerified\)\}/)
  assert.match(app, /'Online ordering opens soon'/)
})

test('student sign-in screens no longer promise a WhatsApp code', () => {
  for (const file of ['src/components/LoginScreen.jsx', 'src/components/PhoneOnboardingScreen.jsx']) {
    assert.ok(!/WhatsApp/.test(read(file)), `${file} still mentions WhatsApp`)
    assert.match(read(file), /one-time code/)
  }
})

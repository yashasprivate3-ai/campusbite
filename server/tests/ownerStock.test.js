import { createSession } from '../services/auth.js'
import { handleOwnerStockRoutes } from '../routes/ownerStock.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initializeDatabase } from '../db.js'
import { getOwnerStock, confirmOwnerStock } from '../services/ownerStock.js'
import { campusDate } from '../../shared/pickupPolicy.js'

const now = new Date('2026-10-17T12:00:00+05:30')
const serviceDate = campusDate(now)

function setup(t) {
  const db = initializeDatabase(':memory:')
  t.after(() => db.close())
  return db
}

function createTestReservation(db, menuItemId, quantity, suffix) {
  const student = db.prepare(`
    INSERT INTO users
      (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES (?, 'STUDENT', 'Stock Test Student', ?, 1, 'ACTIVE')
  `).run(`stock-student-${suffix}`, `+919000001${String(suffix).padStart(3, '0')}`)

  const attempt = db.prepare(`
    INSERT INTO payment_attempts (
      public_id, student_user_id, provider, provider_order_id,
      amount_paise, currency, trusted_cart_json,
      checkout_details_json, request_fingerprint,
      idempotency_key, status, expires_at
    )
    VALUES (?, ?, 'razorpay', ?, 10000, 'INR', ?, '{}', ?, ?, 'pending', ?)
  `).run(
    `stock-attempt-${suffix}`,
    Number(student.lastInsertRowid),
    `order_stock_${suffix}`,
    JSON.stringify({ items: [{ menuItemId, quantity }] }),
    `stock-fingerprint-${suffix}`,
    `stock-key-${suffix}`,
    '2026-10-17T13:00:00+05:30'
  )

  db.prepare(`
    INSERT INTO stock_reservations
      (attempt_id, service_date, menu_item_id, quantity)
    VALUES (?, ?, ?, ?)
  `).run(Number(attempt.lastInsertRowid), serviceDate, menuItemId, quantity)
}
const authSettings = {
  cookieName: 'owner_stock_test_session',
  cookieSecure: false,
  sessionTtlHours: 1,
  sessionTouchMinutes: 15,
}

let roleRequestCounter = 0

function createRoleRequest(db, role, method) {
  roleRequestCounter += 1
  const suffix = roleRequestCounter

  const user = db.prepare(`
    INSERT INTO users
      (public_id, role, display_name, phone_number, phone_verified, status)
    VALUES (?, ?, ?, ?, 1, 'ACTIVE')
  `).run(
    `stock-auth-${suffix}`,
    role,
    `${role} Test User`,
    `+91910000${String(suffix).padStart(4, '0')}`,
  )

  const request = {
    method,
    url: '/api/owner/stock',
    headers: { 'user-agent': 'owner-stock-test' },
    socket: { remoteAddress: '127.0.0.1' },
  }

  const session = createSession(
    db,
    Number(user.lastInsertRowid),
    request,
    authSettings,
  )

  request.headers.cookie =
    `${authSettings.cookieName}=${session.rawToken}`

  return request
}
test('owner stock starts unconfirmed and can be explicitly confirmed', t => {
  const db = setup(t)

  const before = getOwnerStock(db, now)
  assert.ok(before.items.every(item => !item.confirmed))

  const after = confirmOwnerStock(db, [
    { id: 1, quantity: 10 },
  ], now)

  assert.equal(after.items.find(item => item.id === 1).quantity, 10)
  assert.equal(after.items.find(item => item.id === 1).remaining, 10)
  assert.equal(after.items.find(item => item.id === 2).confirmed, false)
})

test('owner cannot reduce stock below existing reservations', t => {
  const db = setup(t)

  confirmOwnerStock(db, [{ id: 1, quantity: 10 }], now)

  createTestReservation(db, 1, 5, 1)

  assert.throws(
    () => confirmOwnerStock(db, [{ id: 1, quantity: 4 }], now),
    { code: 'stock_below_reservations' },
  )

  const stock = getOwnerStock(db, now).items.find(item => item.id === 1)
  assert.equal(stock.quantity, 10)
  assert.equal(stock.reserved, 5)
  assert.equal(stock.remaining, 5)
})

test('owner stock update rolls back all changes if one item fails', t => {
  const db = setup(t)

  confirmOwnerStock(db, [
    { id: 1, quantity: 10 },
    { id: 2, quantity: 10 },
  ], now)

  createTestReservation(db, 2, 6, 2)

  assert.throws(
    () => confirmOwnerStock(db, [
      { id: 1, quantity: 25 },
      { id: 2, quantity: 3 },
    ], now),
    { code: 'stock_below_reservations' },
  )

  const stock = getOwnerStock(db, now)
  assert.equal(stock.items.find(item => item.id === 1).quantity, 10)
  assert.equal(stock.items.find(item => item.id === 2).quantity, 10)
})

test('owner stock rejects invalid quantities and duplicate IDs', t => {
  const db = setup(t)

  assert.throws(
    () => confirmOwnerStock(db, [{ id: 1, quantity: -1 }], now),
  )

  assert.throws(
    () => confirmOwnerStock(db, [{ id: 1, quantity: 1.5 }], now),
  )

  assert.throws(
    () => confirmOwnerStock(db, [
      { id: 1, quantity: 5 },
      { id: 1, quantity: 8 },
    ], now),
  )

  assert.ok(getOwnerStock(db, now).items.every(item => !item.confirmed))
})

test('owner stock route requires authentication', async t => {
  const db = setup(t)
  const request = {
    method: 'GET',
    url: '/api/owner/stock',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  }
  const requestUrl = new URL(request.url, 'http://localhost')

  await assert.rejects(
    handleOwnerStockRoutes(request, {}, requestUrl, db, authSettings),
    { statusCode: 401, code: 'authentication_required' },
  )
})

test('student and kitchen sessions cannot read owner stock', async t => {
  const db = setup(t)

  for (const role of ['STUDENT', 'KITCHEN']) {
    const request = createRoleRequest(db, role, 'GET')
    const requestUrl = new URL(request.url, 'http://localhost')

    await assert.rejects(
      handleOwnerStockRoutes(request, {}, requestUrl, db, authSettings),
      { statusCode: 403, code: 'forbidden' },
    )
  }
})

test('student and kitchen sessions cannot update owner stock', async t => {
  const db = setup(t)

  for (const role of ['STUDENT', 'KITCHEN']) {
    const request = createRoleRequest(db, role, 'PUT')
    const requestUrl = new URL(request.url, 'http://localhost')

    await assert.rejects(
      handleOwnerStockRoutes(request, {}, requestUrl, db, authSettings),
      { statusCode: 403, code: 'forbidden' },
    )
  }

  assert.ok(getOwnerStock(db, now).items.every(item => !item.confirmed))
})

test('authenticated owner can read confirmed stock', async t => {
  const db = setup(t)
  const routeNow = new Date()

  confirmOwnerStock(db, [{ id: 1, quantity: 12 }], routeNow)

  const request = createRoleRequest(db, 'OWNER', 'GET')
  const requestUrl = new URL(request.url, 'http://localhost')

  let responseStatus
  let responseHeaders
  let responseBody

  const response = {
    writeHead(status, headers) {
      responseStatus = status
      responseHeaders = headers
    },
    end(body) {
      responseBody = body
    },
  }

  const handled = await handleOwnerStockRoutes(
    request,
    response,
    requestUrl,
    db,
    authSettings,
  )

  assert.equal(handled, true)
  assert.equal(responseStatus, 200)
  assert.equal(responseHeaders['Cache-Control'], 'no-store')

  const payload = JSON.parse(responseBody)
  const item = payload.items.find(entry => entry.id === 1)

  assert.equal(item.confirmed, true)
  assert.equal(item.quantity, 12)
  assert.equal(item.reserved, 0)
  assert.equal(item.remaining, 12)
})

test('authenticated owner can update stock through PUT route', async t => {
  const db = setup(t)
  const routeNow = new Date()
  const request = createRoleRequest(db, 'OWNER', 'PUT')

  const body = Buffer.from(JSON.stringify({
    items: [{ id: 1, quantity: 15 }],
  }))

  request[Symbol.asyncIterator] = async function* () {
    yield body
  }

  let responseStatus
  let responseBody

  const response = {
    writeHead(status) {
      responseStatus = status
    },
    end(payload) {
      responseBody = payload
    },
  }

  const handled = await handleOwnerStockRoutes(
    request,
    response,
    new URL(request.url, 'http://localhost'),
    db,
    authSettings,
  )

  assert.equal(handled, true)
  assert.equal(responseStatus, 200)

  const payload = JSON.parse(responseBody)
  const item = payload.items.find(entry => entry.id === 1)

  assert.equal(item.confirmed, true)
  assert.equal(item.quantity, 15)
  assert.equal(item.remaining, 15)

  const saved = getOwnerStock(db, routeNow).items.find(entry => entry.id === 1)
  assert.equal(saved.quantity, 15)
})
test('held and consumed stock remains committed while released stock becomes available', t => {
  const db = setup(t)

  confirmOwnerStock(db, [{ id: 1, quantity: 10 }], now)

  createTestReservation(db, 1, 2, 901)
  createTestReservation(db, 1, 3, 902)
  createTestReservation(db, 1, 4, 903)

  const updateStatus = db.prepare(`
    UPDATE stock_reservations
    SET status = ?
    WHERE attempt_id = (
      SELECT id FROM payment_attempts WHERE public_id = ?
    )
  `)

  updateStatus.run('held', 'stock-attempt-901')
  updateStatus.run('consumed', 'stock-attempt-902')
  updateStatus.run('released', 'stock-attempt-903')

  const stock = getOwnerStock(db, now).items.find(item => item.id === 1)

  assert.equal(stock.quantity, 10)
  assert.equal(stock.reserved, 5)
  assert.equal(stock.remaining, 5)

  assert.throws(
    () => confirmOwnerStock(db, [{ id: 1, quantity: 4 }], now),
    { code: 'stock_below_reservations' },
  )

  const updated = confirmOwnerStock(db, [{ id: 1, quantity: 5 }], now)
  assert.equal(updated.items.find(item => item.id === 1).remaining, 0)
})

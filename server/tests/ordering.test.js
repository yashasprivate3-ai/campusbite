import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initializeDatabase } from '../db.js'
import { TRUSTED_MENU } from '../data/menu.js'
import { initiatePayment, handlePaymentWebhook } from '../services/payments.js'
import { menuAvailability } from '../services/menuAvailability.js'
import { getOrder, updateOrderStatus } from '../services/orders.js'
import { pickupWindows, validatePickup, campusDate } from '../../shared/pickupPolicy.js'
import { calculateBatches } from '../../src/utils/batchCalculator.js'
import { getProductionSummaryBatches, createBatchSnapshot, startBatchRecord, findActiveBatchRecord } from '../../src/utils/kitchenIntelligence.js'
import { sanitizeCart } from '../../src/utils/cartState.js'

const noon = new Date('2026-10-17T12:00:00+05:30')
function setup(t, stock = 20, now = noon) {
  const db = initializeDatabase(':memory:')
  t.after(() => db.close())
  db.prepare("INSERT INTO users (public_id,role,display_name,phone_number,phone_verified,status) VALUES ('order-test','STUDENT','Test','+919000000061',1,'ACTIVE')").run()
  if (stock !== null) for (const item of TRUSTED_MENU) db.prepare('INSERT INTO daily_menu_stock VALUES (?,?,?)').run(campusDate(now), item.id, stock)
  const state = { calls: 0, orderId: '', amount: 0 }
  const config = { enabled: true, provider: 'razorpay', orderingClock: () => now }
  const gateway = { name: 'razorpay',
    async createProviderOrder({ amountPaise }) { state.calls++; state.orderId = 'order_test' + state.calls; state.amount = amountPaise; return { orderId: state.orderId, amountPaise, currency: 'INR', providerCode: 'created', providerMessage: 'Synthetic created' } },
    buildSafeCheckoutConfiguration() { return { provider: 'razorpay' } },
    parseWebhook() { return { orderId: state.orderId, amountPaise: state.amount, currency: 'INR', paymentId: 'pay_synthetic', captured: true, status: 'paid', providerCode: 'paid', providerMessage: 'Synthetic captured' } },
  }
  return { db, config, gateway, state }
}
const cart = (key = 'order-request-one', overrides = {}) => ({ idempotencyKey: key, items: [{ menuItemId: 1, quantity: 2 }], pickupMethod: 'asap', ...overrides })

test('campus pickup windows enforce exact one-hour cutoff, real dates and IST day rollover', () => {
  const atCutoff = new Date('2026-10-17T11:30:00+05:30')
  const slot = pickupWindows(atCutoff)[1].value
  assert.doesNotThrow(() => validatePickup('scheduled', slot, atCutoff))
  assert.throws(() => validatePickup('scheduled', slot, new Date(atCutoff.getTime() + 1)), /one hour/)
  for (const invalid of ['12:30 PM - 12:45 PM', slot.replace('2026-10-17', '2026-10-18'), '2099-01-01 fake']) {
    assert.throws(() => validatePickup('scheduled', invalid, atCutoff), /current campus/)
  }
  assert.equal(campusDate('2026-10-16T20:00:00Z'), '2026-10-17')
  assert.deepEqual(pickupWindows(atCutoff).map(s => s.label), ['10:30 AM - 10:45 AM','12:30 PM - 12:45 PM','2:30 PM - 2:45 PM'])
})

test('unconfigured or sold-out stock fails closed before payment and leaves no partial reservations', async t => {
  const { db, config, gateway, state } = setup(t, null)
  assert.ok(menuAvailability(db, 'asap', null, noon).items.every(item => !item.available && !item.stockConfigured))
  await assert.rejects(initiatePayment(db, cart(), 1, config, gateway), { code: 'item_unavailable' })
  assert.equal(state.calls, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_attempts').get().n, 0)
  db.prepare('INSERT INTO daily_menu_stock VALUES (?,?,?)').run(campusDate(noon), 1, 2)
  await assert.rejects(initiatePayment(db, cart('multi-stock-fail', { items: [{ menuItemId: 1, quantity: 2 }, { menuItemId: 4, quantity: 1 }] }), 1, config, gateway), { code: 'item_unavailable' })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM stock_reservations').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_attempts').get().n, 0)
})

test('stock is reserved atomically, cannot oversell concurrently, and idempotent reuse does not reserve twice', async t => {
  const { db, config, gateway, state } = setup(t, 2)
  const results = await Promise.allSettled([
    initiatePayment(db, cart('stock-request-1'), 1, config, gateway),
    initiatePayment(db, cart('stock-request-2'), 1, config, gateway),
  ])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(state.calls, 1)
  assert.equal(db.prepare('SELECT SUM(quantity) n FROM stock_reservations').get().n, 2)
  const reused = await initiatePayment(db, cart('stock-request-1'), 1, config, gateway)
  assert.equal(reused.reused, true)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM stock_reservations').get().n, 1)
  handlePaymentWebhook(db, Buffer.from('{}'), 'synthetic', config, gateway)
  handlePaymentWebhook(db, Buffer.from('{}'), 'synthetic', config, gateway)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 1)
  assert.equal(db.prepare('SELECT SUM(quantity) n FROM stock_reservations').get().n, 2)
  assert.equal(menuAvailability(db, 'asap', null, noon).items.find(item => item.id === 1).available, false)
})

test('uncertain payment timeout retains its stock hold for safe late-capture recovery', async t => {
  const { db, config, gateway } = setup(t, 2)
  gateway.createProviderOrder = async () => { const error = new Error('Synthetic timeout'); error.code = 'payment_gateway_timeout'; throw error }
  await assert.rejects(initiatePayment(db, cart(), 1, config, gateway), /timeout/)
  assert.equal(db.prepare('SELECT status FROM payment_attempts').get().status, 'pending')
  assert.equal(menuAvailability(db, 'asap', null, noon).items.find(item => item.id === 1).remaining, 0)
})

test('rice, ready-now items and scheduled admission follow the supplied break/ready constraints', async t => {
  const early = new Date('2026-10-17T09:00:00+05:30')
  const { db, config, gateway, state } = setup(t, 20, early)
  let live = menuAvailability(db, 'asap', null, early)
  assert.equal(live.items.find(item => item.id === 1).available, false)
  assert.equal(live.items.find(item => item.id === 3).available, true)
  assert.equal(live.items.find(item => item.id === 4).preparationMinutes, 0)
  const morningSlot = pickupWindows(early)[0].value
  await assert.rejects(initiatePayment(db, cart('early-rice-slot', { pickupMethod: 'scheduled', pickupSlot: morningSlot }), 1, config, gateway), /11:15/)
  assert.equal(state.calls, 0)
  const lunchSlot = pickupWindows(early)[1].value
  await initiatePayment(db, cart('rice-lunch-slot', { pickupMethod: 'scheduled', pickupSlot: lunchSlot }), 1, config, gateway)
  assert.equal(state.calls, 1)
  const boundary = new Date('2026-10-17T11:15:00+05:30')
  assert.equal(menuAvailability(db, 'asap', null, new Date(boundary.getTime()-1)).items.find(item => item.id===1).available, false)
  live = menuAvailability(db, 'asap', null, boundary)
  assert.equal(live.items.find(item => item.id===1).available, true)
  assert.deepEqual(TRUSTED_MENU.map(item => item.unitPricePaise), [7000,5500,4500,2000,2500,1500])
})

test('backend rejects late slots before provider calls but permits recovery of a previously admitted attempt', async t => {
  const now = new Date('2026-10-17T11:30:00+05:30')
  const { db, config, gateway, state } = setup(t, 20, now)
  const payload = cart('scheduled-reuse', { pickupMethod: 'scheduled', pickupSlot: pickupWindows(now)[1].value })
  await initiatePayment(db, payload, 1, config, gateway)
  config.orderingClock = () => new Date(now.getTime()+1)
  const reused = await initiatePayment(db, payload, 1, config, gateway)
  assert.equal(reused.reused, true)
  await assert.rejects(initiatePayment(db, { ...payload, idempotencyKey: 'new-request-late' }, 1, config, gateway), /one hour/)
  assert.equal(state.calls, 1)
})

function syntheticOrder(token, overrides = {}) {
  return { token, status: 'new', pickupMethod: 'scheduled', pickupSlot: '2026-10-17 12:30 PM - 12:45 PM', instructions: '', createdAt: noon.toISOString(),
    items: [{ menuItemId: 1, name: 'Veg Fried Rice', quantity: 2, preparationType: 'made-to-order' }],
    statusHistory: [{ status: 'new', batchItem: null }], ...overrides }
}

test('batches combine only identical item/slot/date/instruction/stage requirements', () => {
  const same = [syntheticOrder('A'), syntheticOrder('B')]
  assert.equal(calculateBatches(same).length, 1)
  assert.equal(calculateBatches(same)[0].requiredQuantity, 4)
  for (const different of [ { pickupSlot: '2026-10-17 2:30 PM - 2:45 PM' }, { instructions: 'No onion' }, { pickupMethod: 'asap', pickupSlot: null },
    { createdAt: '2026-10-16T06:30:00Z' }, { status: 'preparing', statusHistory: [{status:'preparing',batchItem:null}] } ]) {
    assert.equal(calculateBatches([same[0],syntheticOrder('B',different)]).length, 2)
  }
  const batch = calculateBatches(same)[0]
  const snapshot = createBatchSnapshot(batch, [same[0]], 'new')
  assert.deepEqual(snapshot.linkedOrders, ['A'])
  assert.equal(snapshot.batchKey, batch.batchKey)
  const records = startBatchRecord([], snapshot, noon.toISOString())
  assert.equal(records[0].requiredQuantity, 2)
  assert.equal(findActiveBatchRecord({ ...batch, batchKey: 'different-slot' }, records), undefined)
})

test('mixed-item order becomes READY only after each item finishes, with strict per-item sequencing', t => {
  const { db } = setup(t)
  const inserted = db.prepare("INSERT INTO orders (token,pickup_method,total_amount,status) VALUES ('MIXED','asap',9000,'new')").run()
  const id = Number(inserted.lastInsertRowid)
  for (const item of [{ id:1,name:'Veg Fried Rice',price:7000 },{id:4,name:'Samosa',price:2000}]) {
    db.prepare('INSERT INTO order_items (order_id,menu_item_id,item_name,quantity,unit_price_paise) VALUES (?,?,?,?,?)').run(id,item.id,item.name,1,item.price)
  }
  db.prepare("INSERT INTO status_history (order_id,status) VALUES (?,'new')").run(id)
  assert.throws(()=>updateOrderStatus(db,id,{status:'ready',batchItem:'Veg Fried Rice'}),{code:'invalid_status_transition'})
  updateOrderStatus(db,id,{status:'preparing',batchItem:'Veg Fried Rice'})
  const partial = updateOrderStatus(db,id,{status:'ready',batchItem:'Veg Fried Rice'})
  assert.equal(partial.status,'preparing')
  const summaries = getProductionSummaryBatches([partial], [])
  assert.equal(summaries.activeBatches.length,1)
  assert.equal(summaries.activeBatches[0].itemName,'Samosa')
  assert.equal(summaries.activeBatches[0].stage,'new')
  updateOrderStatus(db,id,{status:'preparing',batchItem:'Samosa'})
  assert.equal(updateOrderStatus(db,id,{status:'ready',batchItem:'Samosa'}).status,'ready')
  assert.throws(()=>updateOrderStatus(db,id,{status:'preparing',batchItem:'Samosa'}),{code:'invalid_status_transition'})
  assert.throws(()=>updateOrderStatus(db,id,{status:'ready',batchItem:'Not on order'}),{code:'invalid_request'})
  assert.equal(getOrder(db,id).status,'ready')
})

test('persisted cart rejects corrupt IDs, oversized quantities and non-object data', () => {
  assert.deepEqual(sanitizeCart({1:2,2:21,3:-1,4:'2',5:1.5,6:1,999:2,'01':2},[1,2,3,4,5,6]),{1:2,6:1})
  for(const corrupt of [null,[],true,'bad']) assert.deepEqual(sanitizeCart(corrupt,[1]),{})
})

test('queue-informed recommendations favor ready items during workload and expose compatible batch demand', t => {
  const { db } = setup(t)
  const order = db.prepare("INSERT INTO orders (token,pickup_method,instructions,total_amount,status,created_at) VALUES ('BUSY','asap','',7000,'new',?)").run(noon.toISOString())
  db.prepare('INSERT INTO order_items (order_id,menu_item_id,item_name,quantity,unit_price_paise) VALUES (?,?,?,?,?)').run(Number(order.lastInsertRowid),1,'Veg Fried Rice',1,7000)
  const live = menuAvailability(db, 'asap', null, noon)
  assert.equal(live.queuedItems,1)
  assert.equal(live.items.find(item=>item.id===1).batchableQuantity,1)
  assert.equal(live.items.find(item=>item.recommended).preparationMinutes,0)
  assert.equal(live.workloadEstimateConfirmed,false)
})
test('student availability excludes released reservations but counts held and consumed', async t => {
  const { db, config, gateway } = setup(t, 6)

  await initiatePayment(db, cart('status-test-held'), 1, config, gateway)
  await initiatePayment(db, cart('status-test-consumed'), 1, config, gateway)
  await initiatePayment(db, cart('status-test-released'), 1, config, gateway)

  const initial = menuAvailability(db, 'asap', null, noon)
    .items.find(item => item.id === 1)

  assert.equal(initial.remaining, 0)

  const updateStatus = db.prepare(`
    UPDATE stock_reservations
    SET status = ?
    WHERE attempt_id = (
      SELECT id FROM payment_attempts WHERE idempotency_key = ?
    )
  `)

  updateStatus.run('consumed', 'status-test-consumed')
  updateStatus.run('released', 'status-test-released')

  const after = menuAvailability(db, 'asap', null, noon)
    .items.find(item => item.id === 1)

  assert.equal(after.remaining, 2)
  assert.equal(after.available, true)

  const held = db.prepare(
    "SELECT COUNT(*) AS count FROM stock_reservations WHERE status = 'held'"
  ).get().count

  assert.equal(held, 1)
})

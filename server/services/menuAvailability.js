import { listOrders } from './orders.js'
import { itemStatus } from '../../shared/batchPolicy.js'
import { TRUSTED_MENU } from '../data/menu.js'
import { ApiError } from './apiError.js'
import { campusDate, campusMinute, pickupWindows, validatePickup, maximumPreparationMinutes } from '../../shared/pickupPolicy.js'

function stockFor(database, date, itemId) {
  return database.prepare(`SELECT s.quantity - COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r
    WHERE r.service_date = s.service_date AND r.menu_item_id = s.menu_item_id), 0) AS remaining
    FROM daily_menu_stock s WHERE service_date = ? AND menu_item_id = ?`).get(date, itemId)
}

export function menuAvailability(database, pickupMethod = 'asap', pickupSlot = null, now = new Date()) {
  let pickup
  let slotError
  try { pickup = validatePickup(pickupMethod, pickupSlot, now) } catch (error) { slotError = error.message }
  const date = campusDate(now)
  const queuedOrders = listOrders(database, ['new', 'preparing']).filter(order => campusDate(order.createdAt) === date)
  const items = TRUSTED_MENU.map(item => {
    const stock = stockFor(database, date, item.id)
    // The latest end of the supplied rice-ready window is the safe boundary.
    const preparationAvailable = item.id !== 1 || (pickupMethod === 'scheduled' ? pickup?.minute >= 675 : campusMinute(now) >= 675)
    const remaining = Math.max(0, Number(stock?.remaining || 0))
    const batchableQuantity = queuedOrders.filter(order => order.pickupMethod === pickupMethod && order.pickupSlot === (pickupMethod === 'scheduled' ? pickupSlot : null) && !order.instructions)
      .reduce((sum, order) => sum + order.items.filter(line => line.menuItemId === item.id && itemStatus(order, line.name) !== 'ready').reduce((total, line) => total + line.quantity, 0), 0)
    return { id: item.id, batchableQuantity, available: Boolean(item.available && pickup && preparationAvailable && stock && remaining > 0),
      remaining, stockConfigured: Boolean(stock), preparationMinutes: maximumPreparationMinutes(item),
      reason: slotError || (!preparationAvailable ? 'Rice is available from 11:15 AM.' : !stock ? 'Stock confirmation pending.' : remaining < 1 ? 'Sold out for today.' : null) }
  })
  const queuedItems = queuedOrders.reduce((sum, order) => sum + order.items.reduce((total, item) => total + item.quantity, 0), 0)
  const candidates = items.filter(item => item.available).sort((a, b) => (queuedItems > 0 ? (a.preparationMinutes === 0 ? -1 : 1) - (b.preparationMinutes === 0 ? -1 : 1) : 0) || b.batchableQuantity - a.batchableQuantity || a.preparationMinutes - b.preparationMinutes)
  if (candidates[0]) candidates[0].recommended = true
  return { serviceDate: date, slots: pickupWindows(now), queuedItems, workloadEstimateConfirmed: false, items }
}

export function reserveCartStock(database, attemptId, cart, checkout, now = new Date()) {
  const availability = menuAvailability(database, checkout.pickupMethod, checkout.pickupSlot, now)
  for (const item of cart.items) {
    const live = availability.items.find(candidate => candidate.id === item.menuItemId)
    if (!live?.available || item.quantity > live.remaining) {
      throw new ApiError(409, 'item_unavailable', live?.reason || 'Your cart exceeds the remaining stock. Please review it.')
    }
    database.prepare(`INSERT INTO stock_reservations (attempt_id, service_date, menu_item_id, quantity) VALUES (?, ?, ?, ?)`)
      .run(attemptId, availability.serviceDate, item.menuItemId, item.quantity)
  }
}

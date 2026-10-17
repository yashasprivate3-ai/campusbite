import { campusDate } from './pickupPolicy.js'

export function itemStatus(order, itemName) {
  const history = (order.statusHistory || []).filter(entry => !entry.batchItem || entry.batchItem === itemName)
  return history.at(-1)?.status || order.status || 'new'
}

export function batchKey(order, item) {
  return JSON.stringify([
    item.menuItemId || item.name, item.preparationType || '',
    order.pickupMethod || 'asap', order.pickupSlot || '',
    order.createdAt ? campusDate(order.createdAt) : 'legacy-undated',
    order.instructions || '',
  ])
}

import { batchKey, itemStatus } from '../../shared/batchPolicy.js'

export function calculateBatches(orders) {
  const groups = new Map()
  for (const order of orders) for (const item of order.items) {
    const stage = itemStatus(order, item.name)
    const compatibilityKey = batchKey(order, item)
    const key = JSON.stringify([compatibilityKey, stage])
    if (!groups.has(key)) groups.set(key, {
      batchKey: compatibilityKey, itemName: item.name, menuItemId: item.menuItemId,
      pickupMethod: order.pickupMethod, pickupSlot: order.pickupSlot,
      instructions: order.instructions || '', stage, requiredQuantity: 0, linkedOrders: [],
    })
    const batch = groups.get(key)
    batch.requiredQuantity += item.quantity
    if (!batch.linkedOrders.includes(order.token)) batch.linkedOrders.push(order.token)
  }
  return [...groups.values()]
}

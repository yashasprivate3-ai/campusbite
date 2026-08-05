import { invalidRequest } from '../services/apiError.js'

const MAX_ITEM_QUANTITY = 20
const MAX_CART_ITEMS = 50

export const TRUSTED_MENU = Object.freeze([
  Object.freeze({ id: 1, name: 'Veg Fried Rice', unitPricePaise: 7000, preparationType: 'made-to-order', preparationTime: '8-10 min', available: true }),
  Object.freeze({ id: 2, name: 'Masala Dosa', unitPricePaise: 5500, preparationType: 'made-to-order', preparationTime: '7-9 min', available: true }),
  Object.freeze({ id: 3, name: 'Grilled Sandwich', unitPricePaise: 4500, preparationType: 'made-to-order', preparationTime: '5-7 min', available: true }),
  Object.freeze({ id: 4, name: 'Samosa', unitPricePaise: 2000, preparationType: 'ready', preparationTime: 'Ready now', available: true }),
  Object.freeze({ id: 5, name: 'Filter Coffee', unitPricePaise: 2500, preparationType: 'made-to-order', preparationTime: '2-3 min', available: true }),
  Object.freeze({ id: 6, name: 'Masala Tea', unitPricePaise: 1500, preparationType: 'ready', preparationTime: 'Ready now', available: true }),
])

const menuById = new Map(TRUSTED_MENU.map((item) => [item.id, item]))

function requireQuantity(value, index) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_ITEM_QUANTITY) {
    throw invalidRequest(
      `items[${index}].quantity must be a whole number between 1 and ${MAX_ITEM_QUANTITY}.`,
    )
  }

  return value
}

export function buildTrustedCartSnapshot(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw invalidRequest('At least one cart item is required.')
  }

  if (items.length > MAX_CART_ITEMS) {
    throw invalidRequest(`A cart may contain no more than ${MAX_CART_ITEMS} lines.`)
  }

  const seenIds = new Set()
  const snapshot = items.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw invalidRequest(`items[${index}] must be an object.`)
    }

    const keys = Object.keys(candidate)
    if (keys.some((key) => !['menuItemId', 'quantity'].includes(key))) {
      throw invalidRequest('Cart items may contain only menuItemId and quantity.')
    }

    if (!Number.isSafeInteger(candidate.menuItemId) || candidate.menuItemId < 1) {
      throw invalidRequest(`items[${index}].menuItemId must be a positive integer.`)
    }

    if (seenIds.has(candidate.menuItemId)) {
      throw invalidRequest(`Menu item ${candidate.menuItemId} appears more than once.`)
    }
    seenIds.add(candidate.menuItemId)

    const menuItem = menuById.get(candidate.menuItemId)
    if (!menuItem || !menuItem.available) {
      throw invalidRequest(`Menu item ${candidate.menuItemId} is unavailable.`)
    }

    const quantity = requireQuantity(candidate.quantity, index)
    const lineTotalPaise = menuItem.unitPricePaise * quantity

    return Object.freeze({
      menuItemId: menuItem.id,
      name: menuItem.name,
      quantity,
      unitPricePaise: menuItem.unitPricePaise,
      lineTotalPaise,
      preparationType: menuItem.preparationType,
      preparationTime: menuItem.preparationTime,
    })
  })

  const totalPaise = snapshot.reduce(
    (total, item) => total + item.lineTotalPaise,
    0,
  )

  if (!Number.isSafeInteger(totalPaise) || totalPaise < 1) {
    throw invalidRequest('The trusted cart total is invalid.')
  }

  return Object.freeze({ items: Object.freeze(snapshot), totalPaise })
}

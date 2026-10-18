import { TRUSTED_MENU } from '../data/menu.js'
import { ApiError, invalidRequest } from './apiError.js'
import { campusDate } from '../../shared/pickupPolicy.js'

export function getOwnerStock(database, now = new Date()) {
  const serviceDate = campusDate(now)

  const rows = database.prepare(`
    SELECT
      m.menu_item_id,
      m.quantity,
      COALESCE(SUM(r.quantity), 0) AS reserved
    FROM daily_menu_stock m
LEFT JOIN stock_reservations r
  ON r.service_date = m.service_date
  AND r.menu_item_id = m.menu_item_id
  AND r.status IN ('held', 'consumed')
WHERE m.service_date = ?
GROUP BY m.menu_item_id, m.quantity
  `).all(serviceDate)

  const byId = new Map(rows.map(row => [row.menu_item_id, row]))

  return {
    serviceDate,
    items: TRUSTED_MENU.map(item => {
      const row = byId.get(item.id)
      const confirmed = Boolean(row)
      const reserved = Number(row?.reserved || 0)

      return {
        id: item.id,
        name: item.name,
        confirmed,
        quantity: confirmed ? Number(row.quantity) : null,
        reserved,
        remaining: confirmed
          ? Math.max(0, Number(row.quantity) - reserved)
          : null,
      }
    }),
  }
}

export function confirmOwnerStock(database, items, now = new Date()) {
  if (!Array.isArray(items) || items.length === 0) {
    throw invalidRequest('Provide at least one stock item.')
  }

  if (items.length > TRUSTED_MENU.length) {
    throw invalidRequest('Too many stock items.')
  }

  const validIds = new Set(TRUSTED_MENU.map(item => item.id))
  const seenIds = new Set()

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw invalidRequest('Each stock item must be an object.')
    }

    if (
      !Number.isSafeInteger(item.id) ||
      !validIds.has(item.id) ||
      seenIds.has(item.id)
    ) {
      throw invalidRequest('Invalid or duplicate menu item ID.')
    }

    if (
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 0 ||
      item.quantity > 100000
    ) {
      throw invalidRequest('Stock quantity must be a whole number between 0 and 100000.')
    }

    seenIds.add(item.id)
  }

  const serviceDate = campusDate(now)

  database.exec('BEGIN IMMEDIATE;')

  try {
    const reservedStatement = database.prepare(`
      SELECT COALESCE(SUM(quantity), 0) AS reserved
FROM stock_reservations
WHERE service_date = ?
  AND menu_item_id = ?
  AND status IN ('held', 'consumed')
    `)

    const upsertStatement = database.prepare(`
      INSERT INTO daily_menu_stock (service_date, menu_item_id, quantity)
      VALUES (?, ?, ?)
      ON CONFLICT(service_date, menu_item_id)
      DO UPDATE SET quantity = excluded.quantity
    `)

    for (const item of items) {
      const { reserved } = reservedStatement.get(serviceDate, item.id)

      if (item.quantity < reserved) {
        throw new ApiError(
          409,
          'stock_below_reservations',
          `Item ${item.id} already has ${reserved} units reserved.`,
        )
      }

      upsertStatement.run(serviceDate, item.id, item.quantity)
    }

    database.exec('COMMIT;')
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }

  return getOwnerStock(database, now)
}

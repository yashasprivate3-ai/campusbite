import { createHash, randomUUID } from 'node:crypto'
import { ApiError, invalidRequest } from './apiError.js'

export const ORDER_STATUSES = Object.freeze(['new', 'preparing', 'ready'])

const NEXT_STATUS = Object.freeze({
  new: 'preparing',
  preparing: 'ready',
})

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRequest(`${label} must be an object.`)
  }

  return value
}

function requireString(value, label, { maxLength, minLength = 1 } = {}) {
  if (typeof value !== 'string') {
    throw invalidRequest(`${label} must be a string.`)
  }

  const normalized = value.trim()

  if (normalized.length < minLength) {
    throw invalidRequest(`${label} is required.`)
  }

  if (maxLength && normalized.length > maxLength) {
    throw invalidRequest(`${label} must be ${maxLength} characters or fewer.`)
  }

  return normalized
}

function optionalString(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return null
  return requireString(value, label, { maxLength })
}

function requireInteger(value, label, { min = 0, max } = {}) {
  if (!Number.isSafeInteger(value) || value < min || (max && value > max)) {
    const maximum = max ? ` and no more than ${max}` : ''
    throw invalidRequest(`${label} must be an integer of at least ${min}${maximum}.`)
  }

  return value
}

function normalizeItem(item, index) {
  requireObject(item, `items[${index}]`)

  return {
    menuItemId:
      item.menuItemId === undefined || item.menuItemId === null
        ? null
        : requireInteger(item.menuItemId, `items[${index}].menuItemId`, {
            min: 1,
          }),
    name: requireString(item.name, `items[${index}].name`, {
      maxLength: 120,
    }),
    quantity: requireInteger(item.quantity, `items[${index}].quantity`, {
      min: 1,
      max: 50,
    }),
    unitPricePaise: requireInteger(
      item.unitPricePaise,
      `items[${index}].unitPricePaise`,
      { min: 0, max: 1_000_000 },
    ),
    preparationType: optionalString(
      item.preparationType,
      `items[${index}].preparationType`,
      50,
    ),
    preparationTime: optionalString(
      item.preparationTime,
      `items[${index}].preparationTime`,
      50,
    ),
  }
}

function normalizeCreatePayload(payload) {
  requireObject(payload, 'Request body')

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw invalidRequest('At least one order item is required.')
  }

  if (payload.items.length > 50) {
    throw invalidRequest('An order may contain no more than 50 line items.')
  }

  const pickupMethod = requireString(payload.pickupMethod, 'pickupMethod', {
    maxLength: 20,
  })

  if (!['asap', 'scheduled'].includes(pickupMethod)) {
    throw invalidRequest('pickupMethod must be either "asap" or "scheduled".')
  }

  const pickupSlot = optionalString(payload.pickupSlot, 'pickupSlot', 80)

  if (pickupMethod === 'scheduled' && !pickupSlot) {
    throw invalidRequest('pickupSlot is required for a scheduled pickup.')
  }

  const items = payload.items.map(normalizeItem)
  const totalPaise = items.reduce(
    (total, item) => total + item.unitPricePaise * item.quantity,
    0,
  )

  if (!Number.isSafeInteger(totalPaise)) {
    throw invalidRequest('The order total is too large.')
  }

  return {
    clientRequestId: requireString(
      payload.clientRequestId,
      'clientRequestId',
      { minLength: 8, maxLength: 100 },
    ),
    pickupMethod,
    pickupSlot: pickupMethod === 'scheduled' ? pickupSlot : null,
    instructions:
      optionalString(payload.instructions, 'instructions', 120) || '',
    source: 'student',
    items,
    totalPaise,
  }
}

function createFingerprint(order) {
  const canonicalOrder = {
    pickupMethod: order.pickupMethod,
    pickupSlot: order.pickupSlot,
    instructions: order.instructions,
    source: order.source,
    items: order.items,
    totalPaise: order.totalPaise,
  }

  return createHash('sha256')
    .update(JSON.stringify(canonicalOrder))
    .digest('hex')
}

function normalizeTimestamp(timestamp) {
  if (!timestamp) return null

  const value = String(timestamp)
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  const isoValue = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(hasTimeZone ? isoValue : `${isoValue}Z`)

  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function mapItem(row) {
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    name: row.item_name,
    quantity: row.quantity,
    price: row.unit_price_paise / 100,
    unitPricePaise: row.unit_price_paise,
    preparationType: row.preparation_type,
    time: row.preparation_time,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  }
}

function mapStatusHistory(row) {
  return {
    id: row.id,
    status: row.status,
    batchItem: row.batch_item,
    at: normalizeTimestamp(row.status_at),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  }
}

function mapOrder(row, items, statusHistory) {
  return {
    id: row.id,
    token: row.token,
    clientRequestId: row.client_request_id,
    pickupMethod: row.pickup_method,
    pickupSlot: row.pickup_slot,
    instructions: row.instructions,
    source: row.source,
    total: row.total_amount / 100,
    totalPaise: row.total_amount,
    status: row.status,
    items,
    statusHistory,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  }
}

function selectItems(database, orderId) {
  return database
    .prepare(
      `SELECT id, order_id, menu_item_id, item_name, quantity,
              unit_price_paise, preparation_type, preparation_time,
              created_at, updated_at
         FROM order_items
        WHERE order_id = ?
        ORDER BY id ASC`,
    )
    .all(orderId)
    .map(mapItem)
}

function selectStatusHistory(database, orderId) {
  return database
    .prepare(
      `SELECT id, order_id, status, batch_item, status_at,
              created_at, updated_at
         FROM status_history
        WHERE order_id = ?
        ORDER BY status_at ASC, id ASC`,
    )
    .all(orderId)
    .map(mapStatusHistory)
}

function selectOrderRow(database, orderId) {
  return database
    .prepare(
      `SELECT id, token, client_request_id, request_fingerprint,
              student_user_id, pickup_method, pickup_slot, instructions,
              source, total_amount,
              status, created_at, updated_at
         FROM orders
        WHERE id = ?`,
    )
    .get(orderId)
}

function getOrderOrNull(database, orderId) {
  const row = selectOrderRow(database, orderId)
  if (!row) return null

  return mapOrder(
    row,
    selectItems(database, row.id),
    selectStatusHistory(database, row.id),
  )
}

function findIdempotentOrder(database, clientRequestId) {
  return database
    .prepare(
      `SELECT id, request_fingerprint, student_user_id
         FROM orders
        WHERE client_request_id = ?`,
    )
    .get(clientRequestId)
}

function resolveIdempotentOrder(
  database,
  normalizedOrder,
  fingerprint,
  studentUserId,
) {
  const existing = findIdempotentOrder(
    database,
    normalizedOrder.clientRequestId,
  )

  if (!existing) return null

  if (existing.student_user_id !== studentUserId) {
    throw new ApiError(
      409,
      'idempotency_conflict',
      'This checkout request ID cannot be reused.',
    )
  }

  if (
    existing.request_fingerprint &&
    existing.request_fingerprint !== fingerprint
  ) {
    throw new ApiError(
      409,
      'idempotency_conflict',
      'This checkout request ID was already used for a different order.',
    )
  }

  return getOrderOrNull(database, existing.id)
}

function createUniqueToken(database) {
  const tokenExists = database.prepare('SELECT 1 FROM orders WHERE token = ?')

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const token = `CB-${randomUUID().slice(0, 8).toUpperCase()}`
    if (!tokenExists.get(token)) return token
  }

  throw new Error('Unable to allocate a unique order token.')
}

export function createOrder(database, payload, studentUserId) {
  if (!Number.isSafeInteger(studentUserId) || studentUserId < 1) {
    throw new Error('Authenticated student ownership is required.')
  }

  const normalizedOrder = normalizeCreatePayload(payload)
  const fingerprint = createFingerprint(normalizedOrder)
  const existingOrder = resolveIdempotentOrder(
    database,
    normalizedOrder,
    fingerprint,
    studentUserId,
  )

  if (existingOrder) return { created: false, order: existingOrder }

  database.exec('BEGIN IMMEDIATE;')

  try {
    const concurrentOrder = resolveIdempotentOrder(
      database,
      normalizedOrder,
      fingerprint,
      studentUserId,
    )

    if (concurrentOrder) {
      database.exec('COMMIT;')
      return { created: false, order: concurrentOrder }
    }

    const token = createUniqueToken(database)
    const orderResult = database
      .prepare(
         `INSERT INTO orders (
           token, client_request_id, request_fingerprint, student_user_id,
           pickup_method, pickup_slot, instructions, source, total_amount,
           status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
      )
      .run(
        token,
        normalizedOrder.clientRequestId,
        fingerprint,
        studentUserId,
        normalizedOrder.pickupMethod,
        normalizedOrder.pickupSlot,
        normalizedOrder.instructions,
        normalizedOrder.source,
        normalizedOrder.totalPaise,
      )
    const orderId = Number(orderResult.lastInsertRowid)
    const insertItem = database.prepare(
      `INSERT INTO order_items (
         order_id, menu_item_id, item_name, quantity, unit_price_paise,
         preparation_type, preparation_time
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )

    normalizedOrder.items.forEach((item) => {
      insertItem.run(
        orderId,
        item.menuItemId,
        item.name,
        item.quantity,
        item.unitPricePaise,
        item.preparationType,
        item.preparationTime,
      )
    })

    database
      .prepare(
        `INSERT INTO status_history (order_id, status)
         VALUES (?, 'new')`,
      )
      .run(orderId)
    database
      .prepare(
        `INSERT INTO activity_events (order_id, event_type, detail)
         VALUES (?, 'order_received', ?)`,
      )
      .run(orderId, token)

    database.exec('COMMIT;')
    return { created: true, order: getOrderOrNull(database, orderId) }
  } catch (error) {
    database.exec('ROLLBACK;')

    if (String(error.message).includes('orders.client_request_id')) {
      const idempotentOrder = resolveIdempotentOrder(
        database,
        normalizedOrder,
        fingerprint,
        studentUserId,
      )
      if (idempotentOrder) return { created: false, order: idempotentOrder }
    }

    throw error
  }
}

export function listOrders(database, statuses = []) {
  const placeholders = statuses.map(() => '?').join(', ')
  const whereClause = statuses.length
    ? `WHERE status IN (${placeholders})`
    : ''
  const rows = database
    .prepare(
      `SELECT id, token, client_request_id, request_fingerprint,
              student_user_id, pickup_method, pickup_slot, instructions,
              source, total_amount,
              status, created_at, updated_at
         FROM orders
         ${whereClause}
        ORDER BY created_at DESC, id DESC`,
    )
    .all(...statuses)

  return rows.map((row) =>
    mapOrder(
      row,
      selectItems(database, row.id),
      selectStatusHistory(database, row.id),
    ),
  )
}

export function getOrder(database, orderId, studentUserId) {
  const row = selectOrderRow(database, orderId)
  const isOwnedByStudent =
    studentUserId === undefined || row?.student_user_id === studentUserId
  const order = row && isOwnedByStudent ? getOrderOrNull(database, orderId) : null

  if (!order) {
    throw new ApiError(404, 'order_not_found', 'The requested order was not found.')
  }

  return order
}

export function updateOrderStatus(database, orderId, payload) {
  requireObject(payload, 'Request body')
  const nextStatus = requireString(payload.status, 'status', { maxLength: 20 })

  if (!ORDER_STATUSES.includes(nextStatus)) {
    throw invalidRequest(`status must be one of: ${ORDER_STATUSES.join(', ')}.`)
  }

  const batchItem = optionalString(payload.batchItem, 'batchItem', 120)

  database.exec('BEGIN IMMEDIATE;')

  try {
    const currentOrder = selectOrderRow(database, orderId)

    if (!currentOrder) {
      throw new ApiError(
        404,
        'order_not_found',
        'The requested order was not found.',
      )
    }

    const expectedStatus = NEXT_STATUS[currentOrder.status]

    if (expectedStatus !== nextStatus) {
      throw new ApiError(
        409,
        'invalid_status_transition',
        `Order ${currentOrder.token} cannot move from ${currentOrder.status} to ${nextStatus}.`,
        { currentStatus: currentOrder.status, allowedStatus: expectedStatus || null },
      )
    }

    database
      .prepare(
        `UPDATE orders
            SET status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
      )
      .run(nextStatus, orderId)
    database
      .prepare(
        `INSERT INTO status_history (order_id, status, batch_item)
         VALUES (?, ?, ?)`,
      )
      .run(orderId, nextStatus, batchItem)
    database
      .prepare(
        `INSERT INTO activity_events (order_id, event_type, detail)
         VALUES (?, ?, ?)`,
      )
      .run(
        orderId,
        nextStatus === 'ready' ? 'order_ready' : 'order_preparing',
        batchItem || currentOrder.token,
      )

    database.exec('COMMIT;')
    return getOrderOrNull(database, orderId)
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }
}

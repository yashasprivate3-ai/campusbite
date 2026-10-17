import { campusDate } from '../../shared/pickupPolicy.js'
import { itemStatus } from '../../shared/batchPolicy.js'
import { calculateBatches } from './batchCalculator.js'

function hasSameTokens(left = [], right = []) {
  if (left.length !== right.length) return false

  const rightTokens = new Set(right)
  return left.every((token) => rightTokens.has(token))
}

function findStatusTime(order, status, batchItem) {
  const matches = (order.statusHistory || []).filter(
    (entry) =>
      entry.status === status &&
      (!batchItem || !entry.batchItem || entry.batchItem === batchItem),
  )

  return matches.at(-1)?.at || null
}

export function isToday(timestamp, now = new Date()) {
  if (!timestamp) return false

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return false

  return (
    campusDate(date) === campusDate(now)
  )
}

export function getKitchenMetrics(orders, batchRecords, now = new Date()) {
  const todayOrders = orders.filter((order) => isToday(order.createdAt, now))
  const completedOrders = todayOrders.filter(order => order.status === 'ready')

  return {
    total: todayOrders.length,
    new: todayOrders.filter((order) => order.status === 'new').length,
    preparing: todayOrders.filter((order) => order.status === 'preparing').length,
    ready: todayOrders.filter((order) => order.status === 'ready').length,
    completed: completedOrders.length,
    activeBatches: calculateBatches(todayOrders.filter(order => order.status !== 'ready')).filter(batch => batch.stage === 'preparing').length,
  }
}

export function getProductionSummaryBatches(orders, batchRecords) {
  const activeBatches = calculateBatches(
    orders.filter(
      (order) => order.status === 'new' || order.status === 'preparing',
    ),
  ).filter(batch => batch.stage !== 'ready').map((batch) => ({
    ...batch,
    summaryKey: `active-${batch.batchKey}-${batch.stage}`,
  }))
  const activeItemNames = new Set(
    activeBatches.map((batch) => batch.batchKey),
  )

  const latestCompletedRecords = new Map()
  batchRecords
    .filter((batch) => batch.status === 'completed' && batch.completedAt)
    .forEach((batch) => {
      const current = latestCompletedRecords.get(batch.batchKey || batch.id)
      if (!current || batch.completedAt > current.completedAt) {
        latestCompletedRecords.set(batch.batchKey || batch.id, batch)
      }
    })

  const completedBatches = [...latestCompletedRecords.values()]
    .filter((batch) => !activeItemNames.has(batch.batchKey))
    .map((batch) => ({
      itemName: batch.itemName,
      batchKey: batch.batchKey,
      requiredQuantity: batch.requiredQuantity,
      linkedOrders: [...batch.linkedOrders],
      summaryKey: `completed-${batch.id}`,
    }))

  const legacyCompletedBatches = calculateBatches(
    orders.filter((order) => order.status === 'ready'),
  )
    .filter(
      (batch) =>
        !activeItemNames.has(batch.batchKey) &&
        !latestCompletedRecords.has(batch.batchKey),
    )
    .map((batch) => ({
      ...batch,
      summaryKey: `legacy-completed-${batch.batchKey}`,
    }))

  return {
    activeBatches,
    displayedBatches: [
      ...activeBatches,
      ...completedBatches,
      ...legacyCompletedBatches,
    ],
  }
}

export function createBatchSnapshot(batch, orders, status) {
  const linkedOrders = orders.filter(
    (order) => batch.linkedOrders.includes(order.token) && itemStatus(order, batch.itemName) === status,
  )

  return {
    itemName: batch.itemName,
    batchKey: batch.batchKey,
    linkedOrders: linkedOrders.map((order) => order.token),
    requiredQuantity: linkedOrders.reduce(
      (total, order) =>
        total +
        order.items
          .filter((item) => item.name === batch.itemName)
          .reduce((quantity, item) => quantity + item.quantity, 0),
      0,
    ),
  }
}

export function startBatchRecord(records, batch, startedAt) {
  if (batch.linkedOrders.length === 0) return records

  const alreadyActive = records.some(
    (record) =>
      record.status === 'preparing' && record.itemName === batch.itemName && record.batchKey === batch.batchKey,
  )
  if (alreadyActive) return records.map(record => {
    if (record.status !== 'preparing' || record.batchKey !== batch.batchKey) return record
    if (batch.linkedOrders.every(token => record.linkedOrders.includes(token))) return record
    return { ...record, requiredQuantity: record.requiredQuantity + batch.requiredQuantity,
      linkedOrders: [...new Set([...record.linkedOrders, ...batch.linkedOrders])] }
  })

  return [
    ...records,
    {
      id: `batch-${startedAt}-${batch.batchKey}`,
      itemName: batch.itemName,
      batchKey: batch.batchKey,
      requiredQuantity: batch.requiredQuantity,
      linkedOrders: [...batch.linkedOrders],
      startedAt,
      completedAt: null,
      status: 'preparing',
    },
  ]
}

export function completeBatchRecord(records, batch, completedAt) {
  if (batch.linkedOrders.length === 0) return records

  const activeIndex = records.findLastIndex(
    (record) =>
      record.status === 'preparing' && record.itemName === batch.itemName && record.batchKey === batch.batchKey,
  )

  if (activeIndex === -1) {
    const alreadyCompleted = records.some(
      (record) =>
        record.status === 'completed' &&
        record.itemName === batch.itemName && record.batchKey === batch.batchKey &&
        hasSameTokens(record.linkedOrders, batch.linkedOrders),
    )
    if (alreadyCompleted) return records

    return [
      ...records,
      {
        id: `batch-${completedAt}-${batch.batchKey}`,
        itemName: batch.itemName,
        batchKey: batch.batchKey,
        requiredQuantity: batch.requiredQuantity,
        linkedOrders: [...batch.linkedOrders],
        startedAt: completedAt,
        completedAt,
        status: 'completed',
      },
    ]
  }

  return records.map((record, index) =>
    index === activeIndex
      ? { ...record, requiredQuantity: batch.requiredQuantity, linkedOrders: [...batch.linkedOrders], status: 'completed', completedAt }
      : record,
  )
}

export function findActiveBatchRecord(batch, records) {
  return records.findLast(
    (record) =>
      record.status === 'preparing' &&
      record.itemName === batch.itemName && record.batchKey === batch.batchKey &&
      record.linkedOrders.every((token) => batch.linkedOrders.includes(token)),
  )
}

export function getBatchStartedAt(batch, linkedOrders, records) {
  const activeRecord = findActiveBatchRecord(batch, records)
  if (activeRecord?.startedAt) return activeRecord.startedAt

  const preparationTimes = linkedOrders
    .map((order) => findStatusTime(order, 'preparing', batch.itemName))
    .filter(Boolean)
    .sort()

  return preparationTimes[0] || null
}

export function getBatchPriorities(batches, orders) {
  const activeBatches = batches
    .map((batch) => {
      const linkedOrders = batch.linkedOrders
        .map((token) => orders.find((order) => order.token === token))
        .filter((order) => order && order.status !== 'ready')

      return {
        itemName: batch.itemName,
        batchKey: batch.batchKey,
        linkedCount: batch.linkedOrders.length,
        hasActiveOrders: linkedOrders.length > 0,
        waitingSince: linkedOrders
          .map((order) => order.createdAt)
          .filter(Boolean)
          .sort()[0],
      }
    })
    .filter((batch) => batch.hasActiveOrders)

  if (activeBatches.length === 0) return {}

  const highestCount = Math.max(
    ...activeBatches.map((batch) => batch.linkedCount),
  )
  const longestWait = activeBatches
    .map((batch) => batch.waitingSince)
    .filter(Boolean)
    .sort()[0]

  return Object.fromEntries(
    activeBatches.map((batch) => [
      batch.batchKey,
      {
        highVolume: batch.linkedCount === highestCount,
        longestWait: Boolean(longestWait && batch.waitingSince === longestWait),
      },
    ]),
  )
}

export function buildKitchenActivity(orders, batchRecords) {
  const activities = []

  orders.forEach((order) => {
    const receivedAt =
      (order.statusHistory || []).find((entry) => entry.status === 'new')?.at ||
      order.createdAt

    if (receivedAt) {
      activities.push({
        id: `order-received-${order.token}`,
        type: 'order-received',
        title: 'Order received',
        detail: order.token,
        at: receivedAt,
      })
    }

    ;(order.statusHistory || [])
      .filter((entry) => entry.status === 'ready')
      .forEach((entry, index) => {
        activities.push({
          id: `order-ready-${order.token}-${index}`,
          type: 'order-ready',
          title: 'Order ready',
          detail: order.token,
          at: entry.at,
        })
      })
  })

  batchRecords.forEach((batch) => {
    activities.push({
      id: `batch-started-${batch.id}`,
      type: 'batch-started',
      title: 'Batch started',
      detail: `${batch.itemName} · ${batch.linkedOrders.length} linked`,
      at: batch.startedAt,
    })

    if (batch.completedAt) {
      activities.push({
        id: `batch-completed-${batch.id}`,
        type: 'batch-completed',
        title: 'Batch completed',
        detail: `${batch.itemName} · ${batch.requiredQuantity} prepared`,
        at: batch.completedAt,
      })
    }
  })

  return activities
    .filter((activity) => activity.at)
    .sort((left, right) => new Date(right.at) - new Date(left.at))
}

export function formatElapsed(startedAt, endedAt = Date.now()) {
  const startTime = new Date(startedAt).getTime()
  const endTime =
    endedAt instanceof Date ? endedAt.getTime() : new Date(endedAt).getTime()
  const elapsedSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000))
  const hours = Math.floor(elapsedSeconds / 3600)
  const minutes = Math.floor((elapsedSeconds % 3600) / 60)
  const seconds = elapsedSeconds % 60

  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, '0')}m`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

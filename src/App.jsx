import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { BatchHistory } from './components/BatchHistory'
import BatchTimer from './components/BatchTimer'
import { CollapsiblePanel } from './components/CollapsiblePanel'
import { KitchenActivityFeed } from './components/KitchenActivityFeed'
import { LiveKitchenDashboard } from './components/KitchenMetrics'
import { KitchenStatistics } from './components/KitchenStatistics'
import { OrderTracking } from './components/OrderTracking'
import { OrderTrackingState } from './components/OrderTrackingState'
import { useKitchenOrders } from './hooks/useKitchenOrders'
import { useTrackedOrder } from './hooks/useTrackedOrder'
import { createOrder } from './services/ordersApi'
import {
  buildKitchenActivity,
  completeBatchRecord,
  createBatchSnapshot,
  findActiveBatchRecord,
  getBatchPriorities,
  getBatchStartedAt,
  getKitchenMetrics,
  getProductionSummaryBatches,
  startBatchRecord,
} from './utils/kitchenIntelligence'

const menuItems = [
  { id: 1, name: 'Veg Fried Rice', description: 'Wok-tossed rice with fresh vegetables and house seasoning.', price: 70, category: 'Meals', emoji: '🍚', time: '8-10 min', popular: true },
  { id: 2, name: 'Masala Dosa', description: 'Crisp dosa served with potato masala, chutney and sambar.', price: 55, category: 'Meals', emoji: '🥞', time: '7-9 min' },
  { id: 3, name: 'Grilled Sandwich', description: 'Toasted vegetable sandwich with a warm, crisp finish.', price: 45, category: 'Snacks', emoji: '🥪', time: '5-7 min' },
  { id: 4, name: 'Samosa', description: 'Fresh, crisp and ready for a quick pickup.', price: 20, category: 'Ready now', emoji: '🥟', time: 'Ready now' },
  { id: 5, name: 'Filter Coffee', description: 'Freshly brewed, strong and served hot.', price: 25, category: 'Beverages', emoji: '☕', time: '2-3 min' },
  { id: 6, name: 'Masala Tea', description: 'Comforting tea brewed with milk and aromatic spices.', price: 15, category: 'Beverages', emoji: '🍵', time: 'Ready now' },
]

const categories = ['All', 'Ready now', 'Meals', 'Snacks', 'Beverages']
const pickupSlots = ['12:00 PM - 12:15 PM', '12:15 PM - 12:30 PM', '12:30 PM - 12:45 PM', '1:00 PM - 1:15 PM']

const KITCHEN_BATCHES_KEY = 'campusbite-kitchen-batches'
const TRACKED_ORDER_ID_KEY = 'campusbite-tracked-order-id'

function loadKitchenBatches() {
  try {
    const storedBatches =
      JSON.parse(localStorage.getItem(KITCHEN_BATCHES_KEY)) || []

    return storedBatches.map((batch) => ({
      ...batch,
      startedAt: normalizeStoredTimestamp(batch.startedAt),
      completedAt: normalizeStoredTimestamp(batch.completedAt),
    }))
  } catch {
    return []
  }
}

function normalizeStoredTimestamp(timestamp) {
  if (!timestamp || timestamp.includes('T')) return timestamp
  return `${timestamp.replace(' ', 'T')}Z`
}

function loadTrackedOrderId() {
  const storedOrderId = Number(localStorage.getItem(TRACKED_ORDER_ID_KEY))
  return Number.isSafeInteger(storedOrderId) && storedOrderId > 0
    ? storedOrderId
    : null
}

const KITCHEN_QUEUE_STATUSES = ['new', 'preparing', 'ready']

function KitchenDashboard({
  batchRecords,
  error,
  isBusy,
  isLoading,
  orders,
  onCompleteBatch,
  onRetry,
  onStartBatch,
  onStatusChange,
  pendingOrderIds,
}) {

  const { activeBatches } = useMemo(
    () => getProductionSummaryBatches(orders, batchRecords),
    [orders, batchRecords],
  )
  const metrics = useMemo(
    () => getKitchenMetrics(orders, batchRecords),
    [orders, batchRecords],
  )
  const priorities = useMemo(
    () => getBatchPriorities(activeBatches, orders),
    [activeBatches, orders],
  )
  const activities = useMemo(
    () => buildKitchenActivity(orders, batchRecords),
    [orders, batchRecords],
  )
  const activeOrders = orders.filter((order) => order.status !== 'ready')
  const completedBatchCount = batchRecords.filter(
    (batch) => batch.status === 'completed',
  ).length
  const ordersByStatus = useMemo(
    () =>
      Object.fromEntries(
        KITCHEN_QUEUE_STATUSES.map((status) => [
          status,
          orders.filter((order) => order.status === status),
        ]),
      ),
    [orders],
  )

  return (
    <main className="kitchen-main">

      <section className="kitchen-hero">
        <div>
          <p className="eyebrow">Sprint 4 · Live operations</p>
          <h1>Kitchen Queue</h1>
          <p>Prepare orders and update progress.</p>
        </div>

        <div className="kitchen-live">
          <span className="live-dot" aria-hidden="true" /> Live
          <span aria-hidden="true">•</span>
          <strong>{activeOrders.length}</strong> active orders
        </div>
      </section>

      {error && (
        <div className="api-state api-state-error" role="alert">
          <div>
            <strong>Kitchen service needs attention</strong>
            <span>{error}</span>
          </div>
          <button type="button" onClick={onRetry}>Retry</button>
        </div>
      )}

      {isLoading && orders.length === 0 && (
        <div className="api-state" role="status">
          <strong>Loading kitchen orders…</strong>
          <span>Connecting to the shared CampusBite order queue.</span>
        </div>
      )}

      <LiveKitchenDashboard metrics={metrics} />

<section className="prep-summary">
  <h2>Production Batch Summary</h2>
  <div className="prep-grid">
    {activeBatches.map((batch) => {
      const linkedOrders = batch.linkedOrders
        .map((token) => orders.find((order) => order.token === token))
        .filter(Boolean)
      const isPreparing = linkedOrders.some(
        (order) => order.status === 'preparing',
      )
      const activeRecord = findActiveBatchRecord(batch, batchRecords)
      const startedAt = getBatchStartedAt(batch, linkedOrders, batchRecords)
      const priority = priorities[batch.itemName]
      const isPriority =
        priority?.highVolume || priority?.longestWait

      return (
        <article
          className={`prep-item${isPriority ? ' priority-batch' : ''}`}
          key={batch.summaryKey}
        >
          <strong>{batch.requiredQuantity}</strong>
          <span>{batch.itemName}</span>
          <small>{batch.linkedOrders.length} orders linked</small>

          <div
            className={`batch-status ${isPreparing ? 'preparing' : 'ready-to-start'}`}
          >
            {isPreparing ? 'Preparing' : 'Ready to Start'}
          </div>

          {isPriority && (
            <div className="priority-indicators" aria-label="Batch priority">
              {priority.highVolume && <span>Highest volume</span>}
              {priority.longestWait && <span>Longest wait</span>}
            </div>
          )}

          {isPreparing && startedAt && (
            <BatchTimer
              key={activeRecord?.id || startedAt}
              startedAt={startedAt}
            />
          )}

          {isPreparing ? (
            <div className="batch-progress-actions">
              <button className="secondary" type="button" disabled>
                Order In Progress
              </button>
              <button
                className="primary-action"
                type="button"
                onClick={() => onCompleteBatch(batch)}
                disabled={isBusy}
              >
                {isBusy ? 'Updating…' : 'Complete Batch'}
              </button>
            </div>
          ) : (
            <button
              className="primary-action"
              type="button"
              onClick={() => onStartBatch(batch)}
              disabled={isBusy}
            >
              {isBusy ? 'Updating…' : 'Start Batch Preparation'}
            </button>
          )}
        </article>
      )
    })}

    {activeBatches.length === 0 && (
      <p className="prep-empty-state">No active production batches.</p>
    )}
  </div>
</section>
      <section className="kitchen-board" aria-label="Kitchen order queues">
        {KITCHEN_QUEUE_STATUSES.map((status) => {
          const statusOrders = ordersByStatus[status]
          const queueTitleId = `queue-${status}-title`

          return (
            <section
              className="order-column"
              key={status}
              aria-labelledby={queueTitleId}
            >
              <header className="queue-column-header">
                <h2 id={queueTitleId}>{status.toUpperCase()}</h2>
                <span>
                  {statusOrders.length}{' '}
                  {statusOrders.length === 1 ? 'Order' : 'Orders'}
                </span>
              </header>

              <div
                className="queue-scroll-region"
                tabIndex={statusOrders.length > 0 ? 0 : undefined}
                aria-label={`${status.toUpperCase()} orders`}
              >
                <div className="ticket-list">
                  {statusOrders.map((order) => (
                    <article className="order-ticket" key={order.token}>
                      <h3>{order.token}</h3>

                      {order.items.map((item) => (
                        <p key={item.id}>
                          {item.quantity} × {item.name}
                        </p>
                      ))}

                      <small>
                        {order.pickupMethod === 'scheduled'
                          ? order.pickupSlot
                          : 'ASAP pickup'}
                      </small>

                      {order.instructions && (
                        <p>Note: {order.instructions}</p>
                      )}

                      {status === 'new' && (
                        <button
                          onClick={() =>
                            onStatusChange(order.id, 'preparing')
                          }
                          disabled={pendingOrderIds.includes(order.id)}
                        >
                          {pendingOrderIds.includes(order.id)
                            ? 'Updating…'
                            : 'Start preparing'}
                        </button>
                      )}

                      {status === 'preparing' && (
                        <button
                          onClick={() => onStatusChange(order.id, 'ready')}
                          disabled={pendingOrderIds.includes(order.id)}
                        >
                          {pendingOrderIds.includes(order.id)
                            ? 'Updating…'
                            : 'Mark ready'}
                        </button>
                      )}
                    </article>
                  ))}

                  {statusOrders.length === 0 && (
                    <p className="column-empty">No {status} orders.</p>
                  )}
                </div>
              </div>
            </section>
          )
        })}
      </section>

      <div className="kitchen-collapsible-stack">
        <CollapsiblePanel
          id="kitchen-statistics"
          title="Kitchen Statistics"
          summary="Live operational summary"
        >
          <KitchenStatistics metrics={metrics} />
        </CollapsiblePanel>

        <CollapsiblePanel
          id="kitchen-activity"
          title="Activity Feed"
          summary={`${activities.length} recent events`}
        >
          <KitchenActivityFeed activities={activities} />
        </CollapsiblePanel>

        <CollapsiblePanel
          id="batch-history"
          title="Batch History"
          summary={`${completedBatchCount} completed`}
        >
          <BatchHistory batches={batchRecords} />
        </CollapsiblePanel>
      </div>

    </main>
  )
}
function App() {
  const [activeCategory, setActiveCategory] = useState('All')
  const [cart, setCart] = useState({})
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [checkoutStep, setCheckoutStep] = useState(null)
  const [pickupMethod, setPickupMethod] = useState('asap')
  const [pickupSlot, setPickupSlot] = useState(pickupSlots[0])
  const [instructions, setInstructions] = useState('')
  const [confirmedOrder, setConfirmedOrder] = useState(null)
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false)
  const [orderSubmitError, setOrderSubmitError] = useState('')
  const [activeView, setActiveView] = useState('student')
  const [kitchenBatches, setKitchenBatches] = useState(loadKitchenBatches)
  const [trackedOrderId, setTrackedOrderId] = useState(loadTrackedOrderId)
  const [studentView, setStudentView] = useState(() =>
    loadTrackedOrderId() ? 'tracking' : 'menu',
  )
  const checkoutRequestId = useRef(null)
  const checkoutSignature = JSON.stringify({
    cart,
    instructions: instructions.trim(),
    pickupMethod,
    pickupSlot: pickupMethod === 'scheduled' ? pickupSlot : null,
  })
  const checkoutSignatureRef = useRef(checkoutSignature)
  const joiningOrderIds = useRef(new Set())
  const {
    addOrder: addKitchenOrder,
    error: kitchenError,
    isLoading: isKitchenLoading,
    orders: kitchenOrders,
    pendingOrderIds,
    refreshOrders,
    updateOrderStatus: updateKitchenOrderStatus,
  } = useKitchenOrders()
  const {
    error: trackingError,
    isLoading: isTrackingLoading,
    order: trackedOrder,
    refreshOrder: refreshTrackedOrder,
    setOrder: setTrackedOrder,
  } = useTrackedOrder(
    trackedOrderId,
    activeView === 'student' && studentView === 'tracking',
  )

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [activeView, studentView])

  useEffect(() => {
    localStorage.setItem(KITCHEN_BATCHES_KEY, JSON.stringify(kitchenBatches))
  }, [kitchenBatches])

  useEffect(() => {
    if (trackedOrderId) {
      localStorage.setItem(TRACKED_ORDER_ID_KEY, String(trackedOrderId))
    }
  }, [trackedOrderId])

  useEffect(() => {
    if (
      checkoutSignatureRef.current !== checkoutSignature &&
      !isSubmittingOrder
    ) {
      checkoutSignatureRef.current = checkoutSignature
      checkoutRequestId.current = null
      setOrderSubmitError('')
    }
  }, [checkoutSignature, isSubmittingOrder])

  useEffect(() => {
    const activeBatchRecords = kitchenBatches.filter(
      (batch) => batch.status === 'preparing',
    )

    kitchenOrders
      .filter((order) => order.status === 'new')
      .forEach((order) => {
        const matchingRecord = activeBatchRecords.find((batch) =>
          order.items.some((item) => item.name === batch.itemName),
        )

        if (!matchingRecord || joiningOrderIds.current.has(order.id)) return

        joiningOrderIds.current.add(order.id)
        updateKitchenOrderStatus(order.id, 'preparing', {
          batchItem: matchingRecord.itemName,
        })
          .then(() => {
            setKitchenBatches((records) =>
              records.map((record) => {
                if (
                  record.id !== matchingRecord.id ||
                  record.linkedOrders.includes(order.token)
                ) {
                  return record
                }

                const addedQuantity = order.items
                  .filter((item) => item.name === record.itemName)
                  .reduce((total, item) => total + item.quantity, 0)

                return {
                  ...record,
                  linkedOrders: [...record.linkedOrders, order.token],
                  requiredQuantity: record.requiredQuantity + addedQuantity,
                }
              }),
            )
          })
          .catch(() => {
            // The shared kitchen error banner provides the retry path.
          })
          .finally(() => joiningOrderIds.current.delete(order.id))
      })
  }, [kitchenBatches, kitchenOrders, updateKitchenOrderStatus])

  const visibleItems = activeCategory === 'All' ? menuItems : menuItems.filter((item) => item.category === activeCategory)
  const cartItems = menuItems.filter((item) => cart[item.id])
  const cartCount = cartItems.reduce((total, item) => total + cart[item.id], 0)
  const cartTotal = cartItems.reduce((total, item) => total + item.price * cart[item.id], 0)
  function addItem(itemId) {
    setCart((currentCart) => ({ ...currentCart, [itemId]: (currentCart[itemId] || 0) + 1 }))
  }

  function removeItem(itemId) {
    setCart((currentCart) => {
      const nextQuantity = (currentCart[itemId] || 0) - 1
      const nextCart = { ...currentCart }
      if (nextQuantity <= 0) delete nextCart[itemId]
      else nextCart[itemId] = nextQuantity
      return nextCart
    })
  }
  function clearCart() {
    if (window.confirm('Remove every item from your cart?')) setCart({})
  }

  function openCheckout() {
    setIsCartOpen(false)
    setOrderSubmitError('')
    checkoutRequestId.current = null
    checkoutSignatureRef.current = checkoutSignature
    setCheckoutStep('details')
  }

  async function confirmOrder() {
    if (isSubmittingOrder || cartItems.length === 0) return

    const requestId = checkoutRequestId.current || crypto.randomUUID()
    checkoutRequestId.current = requestId
    setIsSubmittingOrder(true)
    setOrderSubmitError('')

    try {
      const savedOrder = await createOrder({
        clientRequestId: requestId,
        items: cartItems.map((item) => ({
          menuItemId: item.id,
          name: item.name,
          quantity: cart[item.id],
          unitPricePaise: item.price * 100,
          preparationType:
            item.category === 'Ready now' ? 'ready' : 'made-to-order',
          preparationTime: item.time,
        })),
        pickupMethod,
        pickupSlot: pickupMethod === 'scheduled' ? pickupSlot : null,
        instructions: instructions.trim(),
        source: 'student',
      })

      setConfirmedOrder(savedOrder)
      setTrackedOrderId(savedOrder.id)
      setTrackedOrder(savedOrder)
      addKitchenOrder(savedOrder)
      setCart({})
      setCheckoutStep('confirmation')
      checkoutRequestId.current = null
    } catch (error) {
      setOrderSubmitError(error.message)
    } finally {
      setIsSubmittingOrder(false)
    }
  }

  async function updateOrderStatus(orderId, status) {
    try {
      await updateKitchenOrderStatus(orderId, status)
    } catch {
      // The kitchen error banner keeps the failed server state visible.
    }
  }

  async function startBatch(batch) {
    const batchSnapshot = createBatchSnapshot(batch, kitchenOrders, 'new')
    const linkedOrders = kitchenOrders.filter(
      (order) =>
        batchSnapshot.linkedOrders.includes(order.token) &&
        order.status === 'new',
    )

    if (linkedOrders.length === 0) return

    const results = await Promise.allSettled(
      linkedOrders.map((order) =>
        updateKitchenOrderStatus(order.id, 'preparing', {
          batchItem: batch.itemName,
        }),
      ),
    )
    const updatedOrders = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value)

    if (updatedOrders.length > 0) {
      const startedAt =
        updatedOrders[0].statusHistory.at(-1)?.at || new Date().toISOString()
      setKitchenBatches((records) =>
        startBatchRecord(records, batchSnapshot, startedAt),
      )
    }

    if (results.some((result) => result.status === 'rejected')) {
      await refreshOrders({ silent: true })
    }
  }

  async function completeBatch(batch) {
    const batchSnapshot = createBatchSnapshot(
      batch,
      kitchenOrders,
      'preparing',
    )
    const linkedOrders = kitchenOrders.filter(
      (order) =>
        batchSnapshot.linkedOrders.includes(order.token) &&
        order.status === 'preparing',
    )

    if (linkedOrders.length === 0) return

    const results = await Promise.allSettled(
      linkedOrders.map((order) =>
        updateKitchenOrderStatus(order.id, 'ready', {
          batchItem: batch.itemName,
        }),
      ),
    )

    if (results.every((result) => result.status === 'fulfilled')) {
      const completedAt =
        results[0].value.statusHistory.at(-1)?.at || new Date().toISOString()
      setKitchenBatches((records) =>
        completeBatchRecord(records, batchSnapshot, completedAt),
      )
    } else {
      await refreshOrders({ silent: true })
    }
  }
  function finishOrder() {
    setCheckoutStep(null)
    setConfirmedOrder(null)
    setStudentView('menu')
    setPickupMethod('asap')
    setPickupSlot(pickupSlots[0])
    setInstructions('')
  }

  function openOrderTracking() {
    setCheckoutStep(null)
    setConfirmedOrder(null)
    setStudentView('tracking')
    setPickupMethod('asap')
    setPickupSlot(pickupSlots[0])
    setInstructions('')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="CampusBite home">
          <span className="brand-mark">CB</span>
          <span><strong>CampusBite</strong><small>Working name</small></span>
        </a>
        <div className="header-actions">
          <div className="view-switch" aria-label="Choose app view">
            <button
              className={activeView === 'student' ? 'active' : ''}
              onClick={() => setActiveView('student')}
            >
              Student
            </button>
            <button
              className={activeView === 'kitchen' ? 'active' : ''}
              onClick={() => {
                setActiveView('kitchen')
                setIsCartOpen(false)
              }}
            >
              Kitchen
            </button>
          </div>

          {activeView === 'student' && trackedOrderId && (
            <button
              className={`header-track${studentView === 'tracking' ? ' active' : ''}`}
              type="button"
              onClick={() => {
                setStudentView('tracking')
                setIsCartOpen(false)
              }}
              aria-label={`Track order ${trackedOrder?.token || trackedOrderId}`}
            >
              <span aria-hidden="true">◎</span>
              <span>Track order</span>
            </button>
          )}

          {activeView === 'student' && (
            <button
              className="header-cart"
              onClick={() => setIsCartOpen(true)}
              aria-label={`Open cart with ${cartCount} items`}
            >
              <span>My cart</span>
              <span className="cart-count">{cartCount}</span>
            </button>
          )}
        </div>
      </header>

      {activeView === 'kitchen' ? 
      <KitchenDashboard
  batchRecords={kitchenBatches}
  error={kitchenError}
  isBusy={pendingOrderIds.length > 0}
  isLoading={isKitchenLoading}
  orders={kitchenOrders}
  onStartBatch={startBatch}
  onCompleteBatch={completeBatch}
  onRetry={() => refreshOrders()}
  onStatusChange={updateOrderStatus}
  pendingOrderIds={pendingOrderIds}
/> : <>
      {studentView === 'tracking' ? (
        trackedOrder ? (
          <OrderTracking
            order={trackedOrder}
            onBackToMenu={() => setStudentView('menu')}
          />
        ) : (
          <OrderTrackingState
            error={trackingError}
            isLoading={isTrackingLoading}
            onBackToMenu={() => setStudentView('menu')}
            onRetry={refreshTrackedOrder}
          />
        )
      ) : (
      <main id="top">
        <section className="welcome-card">
          <div>
            <p className="eyebrow">SMART CAMPUS DINING</p>
            <h1>Order Smart just to Skip the long wait.</h1>
            <p className="welcome-copy">Fresh meals prepared when you need them.</p>
          </div>
          <div className="service-status" aria-label="Current service status">
            <span className="status-dot"></span>
            <span><strong>We will be live shortly....❤️</strong><small>Average pickup : 8–10 minutes</small></span>
          </div>
        </section>

        <section className="menu-section" aria-labelledby="menu-title">
          <div className="section-heading">
            <div><p className="eyebrow">Fresh from the canteen</p><h2 id="menu-title">Today's menu</h2></div>
            <p>{visibleItems.length} items available</p>
          </div>
          <div className="category-tabs" aria-label="Menu categories">
            {categories.map((category) => (
              <button className={activeCategory === category ? 'active' : ''} key={category} type="button" onClick={() => setActiveCategory(category)}>{category}</button>
            ))}
          </div>
          <div className="menu-grid">
            {visibleItems.map((item) => {
              const quantity = cart[item.id] || 0
              return (
                <article className="food-card" key={item.id}>
                  <div className="food-visual" aria-hidden="true"><span>{item.emoji}</span>{item.popular && <em>Popular</em>}</div>
                  <div className="food-content">
                    <div className="food-title-row"><h3>{item.name}</h3><strong>₹{item.price}</strong></div>
                    <p>{item.description}</p><span className="prep-time">{item.time}</span>
                    {quantity === 0 ? (
                      <button className="add-button" type="button" onClick={() => addItem(item.id)}>Add to cart</button>
                    ) : (
                      <div className="quantity-control" aria-label={`${item.name} quantity`}>
                        <button type="button" onClick={() => removeItem(item.id)}>−</button><span>{quantity}</span><button type="button" onClick={() => addItem(item.id)}>+</button>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </main>
      )}

      {studentView !== 'tracking' && cartCount > 0 && (
        <button className="cart-bar" type="button" onClick={() => setIsCartOpen(true)}>
          <span><strong>{cartCount} {cartCount === 1 ? 'item' : 'items'}</strong><small>₹{cartTotal}</small></span><span>View cart →</span>
        </button>
      )}

      {isCartOpen && (
        <div className="cart-overlay" role="presentation" onMouseDown={() => setIsCartOpen(false)}>
          <aside className="cart-panel" role="dialog" aria-modal="true" aria-labelledby="cart-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="cart-header">
              <div><p className="eyebrow">Your order</p><h2 id="cart-title">My cart</h2></div>
              <button type="button" onClick={() => setIsCartOpen(false)} aria-label="Close cart">×</button>
            </div>
            {cartItems.length === 0 ? (
              <div className="empty-cart"><span>🧺</span><h3>Your cart is empty</h3><p>Add something from today's menu to begin.</p><button type="button" onClick={() => setIsCartOpen(false)}>Browse menu</button></div>
            ) : (
              <>
                <div className="cart-items">
                  {cartItems.map((item) => (
                    <div className="cart-item" key={item.id}>
                      <span className="cart-item-emoji" aria-hidden="true">{item.emoji}</span>
                      <div><strong>{item.name}</strong><small>₹{item.price} each</small></div>
                      <div className="mini-quantity"><button type="button" onClick={() => removeItem(item.id)}>−</button><span>{cart[item.id]}</span><button type="button" onClick={() => addItem(item.id)}>+</button></div>
                    </div>
                  ))}
                </div>
                <div className="cart-summary">
                  <div><span>Item total</span><strong>₹{cartTotal}</strong></div>
                  <button className="clear-cart-button" type="button" onClick={clearCart}>Clear cart</button>
                  <p>Payment integration comes next. This checkout currently confirms a test order.</p>
                  <button className="checkout-button" type="button" onClick={openCheckout}>Continue to checkout · ₹{cartTotal}</button>
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {checkoutStep && (
        <div className="checkout-overlay">
          <section className="checkout-screen" aria-live="polite">
            {checkoutStep !== 'confirmation' && (
              <div className="checkout-topbar">
                <button type="button" onClick={checkoutStep === 'review' ? () => setCheckoutStep('details') : () => setCheckoutStep(null)}>← {checkoutStep === 'review' ? 'Back' : 'Cart'}</button>
                <div className="checkout-progress" aria-label="Checkout progress"><span className="active">Pickup</span><i></i><span className={checkoutStep === 'review' ? 'active' : ''}>Review</span></div>
              </div>
            )}

            {checkoutStep === 'details' && (
              <div className="checkout-content">
                <p className="eyebrow">Checkout</p><h1>When should we prepare your order?</h1>
                <p className="checkout-intro">Choose an immediate pickup or reserve a future pickup window.</p>
                <div className="pickup-options">
                  <label className={pickupMethod === 'asap' ? 'selected' : ''}>
                    <input type="radio" name="pickup-method" checked={pickupMethod === 'asap'} onChange={() => setPickupMethod('asap')} />
                    <span><strong>As soon as ready</strong><small>Estimated pickup in 8-10 minutes</small></span>
                  </label>
                  <label className={pickupMethod === 'scheduled' ? 'selected' : ''}>
                    <input type="radio" name="pickup-method" checked={pickupMethod === 'scheduled'} onChange={() => setPickupMethod('scheduled')} />
                    <span><strong>Schedule pickup</strong><small>Choose an available pickup window</small></span>
                  </label>
                </div>
                {pickupMethod === 'scheduled' && (
                  <label className="field-label">Pickup window
                    <select value={pickupSlot} onChange={(event) => setPickupSlot(event.target.value)}>{pickupSlots.map((slot) => <option value={slot} key={slot}>{slot}</option>)}</select>
                    <small>These are placeholder slots. Live capacity rules will be connected later.</small>
                  </label>
                )}
                <label className="field-label">Special instructions <span>(optional)</span>
                  <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength="120" placeholder="Example: Please pack the coffee separately" />
                  <small>{instructions.length}/120 characters</small>
                </label>
                <button className="primary-action" type="button" onClick={() => setCheckoutStep('review')}>Review order</button>
              </div>
            )}

            {checkoutStep === 'review' && (
              <div className="checkout-content">
                <p className="eyebrow">Final check</p><h1>Review your order</h1>
                <p className="checkout-intro">Confirm the items and pickup timing before creating this test order.</p>
                <div className="review-card">
                  {cartItems.map((item) => (
                    <div className="review-row" key={item.id}><span>{item.emoji}</span><div><strong>{item.name}</strong><small>Quantity {cart[item.id]}</small></div><strong>₹{item.price * cart[item.id]}</strong></div>
                  ))}
                  <div className="review-total"><span>Total</span><strong>₹{cartTotal}</strong></div>
                </div>
                <div className="pickup-summary"><span>Pickup</span><strong>{pickupMethod === 'scheduled' ? pickupSlot : 'As soon as ready'}</strong>{instructions.trim() && <small>Note: {instructions.trim()}</small>}</div>
                <div className="demo-notice">No payment will be charged. Payment verification will be connected in a later sprint.</div>
                {orderSubmitError && (
                  <div className="checkout-api-error" role="alert">
                    <strong>Order not saved</strong>
                    <span>{orderSubmitError} Your cart is still here—please try again.</span>
                  </div>
                )}
                <button
                  className="primary-action"
                  type="button"
                  onClick={confirmOrder}
                  disabled={isSubmittingOrder}
                >
                  {isSubmittingOrder
                    ? 'Saving your order…'
                    : `Confirm test order · ₹${cartTotal}`}
                </button>
              </div>
            )}

            {checkoutStep === 'confirmation' && confirmedOrder && (
              <div className="confirmation-content">
                <div className="success-mark">✓</div><p className="eyebrow">Order confirmed</p><h1>Your token is {confirmedOrder.token}</h1>
                <p>{confirmedOrder.pickupMethod === 'scheduled' ? `Pickup expected between ${confirmedOrder.pickupSlot}.` : 'We will show your order as ready after preparation.'}</p>
                <div className="token-card"><span>Show this token at pickup</span><strong>{confirmedOrder.token}</strong><small>{confirmedOrder.items.reduce((total, item) => total + item.quantity, 0)} items · ₹{confirmedOrder.total}</small></div>
                <div className="confirmation-actions">
                  <button className="primary-action" type="button" onClick={openOrderTracking}>Track My Order</button>
                  <button className="confirmation-secondary" type="button" onClick={finishOrder}>Back to menu</button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
      <footer className="app-footer">
  <p className="footer-tagline">Made with passion.</p>
  <p className="footer-tagline">Served with purpose.</p>

  <h3 className="footer-signature">
    👨‍🍳 Yash
  </h3>

  <small className="footer-version">
    CampusBite • Version 1.0
  </small>
</footer>
      </>}
    </div>
  )
}
export default App

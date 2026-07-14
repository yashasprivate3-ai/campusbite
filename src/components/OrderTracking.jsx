const ORDER_STEPS = [
  {
    status: 'new',
    icon: '✓',
    label: 'Order Received',
    description: 'Your order is in the kitchen queue.',
  },
  {
    status: 'preparing',
    icon: '🍳',
    label: 'Preparing',
    description: 'The kitchen is preparing your items.',
  },
  {
    status: 'ready',
    icon: '🎉',
    label: 'Ready for Pickup',
    description: 'Collect your order from the pickup counter.',
  },
]

const STATUS_INDEX = Object.fromEntries(
  ORDER_STEPS.map((step, index) => [step.status, index]),
)

function getEstimatedPreparationTime(order) {
  if (order.status === 'ready') return 'Ready now'

  const estimates = order.items
    .map((item) => {
      const match = item.time?.match(/(\d+)\s*(?:[-–]\s*(\d+))?\s*min/i)
      if (!match) return null

      const lower = Number(match[1])
      const upper = Number(match[2] || match[1])
      return { lower, upper }
    })
    .filter(Boolean)

  if (estimates.length === 0) return 'Calculating...'

  const slowest = estimates.reduce((current, estimate) =>
    estimate.upper > current.upper ? estimate : current,
  )

  return slowest.lower === slowest.upper
    ? `${slowest.upper} minutes`
    : `${slowest.lower}–${slowest.upper} minutes`
}

export function OrderTracking({ onBackToMenu, order }) {
  const currentStep = STATUS_INDEX[order.status] ?? 0
  const currentStatus = ORDER_STEPS[currentStep]
  const pickupMethod =
    order.pickupMethod === 'scheduled' ? 'Scheduled pickup' : 'As soon as ready'
  const pickupSlot =
    order.pickupMethod === 'scheduled'
      ? order.pickupSlot || 'Calculating...'
      : 'No reserved slot'

  return (
    <main className="tracking-main" aria-labelledby="tracking-title">
      <section className={`tracking-hero status-${order.status}`}>
        <div>
          <p className="eyebrow">Track My Order</p>
          <h1 id="tracking-title">{currentStatus.label}</h1>
          <p>{currentStatus.description}</p>
        </div>

        <div className="tracking-token" aria-label={`Order token ${order.token}`}>
          <span>Order token</span>
          <strong>{order.token}</strong>
        </div>
      </section>

      <section className="tracking-progress-card" aria-labelledby="progress-title">
        <div className="tracking-section-heading">
          <div>
            <p className="eyebrow">Live kitchen status</p>
            <h2 id="progress-title">Order progress</h2>
          </div>
          <span className={`tracking-status-pill status-${order.status}`}>
            {currentStatus.label}
          </span>
        </div>

        <ol className="tracking-timeline">
          {ORDER_STEPS.map((step, index) => {
            const stepState =
              index < currentStep
                ? 'complete'
                : index === currentStep
                  ? 'current'
                  : 'upcoming'

            return (
              <li className={stepState} key={step.status}>
                <span className="tracking-step-icon" aria-hidden="true">
                  {step.icon}
                </span>
                <div>
                  <strong>{step.label}</strong>
                  <small>{step.description}</small>
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      <div className="tracking-layout">
        <section className="tracking-details-card" aria-labelledby="details-title">
          <div className="tracking-section-heading">
            <div>
              <p className="eyebrow">Pickup details</p>
              <h2 id="details-title">Order details</h2>
            </div>
          </div>

          <dl className="tracking-facts">
            <div>
              <dt>Order Token</dt>
              <dd>{order.token}</dd>
            </div>
            <div>
              <dt>Current Status</dt>
              <dd>{currentStatus.label}</dd>
            </div>
            <div>
              <dt>Pickup Method</dt>
              <dd>{pickupMethod}</dd>
            </div>
            <div>
              <dt>Pickup Slot</dt>
              <dd>{pickupSlot}</dd>
            </div>
            <div>
              <dt>Estimated Preparation Time</dt>
              <dd>{getEstimatedPreparationTime(order)}</dd>
            </div>
          </dl>

          {order.instructions && (
            <div className="tracking-note">
              <strong>Special instructions</strong>
              <p>{order.instructions}</p>
            </div>
          )}
        </section>

        <section className="tracking-items-card" aria-labelledby="items-title">
          <div className="tracking-section-heading">
            <div>
              <p className="eyebrow">Confirmed order</p>
              <h2 id="items-title">Ordered items</h2>
            </div>
            <span>
              {order.items.reduce((total, item) => total + item.quantity, 0)} items
            </span>
          </div>

          <ul className="tracking-items-list">
            {order.items.map((item) => (
              <li key={item.id}>
                <span className="tracking-item-emoji" aria-hidden="true">
                  {item.emoji || '🍽️'}
                </span>
                <div>
                  <strong>{item.name}</strong>
                  <small>Quantity {item.quantity}</small>
                </div>
                <b>× {item.quantity}</b>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {order.status === 'ready' ? (
        <section className="tracking-pickup-alert" aria-live="polite">
          <span aria-hidden="true">🎉</span>
          <div>
            <strong>Your order is ready for pickup.</strong>
            <p>
              Show token <b>{order.token}</b> at the CampusBite pickup counter.
            </p>
          </div>
        </section>
      ) : (
        <p className="tracking-live-note" aria-live="polite">
          <span className="status-dot" aria-hidden="true" /> This page updates as
          the kitchen moves your order forward.
        </p>
      )}

      <button className="tracking-back-button" type="button" onClick={onBackToMenu}>
        ← Back to menu
      </button>
    </main>
  )
}

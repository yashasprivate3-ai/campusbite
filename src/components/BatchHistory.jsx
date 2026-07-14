import { formatElapsed } from '../utils/kitchenIntelligence'

function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function BatchHistory({ batches }) {
  const completedBatches = batches
    .filter((batch) => batch.status === 'completed' && batch.completedAt)
    .sort((left, right) => new Date(right.completedAt) - new Date(left.completedAt))

  return (
    <section className="intelligence-panel" aria-labelledby="batch-history-title">
      <div className="kitchen-section-heading">
        <h2 id="batch-history-title">Batch History</h2>
        <span>{completedBatches.length} completed</span>
      </div>

      {completedBatches.length === 0 ? (
        <p className="intelligence-empty">
          Completed production batches will appear here.
        </p>
      ) : (
        <div className="batch-history-list">
          {completedBatches.map((batch) => (
            <article className="batch-history-item" key={batch.id}>
              <div>
                <strong>{batch.itemName}</strong>
                <span>{batch.requiredQuantity} prepared</span>
              </div>
              <p>{batch.linkedOrders.length} linked orders</p>
              <small>
                Completed{' '}
                <time dateTime={batch.completedAt}>
                  {formatDateTime(batch.completedAt)}
                </time>
                {' · '}
                {formatElapsed(batch.startedAt, batch.completedAt)}
              </small>
              <details>
                <summary>View linked tokens</summary>
                <p>{batch.linkedOrders.join(', ')}</p>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

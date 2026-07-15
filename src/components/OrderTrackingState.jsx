export function OrderTrackingState({ error, isLoading, onBackToMenu, onRetry }) {
  return (
    <main className="tracking-main">
      <section className="tracking-state-card" role={error ? 'alert' : 'status'}>
        <p className="eyebrow">Track My Order</p>
        <h1>{isLoading ? 'Loading your order…' : 'Order unavailable'}</h1>
        <p>
          {isLoading
            ? 'Checking the shared CampusBite order record.'
            : error || 'The requested order could not be found.'}
        </p>
        {!isLoading && (
          <div className="tracking-state-actions">
            <button className="primary-action" type="button" onClick={onRetry}>
              Try again
            </button>
            <button
              className="confirmation-secondary"
              type="button"
              onClick={onBackToMenu}
            >
              Back to menu
            </button>
          </div>
        )}
      </section>
    </main>
  )
}

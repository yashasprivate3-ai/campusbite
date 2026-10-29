const dashboardMetrics = [
  ['Orders Today', 'total'],
  ['New', 'new'],
  ['Preparing', 'preparing'],
  ['Ready', 'ready'],
  ['Completed', 'completed'],
  ['Active Batches', 'activeBatches'],
]

export function LiveKitchenDashboard({ metrics }) {
  return (
    <section className="live-dashboard" aria-labelledby="live-dashboard-title">
      <div className="kitchen-section-heading">
        <h2 id="live-dashboard-title">Today's At a Glance</h2>
        <span>Live operational counts</span>
      </div>
      <div className="live-dashboard-grid">
        {dashboardMetrics.map(([label, key]) => (
          <div className={`live-metric ${key}`} key={key}>
            <span>{label}</span>
            <strong>{metrics[key]}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}

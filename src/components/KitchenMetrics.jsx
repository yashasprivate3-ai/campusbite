const dashboardMetrics = [
  ['Total Orders Today', 'total'],
  ['New', 'new'],
  ['Preparing', 'preparing'],
  ['Ready', 'ready'],
  ['Completed', 'completed'],
]

export function LiveKitchenDashboard({ metrics }) {
  return (
    <section className="live-dashboard" aria-labelledby="live-dashboard-title">
      <div className="kitchen-section-heading">
        <div>
          <p className="eyebrow">Today at a glance</p>
          <h2 id="live-dashboard-title">Live Kitchen Dashboard</h2>
        </div>
        <span>Updates with every kitchen action</span>
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

export function KitchenStatistics({ metrics }) {
  const statistics = [
    ['Orders Today', metrics.total, 'All student orders received today'],
    ['Active Batches', metrics.activeBatches, 'Currently being prepared'],
    ['Preparing Orders', metrics.preparing, 'Orders in production'],
    ['Ready Orders', metrics.ready, 'Waiting for pickup'],
    ['Completed Orders', metrics.completed, 'Batch preparation completed'],
  ]

  return (
    <section className="kitchen-statistics" aria-labelledby="statistics-title">
      <div className="kitchen-section-heading">
        <h2 id="statistics-title">Kitchen Statistics</h2>
        <span>Live operational summary</span>
      </div>
      <div className="statistics-grid">
        {statistics.map(([label, value, description]) => (
          <article className="statistic-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{description}</small>
          </article>
        ))}
      </div>
    </section>
  )
}

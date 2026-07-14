export function KitchenStatistics({ metrics }) {
  const statistics = [
    ['Orders Today', metrics.total, 'All student orders received today'],
    ['Active Batches', metrics.activeBatches, 'Currently being prepared'],
    ['Preparing Orders', metrics.preparing, 'Orders in production'],
    ['Ready Orders', metrics.ready, 'Waiting for pickup'],
    ['Completed Orders', metrics.completed, 'Batch preparation completed'],
  ]

  return (
    <div className="statistics-grid">
      {statistics.map(([label, value, description]) => (
        <article className="statistic-card" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{description}</small>
        </article>
      ))}
    </div>
  )
}

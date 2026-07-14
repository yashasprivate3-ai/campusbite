function formatActivityTime(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function KitchenActivityFeed({ activities }) {
  return (
    <section className="intelligence-panel" aria-labelledby="activity-feed-title">
      <div className="kitchen-section-heading">
        <h2 id="activity-feed-title">Kitchen Activity</h2>
        <span>Latest first</span>
      </div>

      {activities.length === 0 ? (
        <p className="intelligence-empty">Kitchen activity will appear here.</p>
      ) : (
        <ol className="activity-list">
          {activities.slice(0, 20).map((activity) => (
            <li className={`activity-item ${activity.type}`} key={activity.id}>
              <span className="activity-marker" aria-hidden="true" />
              <div>
                <strong>{activity.title}</strong>
                <p>{activity.detail}</p>
                <time dateTime={activity.at}>
                  {formatActivityTime(activity.at)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

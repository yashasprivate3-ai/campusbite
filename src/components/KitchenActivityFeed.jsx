function formatActivityTime(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function KitchenActivityFeed({ activities }) {
  return (
    <div className="activity-feed-content">
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
    </div>
  )
}

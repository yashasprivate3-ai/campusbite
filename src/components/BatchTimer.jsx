import { useEffect, useState } from 'react'
import { formatElapsed } from '../utils/kitchenIntelligence'

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function BatchTimer({ startedAt }) {
  const [now, setNow] = useState(() => new Date(startedAt).getTime())

  useEffect(() => {
    const updateClock = () => setNow(Date.now())
    const initialUpdate = window.setTimeout(updateClock, 0)
    const timer = window.setInterval(updateClock, 1000)

    return () => {
      window.clearTimeout(initialUpdate)
      window.clearInterval(timer)
    }
  }, [])

  return (
    <div className="batch-timer" aria-live="off">
      <span>
        Started at <time dateTime={startedAt}>{formatTime(startedAt)}</time>
      </span>
      <strong>Elapsed {formatElapsed(startedAt, now)}</strong>
    </div>
  )
}

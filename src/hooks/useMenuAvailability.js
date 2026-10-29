import { useEffect, useState } from 'react'
import { apiRequest } from '../services/apiClient.js'

export function useMenuAvailability(enabled, pickupMethod, pickupSlot) {
  const [snapshot, setSnapshot] = useState(null)
  const selection = JSON.stringify([pickupMethod, pickupSlot])
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let inFlight = false
    const controller = new AbortController()
    async function refresh() {
      if (inFlight) return
      inFlight = true
      try {
        const query = new URLSearchParams({ pickupMethod, ...(pickupMethod === 'scheduled' ? { pickupSlot: pickupSlot || '' } : {}) })
        const menu = await apiRequest('/api/menu?' + query, { signal: controller.signal })
        if (!cancelled) setSnapshot({ selection, menu })
      } catch (error) {
        if (!cancelled && error.name !== 'AbortError') setSnapshot({ selection, error: error.message })
      } finally { inFlight = false }
    }
    void refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer) }
  }, [enabled, pickupMethod, pickupSlot, selection])
  return snapshot?.selection === selection ? snapshot : null
}

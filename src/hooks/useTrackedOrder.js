import { useCallback, useEffect, useRef, useState } from 'react'
import { getOrder } from '../services/ordersApi.js'

const TRACKING_POLL_INTERVAL_MS = 3000

export function useTrackedOrder(orderId, enabled) {
  const [order, setOrder] = useState(null)
  const [isLoading, setIsLoading] = useState(Boolean(orderId))
  const [error, setError] = useState('')
  const activeRequest = useRef(null)
  const requestSequence = useRef(0)

  const refreshOrder = useCallback(async () => {
    if (!orderId || activeRequest.current) return null

    const controller = new AbortController()
    const requestId = requestSequence.current + 1
    requestSequence.current = requestId
    activeRequest.current = controller

    try {
      const nextOrder = await getOrder(orderId, { signal: controller.signal })
      if (requestSequence.current === requestId) {
        setOrder((current) =>
          JSON.stringify(current) === JSON.stringify(nextOrder)
            ? current
            : nextOrder,
        )
        setError('')
      }
      return nextOrder
    } catch (requestError) {
      if (
        requestError.name !== 'AbortError' &&
        requestSequence.current === requestId
      ) {
        setError(requestError.message)
        if (requestError.status === 404) setOrder(null)
      }
      return null
    } finally {
      if (requestSequence.current === requestId) {
        activeRequest.current = null
        setIsLoading(false)
      }
    }
  }, [orderId])

  useEffect(() => {
    let initialTimer

    if (!orderId) {
      initialTimer = window.setTimeout(() => {
        setOrder(null)
        setError('')
        setIsLoading(false)
      }, 0)
      return () => window.clearTimeout(initialTimer)
    }

    if (!enabled) {
      return () => {
        requestSequence.current += 1
        const controller = activeRequest.current
        activeRequest.current = null
        controller?.abort()
      }
    }

    initialTimer = window.setTimeout(() => {
      setIsLoading(true)
      refreshOrder()
    }, 0)

    const pollTimer = window.setInterval(
      refreshOrder,
      TRACKING_POLL_INTERVAL_MS,
    )

    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(pollTimer)
      requestSequence.current += 1
      const controller = activeRequest.current
      activeRequest.current = null
      controller?.abort()
    }
  }, [enabled, orderId, refreshOrder])

  return { error, isLoading, order, refreshOrder, setOrder }
}

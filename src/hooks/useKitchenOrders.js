import { useCallback, useEffect, useRef, useState } from 'react'
import { changeOrderStatus, getOrders } from '../services/ordersApi.js'

const POLL_INTERVAL_MS = 5000

function sortOrders(orders) {
  return [...orders].sort(
    (left, right) =>
      new Date(right.createdAt) - new Date(left.createdAt) || right.id - left.id,
  )
}

function replaceIfChanged(currentOrders, nextOrders) {
  const sortedOrders = sortOrders(nextOrders)
  return JSON.stringify(currentOrders) === JSON.stringify(sortedOrders)
    ? currentOrders
    : sortedOrders
}

export function useKitchenOrders() {
  const [orders, setOrders] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingOrderIds, setPendingOrderIds] = useState([])
  const activeRequest = useRef(null)
  const isMounted = useRef(true)
  const requestSequence = useRef(0)

  const refreshOrders = useCallback(async ({ silent = false } = {}) => {
    if (activeRequest.current) return null

    const controller = new AbortController()
    const requestId = requestSequence.current + 1
    requestSequence.current = requestId
    activeRequest.current = controller

    if (!silent) setIsLoading(true)

    try {
      const nextOrders = await getOrders({ signal: controller.signal })

      if (isMounted.current && requestSequence.current === requestId) {
        setOrders((current) => replaceIfChanged(current, nextOrders))
        setError('')
      }

      return nextOrders
    } catch (requestError) {
      if (
        requestError.name !== 'AbortError' &&
        isMounted.current &&
        requestSequence.current === requestId
      ) {
        setError(requestError.message)
      }

      return null
    } finally {
      if (requestSequence.current === requestId) {
        activeRequest.current = null
        if (isMounted.current) setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    isMounted.current = true
    const initialTimer = window.setTimeout(refreshOrders, 0)
    const pollTimer = window.setInterval(
      () => refreshOrders({ silent: true }),
      POLL_INTERVAL_MS,
    )

    return () => {
      isMounted.current = false
      window.clearTimeout(initialTimer)
      window.clearInterval(pollTimer)
      requestSequence.current += 1
      const controller = activeRequest.current
      activeRequest.current = null
      controller?.abort()
    }
  }, [refreshOrders])

  const updateOrderStatus = useCallback(
    async (orderId, status, options = {}) => {
      setPendingOrderIds((current) =>
        current.includes(orderId) ? current : [...current, orderId],
      )

      try {
        const updatedOrder = await changeOrderStatus(orderId, status, options)

        if (isMounted.current) {
          setOrders((current) =>
            replaceIfChanged(
              current,
              current.map((order) =>
                order.id === updatedOrder.id ? updatedOrder : order,
              ),
            ),
          )
          setError('')
        }

        return updatedOrder
      } catch (requestError) {
        if (requestError.name !== 'AbortError' && isMounted.current) {
          setError(requestError.message)
        }
        throw requestError
      } finally {
        if (isMounted.current) {
          setPendingOrderIds((current) =>
            current.filter((id) => id !== orderId),
          )
        }
      }
    },
    [],
  )

  const addOrder = useCallback((order) => {
    setOrders((current) =>
      replaceIfChanged(
        current,
        current.some((candidate) => candidate.id === order.id)
          ? current.map((candidate) =>
              candidate.id === order.id ? order : candidate,
            )
          : [order, ...current],
      ),
    )
  }, [])

  return {
    addOrder,
    error,
    isLoading,
    orders,
    pendingOrderIds,
    refreshOrders,
    updateOrderStatus,
  }
}

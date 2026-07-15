export class OrdersApiError extends Error {
  constructor(message, { code, details, status } = {}) {
    super(message)
    this.name = 'OrdersApiError'
    this.code = code
    this.details = details
    this.status = status
  }
}

async function apiRequest(path, options = {}) {
  let response

  try {
    response = await fetch(path, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error

    throw new OrdersApiError(
      'CampusBite could not reach the kitchen service. Check that the backend is running and try again.',
      { code: 'network_error' },
    )
  }

  let payload

  try {
    payload = await response.json()
  } catch {
    throw new OrdersApiError('The kitchen service returned an unreadable response.', {
      code: 'invalid_response',
      status: response.status,
    })
  }

  if (!response.ok) {
    throw new OrdersApiError(payload.message || 'The request could not be completed.', {
      code: payload.error,
      details: payload.details,
      status: response.status,
    })
  }

  return payload
}

export async function createOrder(payload, options = {}) {
  const response = await apiRequest('/api/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal: options.signal,
  })
  return response.order
}

export async function getOrders({ signal, statuses = [] } = {}) {
  const query = statuses.length
    ? `?${new URLSearchParams({ status: statuses.join(',') })}`
    : ''
  const response = await apiRequest(`/api/orders${query}`, { signal })
  return response.orders
}

export async function getOrder(orderId, options = {}) {
  const response = await apiRequest(`/api/orders/${orderId}`, {
    signal: options.signal,
  })
  return response.order
}

export async function changeOrderStatus(
  orderId,
  status,
  { batchItem, signal } = {},
) {
  const response = await apiRequest(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...(batchItem ? { batchItem } : {}) }),
    signal,
  })
  return response.order
}

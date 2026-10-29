import { apiRequest, ApiClientError } from './apiClient.js'

export { ApiClientError as OrdersApiError }

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

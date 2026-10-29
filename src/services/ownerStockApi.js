import { apiRequest } from './apiClient.js'

export function fetchOwnerStock() {
  return apiRequest('/api/owner/stock')
}

export function saveOwnerStock(items) {
  return apiRequest('/api/owner/stock', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  })
}

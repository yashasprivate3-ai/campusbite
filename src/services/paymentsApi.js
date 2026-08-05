import { apiRequest } from './apiClient.js'

export async function initiatePaytmPayment(payload, options = {}) {
  const response = await apiRequest('/api/payments/paytm/initiate', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal: options.signal,
  })
  return response.attempt
}

export async function confirmPaytmPayment(attemptId, options = {}) {
  const response = await apiRequest('/api/payments/paytm/confirm', {
    method: 'POST',
    body: JSON.stringify({ attemptId }),
    signal: options.signal,
  })
  return response.attempt
}

export async function getPaymentStatus(attemptId, options = {}) {
  const response = await apiRequest(
    `/api/payments/${encodeURIComponent(attemptId)}/status`,
    { signal: options.signal },
  )
  return response.attempt
}

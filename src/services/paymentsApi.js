import { apiRequest } from './apiClient.js'

export async function initiatePayment(payload, options = {}) {
  const response = await apiRequest('/api/payments/initiate', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal: options.signal,
  })
  return response.attempt
}

export async function verifyPayment(payload, options = {}) {
  const response = await apiRequest('/api/payments/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
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

import { apiRequest } from './apiClient.js'

export async function getCurrentUser(options = {}) {
  const response = await apiRequest('/api/auth/me', {
    notifyUnauthorized: false,
    signal: options.signal,
  })
  return response.user
}

export async function loginWithPassword(identifier, password) {
  const response = await apiRequest('/api/auth/login', {
    method: 'POST',
    notifyUnauthorized: false,
    body: JSON.stringify({ identifier, password }),
  })
  return response.user
}

export async function logoutSession() {
  return apiRequest('/api/auth/logout', {
    method: 'POST',
    notifyUnauthorized: false,
  })
}

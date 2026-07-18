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

export async function loginWithGoogleCredential(credential) {
  const response = await apiRequest('/api/auth/google', {
    method: 'POST',
    notifyUnauthorized: false,
    body: JSON.stringify({ credential }),
  })
  return response.user
}

export async function saveStudentPhone(phoneNumber) {
  const response = await apiRequest('/api/auth/profile/phone', {
    method: 'PATCH',
    body: JSON.stringify({ phoneNumber }),
  })
  return response.user
}

export async function logoutSession() {
  return apiRequest('/api/auth/logout', {
    method: 'POST',
    notifyUnauthorized: false,
  })
}

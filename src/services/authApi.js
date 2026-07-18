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

export async function requestPhoneVerification() {
  return apiRequest('/api/auth/phone-verification/request', {
    method: 'POST',
  })
}

export async function verifyPhoneVerification(code) {
  return apiRequest('/api/auth/phone-verification/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export async function logoutSession() {
  return apiRequest('/api/auth/logout', {
    method: 'POST',
    notifyUnauthorized: false,
  })
}

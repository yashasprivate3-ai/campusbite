export const AUTH_UNAUTHORIZED_EVENT = 'campusbite:auth-unauthorized'

export class ApiClientError extends Error {
  constructor(message, { code, details, status } = {}) {
    super(message)
    this.name = 'ApiClientError'
    this.code = code
    this.details = details
    this.status = status
  }
}

export async function apiRequest(
  path,
  { notifyUnauthorized = true, ...options } = {},
) {
  let response

  try {
    response = await fetch(path, {
      ...options,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error

    throw new ApiClientError(
      'CampusBite could not reach the service. Check that the backend is running and try again.',
      { code: 'network_error' },
    )
  }

  let payload

  try {
    payload = await response.json()
  } catch {
    throw new ApiClientError('The service returned an unreadable response.', {
      code: 'invalid_response',
      status: response.status,
    })
  }

  if (!response.ok) {
    const requestError = new ApiClientError(
      payload.message || 'The request could not be completed.',
      {
        code: payload.error,
        details: payload.details,
        status: response.status,
      },
    )

    if (
      response.status === 401 &&
      notifyUnauthorized &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(
        new CustomEvent(AUTH_UNAUTHORIZED_EVENT, {
          detail: { code: requestError.code },
        }),
      )
    }

    throw requestError
  }

  return payload
}

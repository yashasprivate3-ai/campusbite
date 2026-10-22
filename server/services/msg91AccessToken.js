import { ApiError } from './apiError.js'

const ENDPOINT = 'https://control.msg91.com/api/v5/widget/verifyAccessToken'

function normalizeAccessToken(accessToken) {
  if (
    typeof accessToken !== 'string' ||
    !accessToken.trim() ||
    accessToken.length > 8192
  ) {
    throw new ApiError(400, 'msg91_access_token_invalid', 'MSG91 verification could not be completed.')
  }
  return accessToken.trim()
}

function normalizeVerifiedMobile(value) {
  if (typeof value !== 'string' || !/^\d{8,15}$/.test(value)) {
    throw new ApiError(502, 'msg91_response_invalid', 'MSG91 verification could not be completed.')
  }
  return `+${value}`
}

export function createMsg91AccessTokenVerifier(
  { authkey, requestTimeoutMilliseconds = 8000 },
  fetchImplementation = fetch,
) {
  const serverAuthkey = String(authkey || '').trim()
  if (!serverAuthkey) {
    throw new Error('CAMPUSBITE_MSG91_AUTHKEY is required for MSG91 verification.')
  }

  return async function verifyAccessToken(value) {
    const accessToken = normalizeAccessToken(value)
    let response
    let data

    try {
      response = await fetchImplementation(ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          authkey: serverAuthkey,
          'access-token': accessToken,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      })
      if (!response.ok) throw new Error('Provider rejected request')
      data = await response.json()
    } catch {
      // Provider bodies, tokens and credentials must never cross this boundary.
      throw new ApiError(502, 'msg91_verification_failed', 'MSG91 verification could not be completed.')
    }

    if (data?.type === 'error' && data.code === 702) {
      throw new ApiError(409, 'msg91_access_token_reused', 'This MSG91 verification has already been used.')
    }

    if (!data || typeof data !== 'object' || Array.isArray(data) || data.type !== 'success') {
      throw new ApiError(502, 'msg91_response_invalid', 'MSG91 verification could not be completed.')
    }

    return Object.freeze({ phoneNumber: normalizeVerifiedMobile(data.message) })
  }
}

export async function checkMsg91AccessToken(accessToken, authkey, fetchImplementation = fetch) {
  return createMsg91AccessTokenVerifier(
    { authkey, requestTimeoutMilliseconds: 8000 },
    fetchImplementation,
  )(accessToken)
}

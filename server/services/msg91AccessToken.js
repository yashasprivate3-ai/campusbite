const ENDPOINT = 'https://control.msg91.com/api/v5/widget/verifyAccessToken'
const DIAGNOSTIC_FIELDS = new Set(['type', 'code', 'message', 'data', 'identifier', 'mobile', 'phone', 'phoneNumber'])

// Diagnostic only: no response shape has yet been established as authoritative.
// This function must never be used as an authorization decision.
export async function checkMsg91AccessToken(accessToken, authkey, fetchImplementation = fetch) {
  if (typeof accessToken !== 'string' || !accessToken.trim() || accessToken.length > 8192) {
    throw new Error('MSG91 access token missing or invalid')
  }
  if (typeof authkey !== 'string' || !authkey.trim()) {
    throw new Error('MSG91 server Authkey is not configured')
  }

  let response
  let data
  try {
    response = await fetchImplementation(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ authkey, 'access-token': accessToken }),
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error('Provider rejected request')
    data = await response.json()
  } catch {
    // Never propagate provider messages, request bodies, tokens or credentials.
    throw new Error('MSG91 server verification failed')
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('MSG91 response has unexpected shape')
  }
  if (data.type === 'error' || Object.hasOwn(data, 'error')) {
    throw new Error('MSG91 server verification failed')
  }

  return {
    // Allowlist keys too: an arbitrary provider key may itself contain private data.
    responseFields: Object.keys(data).filter(field => DIAGNOSTIC_FIELDS.has(field)).sort().map(field => ({
      field,
      type: Array.isArray(data[field]) ? 'array' : data[field] === null ? 'null' : typeof data[field],
    })),
    phoneVerified: false,
    authorizationGranted: false,
  }
}

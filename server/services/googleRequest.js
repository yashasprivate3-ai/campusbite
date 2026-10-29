import { ApiError } from './apiError.js'

// The GIS JavaScript callback uses a same-origin JSON fetch. Reject browser
// form/text submissions and cross-site fetches before parsing any credential.
export function requireGoogleJsonRequest(request) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new ApiError(415, 'google_json_required', 'Google sign-in requires a JSON request.')
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    throw new ApiError(403, 'google_request_forbidden', 'Google sign-in request was rejected.')
  }
}

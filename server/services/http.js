export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

export async function readJsonBody(request, maxBytes = 64 * 1024) {
  const chunks = []
  let size = 0

  for await (const chunk of request) {
    size += chunk.length

    if (size > maxBytes) {
      const error = new Error('Request body is too large.')
      error.statusCode = 413
      error.code = 'payload_too_large'
      throw error
    }

    chunks.push(chunk)
  }

  if (chunks.length === 0) return {}

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('Request body must contain valid JSON.')
    error.statusCode = 400
    error.code = 'invalid_json'
    throw error
  }
}

export function sendApiError(response, error) {
  const payload = {
    error: error.code || 'internal_server_error',
    message: error.message || 'An unexpected server error occurred',
  }

  if (error.details !== undefined) payload.details = error.details
  sendJson(response, error.statusCode || 500, payload)
}

export function sendMethodNotAllowed(response, allowedMethods) {
  response.setHeader('Allow', allowedMethods.join(', '))
  sendJson(response, 405, {
    error: 'method_not_allowed',
    message: `Use ${allowedMethods.join(' or ')} for this API route.`,
  })
}

export function sendNotFound(response) {
  sendJson(response, 404, {
    error: 'not_found',
    message: 'API route not found',
  })
}

export function sendInternalServerError(response) {
  sendJson(response, 500, {
    error: 'internal_server_error',
    message: 'An unexpected server error occurred',
  })
}

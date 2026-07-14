export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
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

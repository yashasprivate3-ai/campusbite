import { getOwnerStock, confirmOwnerStock } from '../services/ownerStock.js'
import { readJsonBody, sendJson, sendMethodNotAllowed } from '../services/http.js'
import { optionalAuth, requireRole, ROLES } from '../services/authorization.js'
import { invalidRequest } from '../services/apiError.js'

export async function handleOwnerStockRoutes(
  request,
  response,
  requestUrl,
  database,
  authConfig,
) {
  if (requestUrl.pathname !== '/api/owner/stock') {
    return false
  }

  if (request.method !== 'GET' && request.method !== 'PUT') {
    sendMethodNotAllowed(response, ['GET', 'PUT'])
    return true
  }

  const authContext = requireRole(
    database,
    optionalAuth(database, request, authConfig),
    ROLES.OWNER,
    request,
  )

  if (request.method === 'GET') {
    sendJson(response, 200, getOwnerStock(database))
    return true
  }

  const body = await readJsonBody(request)

  if (!body || !Array.isArray(body.items)) {
    throw invalidRequest('Provide an items array.')
  }

  const result = confirmOwnerStock(
    database,
    body.items,
    new Date(),
    authContext.internalUserId,
  )
  sendJson(response, 200, result)
  return true
}

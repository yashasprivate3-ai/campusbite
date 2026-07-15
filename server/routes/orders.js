import {
  createOrder,
  getOrder,
  listOrders,
  ORDER_STATUSES,
  updateOrderStatus,
} from '../services/orders.js'
import {
  readJsonBody,
  sendJson,
  sendMethodNotAllowed,
} from '../services/http.js'
import { invalidRequest } from '../services/apiError.js'
import {
  optionalAuth,
  requireAnyRole,
  requireAuth,
  requireRole,
  ROLES,
} from '../services/authorization.js'

function parseOrderId(value) {
  const orderId = Number(value)

  if (!Number.isSafeInteger(orderId) || orderId < 1) {
    throw invalidRequest('Order ID must be a positive integer.')
  }

  return orderId
}

function parseStatuses(requestUrl) {
  const requestedStatuses = requestUrl.searchParams
    .getAll('status')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  const uniqueStatuses = [...new Set(requestedStatuses)]
  const invalidStatuses = uniqueStatuses.filter(
    (status) => !ORDER_STATUSES.includes(status),
  )

  if (invalidStatuses.length > 0) {
    throw invalidRequest(
      `Unknown order status: ${invalidStatuses.join(', ')}.`,
      { allowedStatuses: ORDER_STATUSES },
    )
  }

  return uniqueStatuses
}

export async function handleOrderRoutes(
  request,
  response,
  requestUrl,
  database,
  authConfig,
) {
  if (requestUrl.pathname === '/api/orders') {
    if (request.method === 'POST') {
      const authContext = requireRole(
        database,
        optionalAuth(database, request, authConfig),
        ROLES.STUDENT,
        request,
      )
      const result = createOrder(
        database,
        await readJsonBody(request),
        authContext.internalUserId,
      )
      sendJson(response, result.created ? 201 : 200, {
        created: result.created,
        order: result.order,
      })
      return true
    }

    if (request.method === 'GET') {
      requireAnyRole(
        database,
        optionalAuth(database, request, authConfig),
        [ROLES.OWNER, ROLES.KITCHEN],
        request,
      )
      const statuses = parseStatuses(requestUrl)
      sendJson(response, 200, { orders: listOrders(database, statuses) })
      return true
    }

    sendMethodNotAllowed(response, ['GET', 'POST'])
    return true
  }

  const statusMatch = requestUrl.pathname.match(
    /^\/api\/orders\/([^/]+)\/status$/,
  )

  if (statusMatch) {
    if (request.method !== 'PATCH') {
      sendMethodNotAllowed(response, ['PATCH'])
      return true
    }

    requireAnyRole(
      database,
      optionalAuth(database, request, authConfig),
      [ROLES.OWNER, ROLES.KITCHEN],
      request,
    )
    const order = updateOrderStatus(
      database,
      parseOrderId(statusMatch[1]),
      await readJsonBody(request),
    )
    sendJson(response, 200, { order })
    return true
  }

  const orderMatch = requestUrl.pathname.match(/^\/api\/orders\/([^/]+)$/)

  if (orderMatch) {
    if (request.method !== 'GET') {
      sendMethodNotAllowed(response, ['GET'])
      return true
    }

    const authContext = requireAuth(
      optionalAuth(database, request, authConfig),
    )
    const orderId = parseOrderId(orderMatch[1])

    if (authContext.user.role === ROLES.STUDENT) {
      sendJson(response, 200, {
        order: getOrder(database, orderId, authContext.internalUserId),
      })
      return true
    }

    requireAnyRole(
      database,
      authContext,
      [ROLES.OWNER, ROLES.KITCHEN],
      request,
    )
    sendJson(response, 200, { order: getOrder(database, orderId) })
    return true
  }

  return false
}

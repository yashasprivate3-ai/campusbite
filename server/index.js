import { menuAvailability } from './services/menuAvailability.js'
import { optionalAuth, requireAuth } from './services/authorization.js'
import { sendJson, sendMethodNotAllowed } from './services/http.js'
import { createServer } from 'node:http'
import { serverConfig } from './config.js'
import { initializeDatabase } from './db.js'
import { handleHealthCheck } from './routes/health.js'
import { handleAuthRoutes } from './routes/auth.js'
import { handleOrderRoutes } from './routes/orders.js'
import { handlePaymentRoutes } from './routes/payments.js'
import { handleOwnerStockRoutes } from './routes/ownerStock.js'
import { seedDevelopmentAccounts } from './services/devAccounts.js'
import {
  sendApiError,
  sendInternalServerError,
  sendNotFound,
} from './services/http.js'
import { LoginThrottle } from './services/loginThrottle.js'
import { createPhoneVerificationProvider } from './services/phoneVerificationProvider.js'
import { createCashfreeProvider } from './services/cashfreeProvider.js'
import { createRazorpayProvider } from './services/razorpayProvider.js'

const paymentProvider = createCashfreeProvider(serverConfig.payments) || createRazorpayProvider(serverConfig.payments)

let database

try {
  database = initializeDatabase(serverConfig.databasePath)
} catch (error) {
  console.error('[campusbite-api] Database initialization failed.')
  console.error(error)
  process.exit(1)
}

try {
  const seedResult = seedDevelopmentAccounts(database, serverConfig.auth)
  if (seedResult.enabled) {
    console.log(
      `[campusbite-api] Development accounts ready: ${seedResult.created} created, ${seedResult.updated} updated, ${seedResult.unchanged} unchanged.`,
    )
  }
} catch (error) {
  console.error('[campusbite-api] Development account setup failed.')
  console.error(error.message)
  database.close()
  process.exit(1)
}

const loginThrottle = new LoginThrottle({
  maxAttempts: serverConfig.auth.loginMaxAttempts,
  windowMinutes: serverConfig.auth.loginWindowMinutes,
})
const phoneVerificationProvider = createPhoneVerificationProvider(
  serverConfig.auth.otp,
  serverConfig.isProduction,
)


const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(
      request.url || '/',
      `http://${request.headers.host || `${serverConfig.host}:${serverConfig.port}`}`,
    )

    if (requestUrl.pathname === '/api/menu') {
      requireAuth(optionalAuth(database, request, serverConfig.auth))
      if (request.method !== 'GET') { sendMethodNotAllowed(response, ['GET']); return }
      sendJson(response, 200, menuAvailability(database, requestUrl.searchParams.get('pickupMethod') || 'asap', requestUrl.searchParams.get('pickupSlot')))
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
      handleHealthCheck(response)
      return
    }

    if (
      await handleAuthRoutes(
        request,
        response,
        requestUrl,
        database,
        serverConfig.auth,
        loginThrottle,
        phoneVerificationProvider,
      )
    ) {
      return
    }

    if (
      await handleOwnerStockRoutes(
        request,
        response,
        requestUrl,
        database,
        serverConfig.auth,
      )
    ) {
      return
    }

    if (
      await handlePaymentRoutes(
        request,
        response,
        requestUrl,
        database,
        serverConfig.auth,
        serverConfig.payments,
        paymentProvider,
      )
    ) {
      return
    }

    if (
      await handleOrderRoutes(
        request,
        response,
        requestUrl,
        database,
        serverConfig.auth,
      )
    ) {
      return
    }

    sendNotFound(response)
  } catch (error) {
    if (error.statusCode) {
      sendApiError(response, error)
      return
    }

    console.error('[campusbite-api] Unexpected request error.', error)

    if (!response.headersSent) {
      sendInternalServerError(response)
    } else {
      response.destroy()
    }
  }
})

server.on('error', (error) => {
  console.error('[campusbite-api] Server failed.', error)
  database.close()
  process.exit(1)
})

server.listen(serverConfig.port, serverConfig.host, () => {
  console.log(
    `[campusbite-api] Listening at http://${serverConfig.host}:${serverConfig.port}`,
  )
  console.log(`[campusbite-api] Database: ${serverConfig.databasePath}`)
})

function shutdown(signal) {
  console.log(`[campusbite-api] ${signal} received. Shutting down.`)

  server.close(() => {
    database.close()
    process.exit(0)
  })

  setTimeout(() => {
    console.error('[campusbite-api] Forced shutdown after timeout.')
    process.exit(1)
  }, 5000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

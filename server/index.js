import { createServer } from 'node:http'
import { serverConfig } from './config.js'
import { initializeDatabase } from './db.js'
import { handleHealthCheck } from './routes/health.js'
import {
  sendInternalServerError,
  sendNotFound,
} from './services/http.js'

let database

try {
  database = initializeDatabase(serverConfig.databasePath)
} catch (error) {
  console.error('[campusbite-api] Database initialization failed.')
  console.error(error)
  process.exit(1)
}

const server = createServer((request, response) => {
  try {
    const requestUrl = new URL(
      request.url || '/',
      `http://${request.headers.host || `${serverConfig.host}:${serverConfig.port}`}`,
    )

    if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
      handleHealthCheck(response)
      return
    }

    sendNotFound(response)
  } catch (error) {
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

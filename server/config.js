import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(serverDirectory, '..')
const environmentPath = path.join(projectRoot, '.env')

try {
  process.loadEnvFile(environmentPath)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

function readPort(value) {
  const port = Number(value || 3001)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid CAMPUSBITE_API_PORT: ${value}`)
  }

  return port
}

function readInteger(value, fallback, label, { min, max }) {
  const result = Number(value || fallback)

  if (!Number.isInteger(result) || result < min || result > max) {
    throw new Error(`Invalid ${label}: ${value}`)
  }

  return result
}

function readBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`Expected true or false, received: ${value}`)
}

function readCookieName(value) {
  const cookieName = value || 'campusbite_session'

  if (!/^[A-Za-z0-9_-]+$/.test(cookieName)) {
    throw new Error('CAMPUSBITE_AUTH_COOKIE_NAME contains invalid characters.')
  }

  return cookieName
}

const nodeEnvironment = process.env.NODE_ENV || 'development'
const isProduction = nodeEnvironment === 'production'
const developmentAccountsEnabled =
  !isProduction && readBoolean(process.env.CAMPUSBITE_DEV_ACCOUNTS_ENABLED)
const googleLoginEnabled = readBoolean(
  process.env.CAMPUSBITE_GOOGLE_LOGIN_ENABLED,
)
const googleClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim()
const googleFrontendClientId = String(
  process.env.VITE_GOOGLE_CLIENT_ID || '',
).trim()

export const serverConfig = Object.freeze({
  host: process.env.CAMPUSBITE_API_HOST || '127.0.0.1',
  port: readPort(process.env.CAMPUSBITE_API_PORT),
  databasePath: path.resolve(
    projectRoot,
    process.env.CAMPUSBITE_DB_PATH || 'data/campusbite.db',
  ),
  nodeEnvironment,
  isProduction,
  auth: Object.freeze({
    cookieName: readCookieName(process.env.CAMPUSBITE_AUTH_COOKIE_NAME),
    cookieSecure:
      isProduction || readBoolean(process.env.CAMPUSBITE_AUTH_COOKIE_SECURE),
    sessionTtlHours: readInteger(
      process.env.CAMPUSBITE_AUTH_SESSION_TTL_HOURS,
      12,
      'CAMPUSBITE_AUTH_SESSION_TTL_HOURS',
      { min: 1, max: 720 },
    ),
    sessionTouchMinutes: readInteger(
      process.env.CAMPUSBITE_AUTH_SESSION_TOUCH_MINUTES,
      15,
      'CAMPUSBITE_AUTH_SESSION_TOUCH_MINUTES',
      { min: 1, max: 120 },
    ),
    loginMaxAttempts: readInteger(
      process.env.CAMPUSBITE_AUTH_LOGIN_MAX_ATTEMPTS,
      5,
      'CAMPUSBITE_AUTH_LOGIN_MAX_ATTEMPTS',
      { min: 3, max: 20 },
    ),
    loginWindowMinutes: readInteger(
      process.env.CAMPUSBITE_AUTH_LOGIN_WINDOW_MINUTES,
      10,
      'CAMPUSBITE_AUTH_LOGIN_WINDOW_MINUTES',
      { min: 1, max: 60 },
    ),
    developmentAccountsEnabled,
    google: Object.freeze({
      clientId: googleClientId,
      configured:
        googleLoginEnabled &&
        Boolean(googleClientId) &&
        Boolean(googleFrontendClientId) &&
        googleClientId === googleFrontendClientId,
      enabled: googleLoginEnabled,
      frontendClientId: googleFrontendClientId,
    }),
    resetDevelopmentPasswords:
      developmentAccountsEnabled &&
      readBoolean(process.env.CAMPUSBITE_DEV_RESET_PASSWORDS),
    developmentAccounts: Object.freeze([
      Object.freeze({
        role: 'OWNER',
        displayName: process.env.CAMPUSBITE_DEV_OWNER_NAME || 'CampusBite Owner',
        identifier: process.env.CAMPUSBITE_DEV_OWNER_LOGIN || '',
        password: process.env.CAMPUSBITE_DEV_OWNER_PASSWORD || '',
      }),
      Object.freeze({
        role: 'KITCHEN',
        displayName:
          process.env.CAMPUSBITE_DEV_KITCHEN_NAME || 'CampusBite Kitchen',
        identifier: process.env.CAMPUSBITE_DEV_KITCHEN_LOGIN || '',
        password: process.env.CAMPUSBITE_DEV_KITCHEN_PASSWORD || '',
      }),
      Object.freeze({
        role: 'STUDENT',
        displayName:
          process.env.CAMPUSBITE_DEV_STUDENT_NAME || 'Development Student',
        identifier: process.env.CAMPUSBITE_DEV_STUDENT_LOGIN || '',
        password: process.env.CAMPUSBITE_DEV_STUDENT_PASSWORD || '',
      }),
    ]),
  }),
  projectRoot,
})

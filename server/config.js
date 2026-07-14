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

export const serverConfig = Object.freeze({
  host: process.env.CAMPUSBITE_API_HOST || '127.0.0.1',
  port: readPort(process.env.CAMPUSBITE_API_PORT),
  databasePath: path.resolve(
    projectRoot,
    process.env.CAMPUSBITE_DB_PATH || 'data/campusbite.db',
  ),
  projectRoot,
})

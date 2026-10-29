import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(serverDirectory, '..')
const commands = [
  {
    name: 'server',
    arguments: [path.join(serverDirectory, 'index.js')],
  },
  {
    name: 'dev',
    arguments: [
      path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--configLoader',
      'native',
    ],
  },
]

const children = commands.map((command) => ({
  name: command.name,
  process: spawn(process.execPath, command.arguments, {
    cwd: projectRoot,
    stdio: 'inherit',
  }),
}))

let shuttingDown = false

function stopChildren(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true

  children.forEach((child) => {
    if (!child.process.killed) child.process.kill()
  })

  process.exitCode = exitCode
}

children.forEach((child) => {
  child.process.on('error', (error) => {
    console.error(`[dev:all] Failed to start ${child.name}.`, error)
    stopChildren(1)
  })

  child.process.on('exit', (code, signal) => {
    if (shuttingDown) return

    const reason = signal ? `signal ${signal}` : `code ${code}`
    console.error(`[dev:all] ${child.name} stopped with ${reason}.`)
    stopChildren(code || 1)
  })
})

process.on('SIGINT', () => stopChildren())
process.on('SIGTERM', () => stopChildren())

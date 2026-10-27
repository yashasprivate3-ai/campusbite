#!/usr/bin/env node
// Create (or reset the password of) an OWNER or KITCHEN login on the database the
// running app uses. Run inside the Railway container over SSH:
//   node server/scripts/staff-account.js --role OWNER --login owner@example.com --name "Owner"
//   node server/scripts/staff-account.js --role KITCHEN --login kitchen1 --reset-password
// The password is typed twice without echo (or read from stdin when piped), is
// never printed or logged, and is stored only as a scrypt hash.
// The tool never migrates: it refuses unless the database is already at the
// app's current schema version (start the app once first).
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { SCHEMA_VERSION } from '../db.js'
import { createOrResetStaffAccount } from '../services/staffAccounts.js'

function parseArgs(argv) {
  const out = { resetPassword: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--reset-password') out.resetPassword = true
    else if (['--role', '--login', '--name'].includes(arg)) out[arg.slice(2)] = argv[++i]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return out
}

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    process.stderr.write(prompt)
    input.setRawMode(true)
    input.resume()
    input.setEncoding('utf8')
    let value = ''
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { cleanup(); process.stderr.write('\n'); resolve(value); return }
        if (ch === '\u0003') { cleanup(); process.stderr.write('\n'); reject(new Error('Cancelled.')); return }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    const cleanup = () => { input.removeListener('data', onData); input.setRawMode(false); input.pause() }
    input.on('data', onData)
  })
}

async function readPiped() {
  let data = ''
  for await (const chunk of process.stdin) data += chunk
  const lines = data.split(/\r?\n/)
  return [lines[0] ?? '', lines[1] ?? lines[0] ?? '']
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.role || !args.login) throw new Error('Usage: --role OWNER|KITCHEN --login <login> [--name <display name>] [--reset-password]')
  const dbPath = process.env.CAMPUSBITE_DB_PATH
  if (!dbPath) throw new Error('CAMPUSBITE_DB_PATH is not set; refusing to guess the database file.')
  if (!existsSync(dbPath)) throw new Error('Database file not found at CAMPUSBITE_DB_PATH; start the app once first.')

  const [password, confirm] = process.stdin.isTTY
    ? [await readHidden('New password (12-128 characters): '), await readHidden('Repeat password: ')]
    : await readPiped()
  if (password !== confirm) throw new Error('Passwords do not match.')

  const database = new DatabaseSync(dbPath)
  try {
    database.exec('PRAGMA busy_timeout = 5000;')
    database.exec('PRAGMA foreign_keys = ON;')
    const version = database.prepare('PRAGMA user_version').get().user_version
    if (version !== SCHEMA_VERSION) throw new Error(`Database schema is ${version}, expected ${SCHEMA_VERSION}; refusing to write.`)
    const result = createOrResetStaffAccount(database, {
      role: args.role, login: args.login, displayName: args.name, password, resetPassword: args.resetPassword,
    })
    process.stdout.write(`${result.outcome}: ${result.role} login "${result.login}"\n`)
  } finally {
    database.close()
  }
}

main().catch((error) => {
  process.stderr.write(`staff-account: ${error.message}\n`)
  process.exitCode = 1
})

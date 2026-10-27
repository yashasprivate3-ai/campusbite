import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { initializeDatabase } from '../db.js'
import { authenticateLocalUser } from '../services/auth.js'
import { createOrResetStaffAccount } from '../services/staffAccounts.js'

const PASSWORD = 'correct-horse-battery-9'
const productionAuth = { developmentAccountsEnabled: false }
const login = (db, identifier, password) => authenticateLocalUser(db, { identifier, password }, productionAuth)
const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/staff-account.js')

test('creates an owner who can sign in with dev accounts disabled (production mode)', () => {
  const db = initializeDatabase(':memory:')
  const result = createOrResetStaffAccount(db, { role: 'owner', login: ' Owner@Example.com ', displayName: 'Canteen Owner', password: PASSWORD })
  assert.deepEqual(result, { outcome: 'created', role: 'OWNER', login: 'owner@example.com' })
  assert.ok(login(db, 'owner@example.com', PASSWORD))
  const row = db.prepare("SELECT password_hash FROM auth_identities WHERE login_identifier = 'owner@example.com'").get()
  assert.ok(row.password_hash.startsWith('scrypt$') && !row.password_hash.includes(PASSWORD))
  assert.equal(db.prepare("SELECT COUNT(*) c FROM auth_events WHERE event_type = 'STAFF_ACCOUNT_CREATED'").get().c, 1)
})

test('creates a kitchen login and refuses students or unknown roles', () => {
  const db = initializeDatabase(':memory:')
  assert.equal(createOrResetStaffAccount(db, { role: 'KITCHEN', login: 'kitchen1', password: PASSWORD }).role, 'KITCHEN')
  for (const role of ['STUDENT', 'ADMIN', '']) {
    assert.throws(() => createOrResetStaffAccount(db, { role, login: 'x-' + role, password: PASSWORD }), /OWNER or KITCHEN/)
  }
})

test('never overwrites an existing login without an explicit reset', () => {
  const db = initializeDatabase(':memory:')
  createOrResetStaffAccount(db, { role: 'OWNER', login: 'owner1', password: PASSWORD })
  assert.throws(() => createOrResetStaffAccount(db, { role: 'OWNER', login: 'OWNER1', password: 'another-password-12' }), /already exists/)
  assert.ok(login(db, 'owner1', PASSWORD))
})

test('reset changes only the password of the same-role login', () => {
  const db = initializeDatabase(':memory:')
  createOrResetStaffAccount(db, { role: 'KITCHEN', login: 'kitchen1', password: PASSWORD })
  assert.throws(() => createOrResetStaffAccount(db, { role: 'OWNER', login: 'kitchen1', password: 'another-password-12', resetPassword: true }), /different role/)
  assert.equal(createOrResetStaffAccount(db, { role: 'KITCHEN', login: 'kitchen1', password: 'another-password-12', resetPassword: true }).outcome, 'password_reset')
  assert.throws(() => login(db, 'kitchen1', PASSWORD), /incorrect/)
  assert.ok(login(db, 'kitchen1', 'another-password-12'))
  assert.throws(() => createOrResetStaffAccount(db, { role: 'KITCHEN', login: 'nobody', password: PASSWORD, resetPassword: true }), /No such login/)
})

test('rejects weak passwords, bad logins and email collisions, leaving nothing behind', () => {
  const db = initializeDatabase(':memory:')
  assert.throws(() => createOrResetStaffAccount(db, { role: 'OWNER', login: 'owner2', password: 'short' }), /12 and 128/)
  assert.throws(() => createOrResetStaffAccount(db, { role: 'OWNER', login: 'has space', password: PASSWORD }), /no spaces/)
  db.prepare(`INSERT INTO users (public_id, role, display_name, email, phone_verified, status) VALUES ('usr_s', 'STUDENT', 'S', 'student@example.com', 0, 'ACTIVE')`).run()
  assert.throws(() => createOrResetStaffAccount(db, { role: 'OWNER', login: 'student@example.com', password: PASSWORD }), /another account/)
  assert.equal(db.prepare("SELECT COUNT(*) c FROM users WHERE role != 'STUDENT'").get().c, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM auth_identities').get().c, 0)
})

function runCli(args, env, stdin) {
  return spawnSync(process.execPath, ['--no-warnings', script, ...args], {
    input: stdin, encoding: 'utf8', env: { PATH: process.env.PATH, ...env },
  })
}

test('CLI creates an account from piped input and never prints the password', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'staff-cli-'))
  try {
    const dbPath = path.join(dir, 'app.db')
    initializeDatabase(dbPath).close()
    const ok = runCli(['--role', 'OWNER', '--login', 'owner@example.com', '--name', 'Owner'], { CAMPUSBITE_DB_PATH: dbPath }, `${PASSWORD}\n${PASSWORD}\n`)
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /created: OWNER login "owner@example.com"/)
    assert.ok(!ok.stdout.includes(PASSWORD) && !ok.stderr.includes(PASSWORD))
    const db = new DatabaseSync(dbPath)
    assert.ok(login(db, 'owner@example.com', PASSWORD))
    db.close()

    const mismatch = runCli(['--role', 'KITCHEN', '--login', 'kitchen1'], { CAMPUSBITE_DB_PATH: dbPath }, `${PASSWORD}\nsomething-else-123\n`)
    assert.equal(mismatch.status, 1)
    assert.match(mismatch.stderr, /do not match/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('CLI refuses without a database path, a missing file, or an unmigrated schema', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'staff-cli-'))
  try {
    const noEnv = runCli(['--role', 'OWNER', '--login', 'o1'], {}, `${PASSWORD}\n${PASSWORD}\n`)
    assert.equal(noEnv.status, 1); assert.match(noEnv.stderr, /CAMPUSBITE_DB_PATH is not set/)
    const missing = runCli(['--role', 'OWNER', '--login', 'o1'], { CAMPUSBITE_DB_PATH: path.join(dir, 'none.db') }, `${PASSWORD}\n${PASSWORD}\n`)
    assert.equal(missing.status, 1); assert.match(missing.stderr, /not found/)
    const oldPath = path.join(dir, 'old.db')
    const old = new DatabaseSync(oldPath); old.exec('PRAGMA user_version = 7; CREATE TABLE users(id INTEGER);'); old.close()
    const stale = runCli(['--role', 'OWNER', '--login', 'o1'], { CAMPUSBITE_DB_PATH: oldPath }, `${PASSWORD}\n${PASSWORD}\n`)
    assert.equal(stale.status, 1); assert.match(stale.stderr, /schema is 7, expected 12/)
    const check = new DatabaseSync(oldPath); assert.equal(check.prepare('PRAGMA user_version').get().user_version, 7); check.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

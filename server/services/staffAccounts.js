import { randomUUID } from 'node:crypto'
import { hashPassword, validatePassword } from './passwords.js'

// Production-safe creation of owner and kitchen logins. Never creates students
// (students sign in with Google) and never overwrites an existing login unless
// a password reset is explicitly requested for the same role.
export const STAFF_ROLES = Object.freeze(['OWNER', 'KITCHEN'])

export function normalizeStaffLogin(value) {
  if (typeof value !== 'string') throw new Error('Login identifier is required.')
  const login = value.trim().toLowerCase()
  if (login.length < 3 || login.length > 160 || /[\s\r\n]/.test(login)) {
    throw new Error('Login identifier must be 3-160 characters with no spaces.')
  }
  return login
}

function normalizeRole(value) {
  const role = String(value || '').trim().toUpperCase()
  if (!STAFF_ROLES.includes(role)) throw new Error('Role must be OWNER or KITCHEN.')
  return role
}

function normalizeName(value, role) {
  const name = String(value || '').trim()
  if (name.length > 80 || /[\r\n]/.test(name)) throw new Error('Display name must be at most 80 characters.')
  return name || (role === 'OWNER' ? 'Owner' : 'Kitchen')
}

export function createOrResetStaffAccount(database, { role, login, displayName, password, resetPassword = false }) {
  const staffRole = normalizeRole(role)
  const identifier = normalizeStaffLogin(login)
  validatePassword(password)

  database.exec('BEGIN IMMEDIATE;')
  try {
    const existing = database
      .prepare(
        `SELECT ai.id AS identity_id, u.id AS user_id, u.role
           FROM auth_identities ai JOIN users u ON u.id = ai.user_id
          WHERE ai.provider = 'LOCAL' AND lower(ai.login_identifier) = ?`,
      )
      .get(identifier)

    let outcome
    if (existing) {
      if (!resetPassword) throw new Error('That login already exists. Use --reset-password to change its password.')
      if (existing.role !== staffRole) throw new Error('That login belongs to a different role; refusing to change it.')
      database
        .prepare('UPDATE auth_identities SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(hashPassword(password), existing.identity_id)
      database
        .prepare(`INSERT INTO auth_events (user_id, event_type, success, metadata_json) VALUES (?, 'STAFF_PASSWORD_RESET', 1, ?)`)
        .run(existing.user_id, JSON.stringify({ provider: 'LOCAL', role: staffRole, source: 'staff-account-cli' }))
      outcome = 'password_reset'
    } else {
      if (resetPassword) throw new Error('No such login to reset.')
      if (identifier.includes('@') && database.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(identifier)) {
        throw new Error('That email already belongs to another account; refusing to link it.')
      }
      const publicId = `usr_${randomUUID()}`
      const user = database
        .prepare(`INSERT INTO users (public_id, role, display_name, email, phone_verified, status) VALUES (?, ?, ?, ?, 0, 'ACTIVE')`)
        .run(publicId, staffRole, normalizeName(displayName, staffRole), identifier.includes('@') ? identifier : null)
      const userId = Number(user.lastInsertRowid)
      database
        .prepare(`INSERT INTO auth_identities (user_id, provider, provider_subject, login_identifier, password_hash) VALUES (?, 'LOCAL', ?, ?, ?)`)
        .run(userId, `local:${publicId}`, identifier, hashPassword(password))
      database
        .prepare(`INSERT INTO auth_events (user_id, event_type, success, metadata_json) VALUES (?, 'STAFF_ACCOUNT_CREATED', 1, ?)`)
        .run(userId, JSON.stringify({ provider: 'LOCAL', role: staffRole, source: 'staff-account-cli' }))
      outcome = 'created'
    }
    database.exec('COMMIT;')
    return { outcome, role: staffRole, login: identifier }
  } catch (error) {
    try { database.exec('ROLLBACK;') } catch { /* already rolled back */ }
    throw error
  }
}

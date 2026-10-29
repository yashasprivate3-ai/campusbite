import { randomUUID } from 'node:crypto'
import { hashPassword, validatePassword, verifyPassword } from './passwords.js'

function normalizeIdentifier(value, role) {
  if (typeof value !== 'string') {
    throw new Error(`${role} development login identifier is required.`)
  }

  const identifier = value.trim().toLowerCase()

  if (identifier.length < 3 || identifier.length > 160 || /[\r\n]/.test(identifier)) {
    throw new Error(`${role} development login identifier is invalid.`)
  }

  return identifier
}

function findIdentity(database, identifier) {
  return database
    .prepare(
      `SELECT ai.id AS identity_id, ai.password_hash, u.id AS user_id,
              u.role, u.status
         FROM auth_identities ai
         JOIN users u ON u.id = ai.user_id
        WHERE ai.provider = 'LOCAL'
          AND lower(ai.login_identifier) = ?`,
    )
    .get(identifier)
}

function findUserByEmail(database, identifier) {
  if (!identifier.includes('@')) return null
  return database
    .prepare('SELECT id, role FROM users WHERE lower(email) = ?')
    .get(identifier)
}

function seedAccount(database, account, resetPassword) {
  const identifier = normalizeIdentifier(account.identifier, account.role)
  validatePassword(account.password, `${account.role} development password`)
  const existingIdentity = findIdentity(database, identifier)

  if (existingIdentity) {
    if (existingIdentity.role !== account.role) {
      throw new Error(
        `${account.role} development login is already assigned to another role.`,
      )
    }

    if (
      resetPassword &&
      !verifyPassword(account.password, existingIdentity.password_hash)
    ) {
      database
        .prepare(
          `UPDATE auth_identities
              SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
        )
        .run(hashPassword(account.password), existingIdentity.identity_id)
      return 'updated'
    }

    return 'unchanged'
  }

  let user = findUserByEmail(database, identifier)

  if (user && user.role !== account.role) {
    throw new Error(
      `${account.role} development email is already assigned to another role.`,
    )
  }

  if (!user) {
    const result = database
      .prepare(
        `INSERT INTO users (
           public_id, role, display_name, email, phone_verified, status
         ) VALUES (?, ?, ?, ?, 0, 'ACTIVE')`,
      )
      .run(
        `usr_${randomUUID()}`,
        account.role,
        account.displayName.trim() || account.role,
        identifier.includes('@') ? identifier : null,
      )
    user = { id: Number(result.lastInsertRowid), role: account.role }
  }

  const publicId = database
    .prepare('SELECT public_id FROM users WHERE id = ?')
    .get(user.id).public_id

  database
    .prepare(
      `INSERT INTO auth_identities (
         user_id, provider, provider_subject, login_identifier, password_hash
       ) VALUES (?, 'LOCAL', ?, ?, ?)`,
    )
    .run(
      user.id,
      `local:${publicId}`,
      identifier,
      hashPassword(account.password),
    )
  database
    .prepare(
      `INSERT INTO auth_events (user_id, event_type, success, metadata_json)
       VALUES (?, 'DEVELOPMENT_ACCOUNT_CREATED', 1, ?)`,
    )
    .run(user.id, JSON.stringify({ provider: 'LOCAL', role: account.role }))

  return 'created'
}

export function seedDevelopmentAccounts(database, authConfig) {
  if (!authConfig.developmentAccountsEnabled) {
    return { enabled: false, created: 0, updated: 0, unchanged: 0 }
  }

  const summary = { enabled: true, created: 0, updated: 0, unchanged: 0 }
  database.exec('BEGIN IMMEDIATE;')

  try {
    authConfig.developmentAccounts.forEach((account) => {
      const result = seedAccount(
        database,
        account,
        authConfig.resetDevelopmentPasswords,
      )
      summary[result] += 1
    })
    database.exec('COMMIT;')
    return summary
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }
}

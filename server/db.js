import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const SCHEMA_VERSION = 5

const baseSchema = `
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    pickup_method TEXT NOT NULL CHECK (pickup_method IN ('asap', 'scheduled')),
    pickup_slot TEXT,
    instructions TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'student',
    total_amount INTEGER NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    status TEXT NOT NULL DEFAULT 'new'
      CHECK (status IN ('new', 'preparing', 'ready')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_item_id INTEGER,
    item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('new', 'preparing', 'ready')),
    batch_item TEXT,
    status_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS batch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_key TEXT NOT NULL UNIQUE,
    item_name TEXT NOT NULL,
    required_quantity INTEGER NOT NULL CHECK (required_quantity > 0),
    linked_orders_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK (status IN ('preparing', 'completed')),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    batch_history_id INTEGER,
    event_type TEXT NOT NULL,
    detail TEXT,
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    FOREIGN KEY (batch_history_id) REFERENCES batch_history(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_status_history_order_id ON status_history(order_id);
  CREATE INDEX IF NOT EXISTS idx_status_history_status_at ON status_history(status_at);
  CREATE INDEX IF NOT EXISTS idx_batch_history_status ON batch_history(status);
  CREATE INDEX IF NOT EXISTS idx_activity_events_order_id ON activity_events(order_id);
  CREATE INDEX IF NOT EXISTS idx_activity_events_occurred_at ON activity_events(occurred_at);
`

function hasColumn(database, tableName, columnName) {
  return database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName)
}

function addColumnIfMissing(database, tableName, columnName, definition) {
  if (!hasColumn(database, tableName, columnName)) {
    database.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`,
    )
  }
}

function migrateToVersion2(database) {
  addColumnIfMissing(database, 'orders', 'client_request_id', 'TEXT')
  addColumnIfMissing(database, 'orders', 'request_fingerprint', 'TEXT')
  addColumnIfMissing(
    database,
    'order_items',
    'unit_price_paise',
    'INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_paise >= 0)',
  )
  addColumnIfMissing(database, 'order_items', 'preparation_type', 'TEXT')
  addColumnIfMissing(database, 'order_items', 'preparation_time', 'TEXT')

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_request_id
      ON orders(client_request_id)
      WHERE client_request_id IS NOT NULL;
  `)
}

function migrateToVersion3(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('OWNER', 'KITCHEN', 'STUDENT')),
      display_name TEXT NOT NULL,
      email TEXT,
      phone_number TEXT,
      phone_verified INTEGER NOT NULL DEFAULT 0
        CHECK (phone_verified IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'DISABLED')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL
        CHECK (provider IN ('LOCAL', 'GOOGLE', 'WHATSAPP_PHONE', 'SMS_PHONE')),
      provider_subject TEXT,
      login_identifier TEXT,
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE (provider, provider_subject)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT,
      user_agent TEXT,
      created_ip TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      event_type TEXT NOT NULL,
      success INTEGER NOT NULL CHECK (success IN (0, 1)),
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized
      ON users(lower(email))
      WHERE email IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_users_role_status
      ON users(role, status);
    CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id
      ON auth_identities(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_identities_login
      ON auth_identities(provider, lower(login_identifier))
      WHERE login_identifier IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id
      ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
      ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_auth_events_user_id
      ON auth_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_events_created_at
      ON auth_events(created_at);
  `)

  addColumnIfMissing(
    database,
    'orders',
    'student_user_id',
    'INTEGER REFERENCES users(id) ON DELETE SET NULL',
  )
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_student_user_id
      ON orders(student_user_id);
  `)
}

function migrateToVersion4(database) {
  addColumnIfMissing(database, 'users', 'profile_picture_url', 'TEXT')
  addColumnIfMissing(
    database,
    'users',
    'email_verified',
    'INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1))',
  )
  addColumnIfMissing(database, 'users', 'last_login_at', 'TEXT')
  addColumnIfMissing(database, 'users', 'onboarding_completed_at', 'TEXT')
  addColumnIfMissing(database, 'auth_identities', 'last_used_at', 'TEXT')

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_verified_phone_unique
      ON users(phone_number)
      WHERE phone_number IS NOT NULL AND phone_verified = 1;
  `)
}

function migrateToVersion5(database) {
  addColumnIfMissing(database, 'users', 'phone_verified_at', 'TEXT')

  database.exec(`
    CREATE TABLE IF NOT EXISTS phone_verification_challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      phone_number TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('development', 'meta-whatsapp')),
      expires_at TEXT NOT NULL,
      resend_available_at TEXT NOT NULL,
      failed_attempts INTEGER NOT NULL DEFAULT 0
        CHECK (failed_attempts BETWEEN 0 AND 5),
      consumed_at TEXT,
      invalidated_at TEXT,
      request_ip_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_phone_verification_user_created
      ON phone_verification_challenges(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_phone_verification_phone_created
      ON phone_verification_challenges(phone_number, created_at);
    CREATE INDEX IF NOT EXISTS idx_phone_verification_ip_created
      ON phone_verification_challenges(request_ip_hash, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_verification_active_user_phone
      ON phone_verification_challenges(user_id, phone_number)
      WHERE consumed_at IS NULL AND invalidated_at IS NULL;
  `)
}

export function initializeDatabase(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true })

  const database = new DatabaseSync(databasePath)

  try {
    database.exec('PRAGMA foreign_keys = ON;')
    database.exec('PRAGMA journal_mode = WAL;')
    database.exec('PRAGMA busy_timeout = 5000;')
    database.exec('BEGIN IMMEDIATE;')

    const currentVersion = database.prepare('PRAGMA user_version').get()
      .user_version

    if (currentVersion > SCHEMA_VERSION) {
      throw new Error(
        `Database schema version ${currentVersion} is newer than supported version ${SCHEMA_VERSION}.`,
      )
    }

    database.exec(baseSchema)

    if (currentVersion < 2) {
      migrateToVersion2(database)
    }

    if (currentVersion < 3) {
      migrateToVersion3(database)
    }

    if (currentVersion < 4) {
      migrateToVersion4(database)
    }

    if (currentVersion < 5) {
      migrateToVersion5(database)
    }

    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`)
    database.exec('COMMIT;')
    return database
  } catch (error) {
    try {
      database.exec('ROLLBACK;')
    } catch {
      // The transaction may not have started; the original error is more useful.
    }

    database.close()
    throw error
  }
}

export { SCHEMA_VERSION }

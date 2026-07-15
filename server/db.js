import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const SCHEMA_VERSION = 2

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

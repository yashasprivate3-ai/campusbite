# Sprint 6.1 — Backend Foundation

## Scope

Sprint 6.1 adds a local API and an initialized SQLite database without moving any Student or Kitchen data out of browser `localStorage`. There are no order CRUD endpoints in this sprint.

## Architecture

```text
React/Vite frontend
  └─ /api development proxy
       └─ Node.js HTTP server
            ├─ GET /api/health
            └─ node:sqlite
                 └─ data/campusbite.db
```

The backend uses only modules included with Node.js 24:

- `node:http` for the HTTP server;
- `node:sqlite` for SQLite;
- `process.loadEnvFile()` for optional `.env` configuration;
- `node:child_process` for the combined development command.

No backend dependency package is required.

## Project structure

```text
server/
  config.js
  db.js
  dev.js
  index.js
  routes/
    health.js
  services/
    http.js
data/
  campusbite.db        # generated locally and ignored by Git
.env.example
```

## Requirements and setup

- Node.js 24 or newer with `node:sqlite` support;
- npm 11 or compatible.

Install the existing frontend dependencies after cloning:

```powershell
npm.cmd install
```

No additional SQLite or server package needs to be installed.

Optional local configuration:

```powershell
Copy-Item .env.example .env
```

Available values:

```dotenv
CAMPUSBITE_API_HOST=127.0.0.1
CAMPUSBITE_API_PORT=3001
CAMPUSBITE_DB_PATH=./data/campusbite.db
```

`.env` is ignored by Git. `.env.example` contains no secrets.

## Run commands

Frontend only:

```powershell
npm.cmd run dev
```

Backend only:

```powershell
npm.cmd run server
```

Frontend and backend together:

```powershell
npm.cmd run dev:all
```

Quality checks:

```powershell
npm.cmd run lint
npm.cmd run build
```

## API

Direct local API URL:

```text
http://127.0.0.1:3001/api/health
```

When the Vite development server and backend are both running, the frontend can use the relative URL:

```text
/api/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "campusbite-api"
}
```

Unknown routes return a JSON `404` response. Unexpected request errors return a JSON `500` response. A database initialization error logs a clear message and prevents the server from starting.

## Database

Default location:

```text
data/campusbite.db
```

The database is created automatically when the API starts. Initialization is idempotent, enables foreign keys, uses WAL journaling, and records schema version `1`.

### Schema

| Table | Purpose | Important relationships and constraints |
| --- | --- | --- |
| `orders` | Order header and pickup state | Unique token; status must be `new`, `preparing`, or `ready` |
| `order_items` | Item names and quantities | `order_id` references `orders`; cascades on delete |
| `status_history` | Order lifecycle audit | `order_id` references `orders`; constrained order status |
| `batch_history` | Preparing and completed batch records | Unique batch key; batch status is `preparing` or `completed` |
| `activity_events` | Kitchen activity records | Optional links to `orders` and `batch_history` |

Every table includes a primary key plus `created_at` and `updated_at`. Foreign keys and common lookup indexes are created during initialization.

## Known limitations

- Student and Kitchen orders still use browser `localStorage`.
- No browser data is migrated into SQLite.
- No order, item, batch, status, or activity API endpoints exist yet.
- No authentication, authorization, payments, inventory, or analytics are included.
- The server is intended for local development only.

## Sprint 6.2 next step

Sprint 6.2 should define validated order persistence endpoints and an explicit migration/synchronization strategy. Existing browser orders should remain untouched until that work is designed and tested.

# Sprint 6.2 — Shared Order Persistence

## Objective

Sprint 6.2 makes SQLite the source of truth for active CampusBite orders. A student checkout is saved through the API, the kitchen reads the same record, status changes are persisted, and student tracking reloads the latest backend state after refresh or restart.

This sprint does not add authentication, payments, POS, inventory, workforce, printing, or external integrations.

## Architecture

```text
Student checkout ──POST /api/orders──────┐
                                         v
React/Vite <──Vite /api proxy──> Node HTTP API <──> SQLite
   ^                                     |
   ├── Kitchen polling: GET /api/orders──┤
   ├── Status actions: PATCH /status─────┤
   └── Tracking: GET /api/orders/:id─────┘
```

- The Node server continues to use the built-in `node:http` and `node:sqlite` modules; no framework or SQLite package was added.
- Orders, items, status history, and order activity events are written in SQLite transactions.
- The Vite proxy keeps browser requests same-origin in development.
- The browser stores only the tracked order ID for recovery. The full tracked order is fetched from the API.
- The legacy `campusbite-kitchen-orders` localStorage value is not deleted, but it is no longer read or written as the active order queue.
- Existing local batch records remain under `campusbite-kitchen-batches` for Sprint 4 timer/history compatibility.

## API Endpoints

### `POST /api/orders`

Creates an order and all item rows in one transaction. The server calculates the total from integer item prices, assigns the public token, creates the initial `new` history row, and records an `order_received` activity event.

Example request:

```json
{
  "clientRequestId": "a14f7cb2-0f99-40d4-af41-09a792460867",
  "pickupMethod": "asap",
  "pickupSlot": null,
  "instructions": "Pack coffee separately",
  "source": "student",
  "items": [
    {
      "menuItemId": 1,
      "name": "Veg Fried Rice",
      "quantity": 2,
      "unitPricePaise": 7000,
      "preparationType": "made-to-order",
      "preparationTime": "8-10 min"
    }
  ]
}
```

First response: HTTP `201`. An exact idempotent replay returns HTTP `200` with `created: false` and the original order.

```json
{
  "created": true,
  "order": {
    "id": 12,
    "token": "CB-4B85A1F2",
    "total": 140,
    "totalPaise": 14000,
    "status": "new",
    "items": [],
    "statusHistory": [],
    "createdAt": "2026-07-15 14:30:00",
    "updatedAt": "2026-07-15 14:30:00"
  }
}
```

The abbreviated arrays above contain the saved item and initial history record in a real response.

### `GET /api/orders`

Returns complete orders with items and status history, ordered by `created_at DESC, id DESC`.

Optional filters:

```text
GET /api/orders?status=new
GET /api/orders?status=new,preparing
GET /api/orders?status=new&status=ready
```

### `GET /api/orders/:id`

Returns one complete order for student tracking. A missing order returns HTTP `404` with `order_not_found`.

### `PATCH /api/orders/:id/status`

Example:

```json
{
  "status": "preparing",
  "batchItem": "Veg Fried Rice"
}
```

Only these transitions are accepted:

```text
new -> preparing -> ready
```

Backward, repeated, and skipped transitions return HTTP `409` with `invalid_status_transition`. A successful transition updates the order timestamp and writes status history and activity rows in one transaction.

## Database Changes

The safe migration raises `PRAGMA user_version` from `1` to `2` and preserves existing rows.

Added to `orders`:

- `client_request_id TEXT`
- `request_fingerprint TEXT`
- partial unique index on non-null `client_request_id`

Added to `order_items`:

- `unit_price_paise INTEGER NOT NULL DEFAULT 0`
- `preparation_type TEXT`
- `preparation_time TEXT`

`orders.total_amount` is now used consistently as integer paise for new orders. Existing version-1 rows are not rewritten.

Database location by default:

```text
data/campusbite.db
```

Override it locally with `CAMPUSBITE_DB_PATH` in `.env` when an isolated database is needed.

## Idempotency and Checkout Safety

- The browser generates one UUID when confirmation begins.
- The same UUID is retained for a failed or uncertain retry while checkout contents are unchanged.
- The confirm button is disabled and shows a saving state while the request is in flight.
- SQLite enforces uniqueness on the client request ID.
- The server stores a SHA-256 fingerprint of the normalized order. Reusing an ID for different content returns HTTP `409` instead of returning the wrong order.
- The cart is cleared only after the backend returns a saved order. Network or validation failures leave the cart and review screen intact.

## Frontend Integration

### Student checkout

Checkout calls `POST /api/orders`, waits for confirmation, then uses the returned numeric ID and public token. Failure feedback is shown directly on the review screen.

### Kitchen

The kitchen hook loads orders from SQLite and polls every 5 seconds. It avoids overlapping list requests, preserves the existing rendered array when the API response is unchanged, and cancels timers/requests during cleanup. Status buttons update the UI only after `PATCH` succeeds. Failed updates retain server state, show an error banner, and offer retry.

### Tracking

The tracked numeric order ID is stored in `campusbite-tracked-order-id`. The tracking hook calls `GET /api/orders/:id` and polls every 3 seconds while tracking is visible. It shows token, items, integer-backed total, status progression, pickup data, placed/updated timestamps, loading, unavailable, and retry states.

## Batch Compatibility

Backend order objects keep the field names required by the existing batch calculator: token, status, items, item name, quantity, timestamps, and status history.

Batch actions call the per-order status API for linked orders and preserve batch item traceability in `status_history.batch_item`. If a new order containing the same made-on-order item arrives while a local batch record is preparing, the app joins that order by moving it to `preparing` and expanding the active local batch record.

Full batch records, timers, and completed batch history still use localStorage. They are not yet shared across different browsers or devices. Multi-item orders also retain the existing order-level status model; per-item preparation status is not part of Sprint 6.2.

## Run Commands

```powershell
npm.cmd run dev:all
```

This starts:

- Frontend: `http://localhost:5173`
- API: `http://127.0.0.1:3001`
- Health check: `http://127.0.0.1:3001/api/health`

Quality checks:

```powershell
npm.cmd run lint
npm.cmd run build
```

## Manual QA

1. Start with `npm.cmd run dev:all` and confirm `/api/health` returns `status: ok`.
2. Add an item, complete pickup details, and confirm the order.
3. Confirm the checkout button disables while saving and the backend token is shown only after success.
4. Open Kitchen and confirm the same token, items, quantities, pickup details, and `NEW` status appear.
5. Start the batch and confirm the order moves to `PREPARING` and the timer starts.
6. Open Student tracking and confirm it changes to Preparing without refresh.
7. Complete the batch and confirm Kitchen shows `READY` and tracking shows Ready for Pickup.
8. Refresh both views and confirm the same database record/status returns.
9. Restart the backend or `dev:all` and confirm the order remains available.
10. Replay the same `clientRequestId` through the API and confirm no second row is created.
11. Try `new -> ready` and a backward transition and confirm HTTP `409`.
12. Stop the backend during checkout and confirm the cart remains on screen with a retry message.

## Known Limitations

- There is no authentication or ownership check for tracking IDs yet.
- Polling is used instead of WebSockets or server-sent events.
- Batch history/timers remain browser-local, so another kitchen device does not share those records.
- The API has no pagination or archival/completed status; suitable limits can be added when pilot order volume requires them.
- Legacy browser-only active orders are preserved in localStorage but are not automatically migrated into SQLite.
- Payment remains a later sprint and is not represented by this API.

## QA Hurdles and Fixes

- A stale earlier `dev:all` process occupied port 3001. The CampusBite-only process tree was identified and restarted before live verification.
- SQLite `CURRENT_TIMESTAMP` values are UTC text without a timezone suffix. The first live batch timer treated one as local time and jumped ahead by about 5.5 hours. API timestamp mapping now emits explicit ISO UTC values, and previously stored local batch timestamps are normalized when loaded.
- Vite's build worker was blocked by the restricted verification runner (`spawn EPERM`). The identical `npm.cmd run build` command passed with normal local permissions; this was an execution-environment restriction, not an application build error.

## Next Step

Review and pilot Sprint 6.2 before selecting the next roadmap item. A future backend sprint can persist shared batch records and introduce explicit order ownership without changing this order API contract.

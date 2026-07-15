# Sprint 7.0 — Authentication Foundation

## Objective and scope

Sprint 7.0 adds local authentication, server-managed sessions, role authorization, and authenticated student order ownership. It preserves the Sprint 6.2 SQLite order flow and does not add Google OAuth, phone verification, payments, analytics, or any external provider.

## Architecture

- React owns one central authentication context and recovers the current session from `GET /api/auth/me`.
- The browser receives an opaque session value only in an HttpOnly cookie. JavaScript never reads or stores it.
- The Node API authenticates the cookie, loads the user and enforces roles before executing protected order operations.
- SQLite remains the source of truth for users, identities, sessions, audit events, orders, items, and status history.
- A user can gain additional provider identities later without replacing their user record or session model.

## Database migration

Schema version 3 is an additive transaction-safe migration. It creates `users`, `auth_identities`, `sessions`, and `auth_events`, adds nullable `orders.student_user_id`, and adds supporting indexes. Existing orders remain unowned and visible to OWNER/KITCHEN. No existing order, item, status, batch, activity, or idempotency field is deleted or rewritten.

### Authentication tables

| Table | Important fields |
| --- | --- |
| `users` | `public_id`, `role`, `display_name`, optional email/phone, phone verification, account status, timestamps |
| `auth_identities` | user FK, provider, provider subject, normalized login identifier, optional password hash, timestamps |
| `sessions` | user FK, SHA-256 token hash, expiry, last use, revocation, bounded user agent and direct socket IP metadata |
| `auth_events` | optional user FK, event type, success flag, sanitized JSON metadata, timestamp |

Supported roles are `OWNER`, `KITCHEN`, and `STUDENT`; account statuses are `ACTIVE` and `DISABLED`. Identity providers reserved by the schema are `LOCAL`, `GOOGLE`, `WHATSAPP_PHONE`, and `SMS_PHONE`. Only `LOCAL` is implemented.

## Password security

Local passwords use Node's built-in `crypto.scrypt` with a unique 16-byte random salt, a 64-byte derived key, `N=16384`, `r=8`, `p=1`, and a 64 MiB memory ceiling. The stored format is `scrypt$N$r$p$saltBase64url$hashBase64url`. Verification uses `timingSafeEqual`. Passwords are validated at 12–128 characters and never logged, returned, or included in audit metadata.

## Session design and cookies

Each login creates 32 cryptographically random bytes encoded as base64url. Only its SHA-256 hash is stored in `sessions`; the raw value is sent as an HttpOnly cookie. Cookies use `SameSite=Lax`, `Path=/api`, an explicit expiry and max age, and `Secure` automatically in production. Session expiry defaults to 12 hours. `last_used_at` is touched at most once per configured interval (15 minutes by default). Logout revokes the database session and expires the cookie. Persisted sessions continue across API restarts.

## API

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `POST /api/auth/login` | Public, throttled | Verify a local identity, create a session, return a safe user profile |
| `POST /api/auth/logout` | Safe with or without a session | Revoke the current session and clear the cookie |
| `GET /api/auth/me` | Authenticated | Return only the safe current user profile |
| `POST /api/orders` | STUDENT | Create an owned, idempotent order |
| `GET /api/orders` | OWNER, KITCHEN | List operational orders |
| `GET /api/orders/:id` | OWNER, KITCHEN, owning STUDENT | Retrieve an authorized order |
| `PATCH /api/orders/:id/status` | OWNER, KITCHEN | Apply the existing valid lifecycle transition |

Errors use the existing `{ "error": "code", "message": "safe message", "details": {} }` JSON envelope. A student requesting an order they do not own receives `404`, preventing order-existence disclosure.

## Authorization helpers

`optionalAuth` resolves a valid session when present. `requireAuth` returns 401 without one. `requireRole` and `requireAnyRole` centralize 403 role checks and record rate-limited `FORBIDDEN_ACCESS` audit events.

## Role-permission matrix

| Capability | OWNER | KITCHEN | STUDENT |
| --- | --- | --- | --- |
| Owner placeholder | Yes | No | No |
| Kitchen workflow and operational order list | Yes | Yes | No |
| NEW → PREPARING → READY | Yes | Yes | No |
| Student menu and checkout | No | No | Yes |
| Create a student order | No | No | Yes |
| Track an owned order | No | No | Yes |
| Track another student's order | No | No | No |

## Development account setup

1. Copy `.env.example` to ignored `.env`.
2. Set `CAMPUSBITE_DEV_ACCOUNTS_ENABLED=true` only for local development/QA.
3. Supply unique owner, kitchen, and student login identifiers and passwords. Passwords must be 12–128 characters.
4. Start the API. Missing or invalid development credentials stop startup with a clear setup error.

Seeding is idempotent. Existing matching identities are reused. Set `CAMPUSBITE_DEV_RESET_PASSWORDS=true` only for an intentional local password reset, then return it to `false`. Development STUDENT login is rejected whenever development accounts are disabled or `NODE_ENV=production`. No setup endpoint exists.

## Student ownership and frontend authentication

The API derives `student_user_id` only from the authenticated session and ignores browser ownership claims. Request-ID replay remains scoped to the owning student, and a request ID cannot reveal or replay another student's order. The frontend stores only the backend order ID needed for tracking. Cart and tracking keys are user-scoped; the session token is not stored in localStorage.

`AuthProvider` exposes the user, role, loading state, login, logout, and session refresh. Protected requests include cookies. A 401 clears the in-memory user and returns the app to login with an expiry message. Backend failures remain visible and do not silently discard a still-valid session during failed logout.

OWNER opens a small owner foundation screen with access to Kitchen. KITCHEN opens Kitchen directly. STUDENT opens the existing ordering workspace and owned tracking flow. Normal navigation exposes only authorized workspaces; the backend remains the security boundary.

## Audit events and protections

Events include `LOGIN_SUCCEEDED`, `LOGIN_FAILED`, `DISABLED_ACCOUNT_LOGIN_ATTEMPT`, `LOGOUT`, `SESSION_EXPIRED`, `SESSION_REVOKED`, and rate-limited `FORBIDDEN_ACCESS`. Metadata is limited and sanitized. Passwords, raw session tokens, token hashes, request bodies, and future OTP/provider secrets are excluded. Login failures receive a delay and repeated attempts are throttled per hashed direct-IP/identifier key with `Retry-After`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Controls development/production behavior |
| `CAMPUSBITE_API_HOST`, `CAMPUSBITE_API_PORT` | Local API bind address and port |
| `CAMPUSBITE_DB_PATH` | SQLite location relative to the project unless absolute |
| `CAMPUSBITE_AUTH_COOKIE_NAME` | Session cookie name |
| `CAMPUSBITE_AUTH_COOKIE_SECURE` | Optional development override; production is always secure |
| `CAMPUSBITE_AUTH_SESSION_TTL_HOURS` | Persisted session lifetime |
| `CAMPUSBITE_AUTH_SESSION_TOUCH_MINUTES` | Minimum interval between last-use writes |
| `CAMPUSBITE_AUTH_LOGIN_MAX_ATTEMPTS` | Failed attempts allowed in the time window |
| `CAMPUSBITE_AUTH_LOGIN_WINDOW_MINUTES` | Throttle window |
| `CAMPUSBITE_DEV_ACCOUNTS_ENABLED` | Enables local development account seeding and STUDENT local login |
| `CAMPUSBITE_DEV_RESET_PASSWORDS` | Explicitly rotates configured local passwords |
| `CAMPUSBITE_DEV_*_NAME/LOGIN/PASSWORD` | Local OWNER, KITCHEN, and STUDENT seed values |

## Run commands

```powershell
npm.cmd run dev:all
npm.cmd run lint
npm.cmd run build
```

Frontend: `http://127.0.0.1:5173`  
API: `http://127.0.0.1:3001`  
Health: `http://127.0.0.1:3001/api/health`

## Manual QA

1. Sign in as each configured role and verify only the correct workspace appears.
2. Refresh and restart the backend; verify the session remains valid.
3. As STUDENT, add items, checkout, refresh tracking, and confirm a failed submission preserves the cart.
4. As KITCHEN, find the new token and move it NEW → PREPARING → READY.
5. Sign back in as the same STUDENT and verify READY; another student must receive 404.
6. Logout, then verify the revoked cookie cannot access `/api/auth/me`.
7. Check desktop and 390 px mobile layouts, console output, React warnings, and horizontal overflow.

## Automated/API QA

Exercise all auth endpoints with a cookie jar, assert cookie flags, query the database for ownership and hashed session storage, test 401/403/404/409/422 behavior, idempotent replay, valid/invalid status transitions, expiry and revocation, restart persistence, audit records, and `PRAGMA integrity_check` plus `PRAGMA foreign_key_check`.

## Known limitations and future adapters

- Login throttling is intentionally in process for this local single-instance foundation; a shared production rate limiter is required before horizontal deployment.
- Local accounts are environment-seeded; there is no registration, password recovery, account administration UI, CSRF token, or remote session management yet.
- SameSite cookies and JSON-only protected mutations provide a baseline, but production deployment should add explicit origin validation/CSRF defense, TLS, reverse-proxy configuration, security headers, and secrets management.
- The owner area is intentionally a placeholder; no analytics were added.

Future Google login should validate provider tokens server-side and attach a `GOOGLE` identity to a user. Future phone verification should attach `WHATSAPP_PHONE` or `SMS_PHONE` only after an approved one-time verification succeeds; OTP secrets must be short-lived and never logged. Verified phone and production identity are prerequisites for a later payment sprint, but no provider, OTP, or payment code is included here.

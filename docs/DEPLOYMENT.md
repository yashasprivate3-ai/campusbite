# Railway backend / Vercel frontend deployment

This configuration supports a production Node runtime. Keep payments **disabled**
for the initial release; neither this guide nor a successful deployment authorizes
test or real-money transactions. Enabling a payment provider requires separate
founder approval and a reviewed payment-specific release.

## Railway backend

Use Node 24.x (the application uses built-in `node:sqlite`). Install dependencies
with `npm ci`. Set the start command to `npm run server`; `npm start` is an alias
for the same entry point. Do not use `npm run dev`, `dev:all` or `preview` as the
production start command. Local Vite development and its proxy are unchanged.

Verify these values privately before deploying the new commit:

| Setting | Required value / action |
| --- | --- |
| `NODE_ENV` | `production` |
| `CAMPUSBITE_API_HOST` | `0.0.0.0` (also the production default); remove an old loopback override |
| `PORT` | Railway's assigned listener port; production uses this ahead of `CAMPUSBITE_API_PORT` |
| `CAMPUSBITE_API_PORT` | Optional fallback, default `3001`; local development uses it and ignores `PORT` |
| Public domain target port | Match the effective `PORT`, or fallback API port if `PORT` is absent |
| `CAMPUSBITE_DB_PATH` | `/app/data/campusbite.db`; mount the persistent volume at `/app/data` |
| `CAMPUSBITE_PAYMENT_PROVIDER` | `disabled` for this release |
| `CAMPUSBITE_PUBLIC_APP_URL` | Canonical HTTPS **frontend** origin, not the Railway backend URL |
| `CAMPUSBITE_OTP_PROVIDER` | The approved production provider, `msg91` or `meta-whatsapp`; development OTP is forbidden in production |
| `CAMPUSBITE_OTP_HASH_SECRET` | Existing private secret of at least 32 characters |
| `CAMPUSBITE_DEV_ACCOUNTS_ENABLED`, `CAMPUSBITE_DEV_RESET_PASSWORDS` | `false`; production disables both even if set true |

Choose exactly one OTP provider and configure the matching frontend selection.
For MSG91, set `CAMPUSBITE_OTP_PROVIDER=msg91` on Railway and
`VITE_CAMPUSBITE_OTP_PROVIDER=msg91`, `VITE_MSG91_WIDGET_ID`, and
`VITE_MSG91_TOKEN_AUTH` on Vercel. Keep `CAMPUSBITE_MSG91_AUTHKEY` private on
Railway; never place it in a `VITE_*` variable. For Meta WhatsApp, set
`CAMPUSBITE_OTP_PROVIDER=meta-whatsapp` and configure the private access token,
phone-number ID, WABA ID, approved authentication template name/language and
pinned Graph API version using the `CAMPUSBITE_META_WHATSAPP_*` variables
documented in `SPRINT-8.3-META-WHATSAPP-OTP.md`. A successful health check does
not establish provider delivery, widget origin authorization, sender permission
or template availability. Verify OTP only with an authorized test recipient and
explicit approval for that provider check.

For Google login, preserve `CAMPUSBITE_GOOGLE_LOGIN_ENABLED=true` and identical
`GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID` on the backend. Configure that same
public Web client ID on the frontend and authorize its exact HTTPS origin in
Google. The V1 student app origin is `https://campus.chefsinstinct.in`; do not
use the separate `chefsinstinct.com` marketing site as the app origin.
Mismatched client IDs still leave Google unconfigured. Do not add a Google
client secret for this identity-only flow.

Use one Railway instance with the mounted SQLite volume; do not horizontally
scale independent database files. Back up any existing volume database before
the first startup: normal server initialization applies pending schema migrations.
No database or production service was changed by this code-fix task.

## Vercel frontend and same-origin API

`vercel.ts` replaces `vercel.json` with the same Vite build/output settings and a
build-time external rewrite. Configure `CAMPUSBITE_BACKEND_URL` in the intended
Vercel environment to the actual Railway **HTTPS origin**, for example
`https://your-backend.up.railway.app` (placeholder only). Do not include `/api`,
credentials, query parameters or a fragment. This is deployment configuration,
not a `VITE_*` browser value. It must be available when Vercel evaluates config;
changing it requires rebuilding/redeploying the frontend.

For the connected pilot set `VITE_DEMO_MODE=false` (or leave it unset),
`VITE_CAMPUSBITE_DEV_STUDENT_LOGIN_ENABLED=false`, and, when enabling Google,
`VITE_CAMPUSBITE_GOOGLE_LOGIN_ENABLED=true` plus the matching `VITE_GOOGLE_CLIENT_ID`.
Never copy backend secrets into Vercel or any `VITE_*` variable. Missing/invalid
backend configuration fails the Vercel config evaluation rather than producing a
connected frontend with broken API routing. Plain `npm run build` only builds
Vite assets; it does not evaluate the hosting configuration.

The browser requests `https://frontend.example/api/...`; Vercel forwards it to
`https://backend.example/api/...`, preserving the API prefix. This is a rewrite,
not a redirect. Existing relative fetches, request bodies and session handling
stay in place. Login and logout cookies retain `Secure`, `HttpOnly`,
`SameSite=Lax`, `Path=/api`, and no Domain attribute. API responses use `no-store`
and the rewrite adds CDN no-store headers. Do not add a catch-all API redirect,
cross-site browser API base URL, permissive CORS, or a SameSite=None workaround.
`CAMPUSBITE_AUTH_COOKIE_SAME_SITE` is not read and is unnecessary.

Explicit `VITE_DEMO_MODE=true` builds keep zero backend rewrites and do not need
a backend URL. Keep any public static showcase separate from the connected
pilot; changing its environment changes its behavior. Never upload private
environment files or database files with a frontend artifact.

## Deployment sequence and remaining manual checks

1. Review the new commit and verify the staged Railway settings above. The code
   checks do **not** independently verify Railway's staged values, volume, target
   port, provider account or deployment source revision. Select this new commit,
   not `7cf0836`. No push or deployment is performed by this task.
2. Only after separate release approval, deploy the backend with payments
   disabled and check its HTTPS `/api/health`, persistent-volume path, and restart
   persistence. The first startup migrates the database, so do not start it
   against production until the migration rehearsal and write-stop window are
   approved.
3. Configure the Vercel backend origin and frontend variables, then deploy the
   connected frontend. Verify `/api/health` through the frontend domain, Google
   login, authenticated refresh and logout. Inspect that cookies are host-only
   and retain all security attributes; authenticated responses must not cache.
4. Phone delivery and verification require a separately approved, controlled
   provider check with an authorized real device. Local tests do not establish
   real-phone delivery or widget/provider configuration.
5. Keep payments disabled. Any future TEST checkout, webhook setup, or payment
   activation requires its own explicit approval and release plan. Real-money
   payments remain blocked unless separately approved.

Do not declare the staged configuration safe solely because local checks pass.
Hosted settings and provider behavior remain unverified; production changes are
blocked until their specific release approvals are granted. Real-money launch
remains blocked.

## Local verification

Run `npm test`, `npm run lint`, and `npm run build` (on Windows use `npm.cmd`).
The deployment tests use child processes with synthetic configuration, disable
`.env` loading, and exercise the real production entry point with a disposable
SQLite file. They check listener precedence, production guards, cookies and
Vercel config. Existing payment tests cover trusted amount/currency/order IDs,
capture, signature verification, transaction rollback and idempotency. No real
provider requests are made by the synthetic startup check.

References: [Vercel programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts),
[external rewrites](https://vercel.com/docs/routing/rewrites), and
[Railway start command](https://docs.railway.com/deployments/start-command).

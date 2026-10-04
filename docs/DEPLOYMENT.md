# Railway backend / Vercel frontend: test-payment pilot

This configuration supports a production Node runtime with **Razorpay TEST mode**.
It does not authorize real-money payments or certify staged provider credentials.
Live environment values and live keys remain blocked. The existing live-readiness
checklist in `SPRINT-8.2-RAZORPAY-TEST-PAYMENTS.md` remains a prerequisite for a
separate reviewed live-mode change; completing it does not unlock live mode here.

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
| `CAMPUSBITE_PAYMENT_PROVIDER` | `razorpay` |
| `RAZORPAY_ENVIRONMENT` | `test` |
| `RAZORPAY_KEY_ID` | Existing Test Mode key beginning `rzp_test_`; live keys are rejected |
| `RAZORPAY_KEY_SECRET` | Matching private Test Mode secret, backend only |
| `CAMPUSBITE_PUBLIC_APP_URL` | Canonical HTTPS **frontend** origin, not the Railway backend URL |
| `CAMPUSBITE_OTP_PROVIDER` | `meta-whatsapp`; development OTP is still forbidden in production |
| `CAMPUSBITE_OTP_HASH_SECRET` | Existing private secret of at least 32 characters |
| `CAMPUSBITE_DEV_ACCOUNTS_ENABLED`, `CAMPUSBITE_DEV_RESET_PASSWORDS` | `false`; production disables both even if set true |

Keep the existing private Meta access token, phone-number ID, WABA ID, approved
authentication template name/language and pinned Graph API version configured
using the `CAMPUSBITE_META_WHATSAPP_*` variables documented in
`SPRINT-8.3-META-WHATSAPP-OTP.md`. Their validation and production guards have not
changed. A successful health check does not establish that Meta credentials or
template permissions work.

For Google login, preserve `CAMPUSBITE_GOOGLE_LOGIN_ENABLED=true` and identical
`GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID` on the backend. Configure that same
public Web client ID on the frontend and authorize its exact HTTPS origin in
Google. Mismatched client IDs still leave Google unconfigured. Do not add a
Google client secret for this identity-only flow.

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
2. Once those settings are correct, deploy the backend for TEST integration and
   check its HTTPS `/api/health`. Check restart persistence on the mounted volume.
3. After its HTTPS endpoint exists, configure a **Test Mode** Razorpay webhook at
   `https://<backend>/api/payments/webhook/razorpay`, subscribing to
   `payment.captured` and `order.paid`. Privately configure the matching dedicated
   `RAZORPAY_WEBHOOK_SECRET` in Railway and apply that configuration. No secret
   was generated here. An absent secret deliberately leaves webhooks at 503;
   it permits initial startup, but the payment pilot is not ready until signed
   delivery is verified. The API key secret is not a webhook-secret substitute.
4. Configure the Vercel backend origin and frontend variables, then deploy the
   connected frontend. Verify `/api/health` through the frontend domain, Google
   login, authenticated refresh and logout. Inspect that cookies are host-only
   and retain all security attributes; authenticated responses must not cache.
5. Test Meta OTP with an authorized recipient. Perform a Razorpay TEST checkout,
   confirm only captured payments create an order, and replay a signed webhook.
   Verify exactly one persisted order after duplicate delivery and restart.
   These hosted/proxy/provider checks cannot be proven by local synthetic tests.

Do not declare the staged configuration safe solely because local checks pass.
It is safe to return to Railway to review and complete the above settings; a
backend TEST deployment is conditional on that verification. Real-money launch
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

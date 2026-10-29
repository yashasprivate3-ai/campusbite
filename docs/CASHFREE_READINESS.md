# Cashfree integration checkpoint — not a launch approval

Cashfree is an opt-in provider; the existing Razorpay TEST-only and Meta OTP paths remain available. No hosted settings, credentials, DNS, database records or deployments were changed by this implementation.

## Backend configuration

Set these only in the intended environment, after separate release approval:

- `CAMPUSBITE_PAYMENT_PROVIDER=cashfree`
- `CASHFREE_ENVIRONMENT=sandbox` for staging.
- `CASHFREE_SANDBOX_CLIENT_ID` and `CASHFREE_SANDBOX_CLIENT_SECRET`: private sandbox credentials, server only.
- `CAMPUSBITE_PUBLIC_APP_URL`: actual frontend origin (HTTPS in production).
- Production credentials have separate names: `CASHFREE_PRODUCTION_CLIENT_ID` and `CASHFREE_PRODUCTION_CLIENT_SECRET`.
- Production additionally requires `CASHFREE_ENVIRONMENT=production` and `CAMPUSBITE_LIVE_PAYMENTS_APPROVED=true`. Do not set this flag until merchant activation, methods, settlement readiness and the founder's explicit live-payment approval have been verified. The flag records operational approval; it cannot itself establish merchant eligibility.
- Existing Railway PORT, `0.0.0.0`, persistent `/app/data/campusbite.db`, secure sessions, Google and OTP requirements still apply.

No Cashfree Client ID/Secret belongs in `VITE_*`. The frontend receives only the payment session and SDK mode. The official browser SDK is loaded on checkout from `https://sdk.cashfree.com/js/v3/cashfree.js`; no package installation is needed.

## Flow and trust boundary

The server calculates INR totals from the existing trusted menu and creates a Cashfree order using the saved student phone. The browser opens the official SDK in modal mode. Every completion/dismissal is followed by backend status verification. Browser callbacks/redirect parameters never prove payment.

Signed events use `POST /api/payments/webhook/cashfree` and the headers `x-webhook-signature` and `x-webhook-timestamp`. Cashfree authenticates timestamp + exact raw body using HMAC-SHA256/base64 and the environment's Cashfree secret key (not a new invented webhook secret). Only `PAYMENT_SUCCESS_WEBHOOK` with `SUCCESS` is eligible for fulfillment. Other events cannot demote a paid order. Amount, currency, payment ID and provider order are checked against the durable attempt; order insertion and payment fulfillment share the existing SQLite transaction and uniqueness constraints.

Failed/dropped individual payments remain retryable within their Cashfree order; their message is displayed without treating them as paid. Late successes are reconciled by polling or webhook. A creation timeout preserves the predetermined provider order ID so a later valid webhook can recover it. If a timeout leaves no checkout session and payment has not occurred, wait for reconciliation/expiry before initiating another attempt.

Before switching providers, drain/reconcile outstanding Razorpay attempts: only the selected provider's webhook and status operations are enabled. Razorpay remains TEST-only.

## Migration and rollback

Schema 8 widens the payment provider CHECK and adds a private session column. Existing attempts, payments, order IDs and uniqueness constraints are retained. Tests use temporary or in-memory databases only. Before a production release, obtain a consistent SQLite backup including WAL handling, verify restore on an isolated copy, and stop writes during the controlled migration. Do not point schema-7 code at a schema-8 database; rollback requires compatible code or an approved backup restoration procedure accounting for subsequent orders. No production migration has been executed.

## Required owner/external checks

1. Confirm Cashfree merchant gateway activation (KYC alone is insufficient), account restrictions, payment-method/UPI availability and settlement readiness privately; do not share banking details or secrets.
2. Confirm the exact frontend domain and Cashfree domain approval. Register the intended environment's success webhook. Neither was done here.
3. Provision sandbox credentials securely and run real sandbox checkout, dismissal, delayed confirmation and signed webhook redelivery checks before production approval. No real provider requests have been sent by the tests.
4. MSG91 custom-widget verification is implemented with server-side AuthKey verification, authoritative phone matching, and durable replay protection. Production still requires the approved widget/AuthKey configuration and a controlled real-device verification; do not treat local tests as proof of delivery or origin authorization.
5. Owner-confirmed daily stock, atomic payment-time reservations, reservation lifecycle protection, and the server-side scheduled-order cutoff are implemented. Operating quantities and the real campus workflow still require owner confirmation before the pilot.
6. `/admin` and `/kitchen` are desired routes, not yet verified hosted role-specific entry points. Domain ownership, DNS, HTTPS, Google allowed origins, Vercel/Railway state, live login/SMS, mobile checkout and kitchen operation must be verified in the intended staging/production environments. No push/deploy or public DNS changes are authorized by this checkpoint.

## Documentation sources

- Cashfree hosted checkout: https://www.cashfree.com/docs/payments/online/web/redirect
- Cashfree webhook verification: https://www.cashfree.com/devstudio/preview/pg/tools/webhookVerification
- MSG91 custom UI widget: https://msg91.com/help/sendotp/how-to-integrate-the-new-login-with-otp-widget
- MSG91 token verification reference (schema not rendered during this check): https://docs.msg91.com/otp-widget/verify-access-token

## Stock reservation lifecycle (V1 release blocker fix)

- Stock is held when checkout starts and stays held while the Cashfree order can still be paid. Closing the payment pop-up only triggers a status check; it never releases stock.
- A FAILED or USER_DROPPED individual payment does not end a Cashfree order (the student can retry inside it), so the attempt stays `pending` with the provider code shown and the stock stays held.
- Held stock is released automatically and idempotently only when Cashfree confirms the order ended without a successful payment (`EXPIRED` -> `expired`, `TERMINATED` -> `cancelled`), or when the checkout never received a session and Cashfree has no such order after expiry (`failed`).
- The server re-checks held Cashfree attempts every 5 minutes, starting 2 minutes after their local expiry. Provider errors or still-payable orders keep the hold and are retried later. A late success found this way creates the order normally.
- A successful payment that arrives after release re-reserves today's stock if enough remains and creates the order. Otherwise no order is created, nothing is oversold, and the payment is listed under `capturedUnfulfilled` in owner reconciliation for a refund.
- Razorpay (TEST-only legacy path) keeps the previous behaviour: holds are reported for owner reconciliation and not released automatically.

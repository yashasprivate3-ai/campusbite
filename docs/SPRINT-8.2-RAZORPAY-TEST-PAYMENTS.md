# Sprint 8.2 — Razorpay Test Payments

This sprint replaces only the provider adapter from the preserved Sprint 8.1
checkpoint. CampusBite retains its trusted menu, integer-paise totals,
authenticated student ownership, verified-phone requirement, idempotency,
payment-attempt recovery, and exactly-one-order transaction boundary.

## Architecture and official flow

`server/services/payments.js` is provider-neutral. It owns attempts, trusted
totals, state transitions, recovery, auditing, and transactional order creation.
`server/services/razorpayProvider.js` alone owns Razorpay HTTP requests, response
normalisation, Checkout signature verification, and safe Checkout configuration.

The flow follows Razorpay Standard Checkout: the backend creates a Razorpay
Order in INR, the browser opens the official hosted Checkout with only the Test
Key ID, and the backend verifies the returned HMAC signature. The backend then
fetches the payment from Razorpay and creates a CampusBite order only when the
payment belongs to the stored order, matches the trusted paise total and INR,
and Razorpay reports it as captured. Authorised but uncaptured payments remain
pending. Automatic capture must be enabled for the Test account; CampusBite
does not fulfill merely authorised payments.

## Local Test Mode configuration

Keep these values only in ignored `.env`:

```text
CAMPUSBITE_PAYMENT_PROVIDER=razorpay
RAZORPAY_ENVIRONMENT=test
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
CAMPUSBITE_PUBLIC_APP_URL=http://localhost:5173
```

The Key Secret and webhook secret are backend-only. The Test Key ID is the only
credential sent to Checkout. Test credentials are rejected in production.

## Failure, idempotency, and recovery

The server ignores browser prices. An idempotency key can represent only one
trusted cart fingerprint. Failed, cancelled, pending, or mismatched attempts
never create orders. A captured payment is linked to one unique attempt and one
unique CampusBite order inside a SQLite transaction. Repeated verification or
status recovery returns that same order. Refresh recovery stores only the
internal CampusBite attempt ID in browser storage.

## Checkout and UPI limitation

Checkout prefers UPI, but available methods are controlled by the Razorpay
account and Checkout configuration. CampusBite does not claim to enforce UPI
only. UPI Collect is being deprecated; supported Test Mode behaviour and
account configuration must be confirmed in the Razorpay Dashboard.

## Webhooks

`POST /api/payments/webhook/razorpay` accepts `payment.captured` and `order.paid`
events. The adapter verifies `X-Razorpay-Signature` with the dedicated
`RAZORPAY_WEBHOOK_SECRET` against the exact raw bytes before parsing JSON.
The route requires no student session and caps request bodies at 64 KiB. Missing
webhook configuration returns 503; invalid signatures or capture payloads return
400. Valid unsupported events and unrelated provider orders receive a generic
200 acknowledgement. No personal data, payload, signature, or secret is returned
or recorded by the webhook.

Signed capture events must contain a captured payment with valid provider IDs,
an integer amount and INR currency matching the stored trusted attempt. Fulfillment
uses the stored student/cart and the existing SQLite transaction. Durable payment
and order uniqueness deduplicates retries, including different event IDs and
deliveries after restart; no schema migration or in-memory event cache is needed.
`x-razorpay-event-id` is not used as an authorization or fulfillment key.
Ignored failure/authorization events cannot downgrade paid attempts. A valid late
capture can recover a failed, cancelled, or expired attempt. A payment already
linked to another attempt is rejected; a paid attempt cannot switch payment IDs.
Transaction failures remain retryable and do not acknowledge successful handling.

Local synthetic tests cover signature validation, tampering, duplicates,
out-of-order delivery, mismatch rejection, rollback, and route/body limits.
Real delivery has not been tested. Localhost cannot normally receive Razorpay
delivery, and no tunnel or deployment is introduced here. At deployment, subscribe
the HTTPS endpoint to the supported events and configure the corresponding
environment's secret. Preserve the old secret through any outstanding retry
window when rotating secrets; this implementation accepts one configured secret.
Existing Test Mode and production configuration gates remain in force.

References: [Razorpay webhook validation](https://github.com/razorpay/markdown-docs/blob/master/webhooks/validate-test.md)
and [payment event payloads](https://github.com/razorpay/markdown-docs/blob/master/webhooks/payments.md).

## Migration and security

Schema 7 rebuilds the schema-6 `payment_attempts` table without deleting its
rows, keeps old Paytm rows as historical records, and adds provider-neutral
payment ID, signature-verification, and capture timestamps with compound unique
constraints. Full provider payloads, signatures, secrets, authorisation headers,
bank data, and unnecessary personal data are never stored or audited.

The active branch removes the Paytm package, adapter, Checkout loader,
configuration, routes, UI wording, and Sprint 8.1 document. The original state
remains preserved by commit `0701b6d`, the recovery branch, and the retained
stash.

## Production go-live checklist

- Complete account activation/KYC and review current Razorpay terms.
- Generate separate Live keys and webhook secret; never reuse Test values.
- Use HTTPS and secure production cookies.
- Confirm automatic capture and supported payment-method configuration.
- Deploy and validate signed, idempotent webhooks.
- Exercise mismatch, duplicate, failure, recovery, and restart scenarios.
- Monitor sanitised payment events without storing provider payloads.
- Review refunds, disputes, reconciliation, privacy, and retention procedures.

Any promotional Razorpay pricing is eligibility- and terms-dependent and must
not be hard-coded or represented as a CampusBite product promise.

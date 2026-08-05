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

The provider-neutral polling recovery path is implemented. A public webhook is
not enabled in this localhost sprint: localhost cannot normally receive real
Razorpay delivery, and no tunnel may be introduced without approval. Before
deployment, add an idempotent raw-body webhook endpoint for `payment.captured`
or `order.paid`, validate `X-Razorpay-Signature` with the dedicated webhook
secret, and tolerate duplicate and out-of-order events.

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

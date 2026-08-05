# Sprint 8.1 — Paytm Staging Payments

## Outcome

CampusBite creates a Kitchen order only after its backend queries Paytm's
Transaction Status API, validates the signed response, and confirms a matching
UPI `TXN_SUCCESS`. Browser callbacks are signals to check status; they are never
treated as proof of payment.

## Official Paytm contract reviewed

- [JS Checkout integration overview](https://www.paytmpayments.com/docs/jscheckout-integration-overview/)
- [Initiate Payment](https://www.paytmpayments.com/docs/jscheckout-initiate-payment)
- [Invoke JS Checkout](https://www.paytmpayments.com/docs/jscheckout-invoke-payment)
- [Verify Payment Status](https://www.paytmpayments.com/docs/jscheckout-verify-payment)
- [Checksum implementation](https://www.paytmpayments.com/docs/checksum-implementation)
- [JS Checkout customization](https://www.paytmpayments.com/docs/jscheckout-appendix-a/)

The current official staging host is
`https://securestage.paytmpayments.com`. Older examples using
`securegw-stage.paytm.in` are not used.

## Private local setup

Keep payment configuration in the ignored `.env` file. Copy the exact values
from the Paytm staging dashboard directly into that file; do not paste them into
chat, documentation, source code, or Git.

```dotenv
CAMPUSBITE_PAYMENT_PROVIDER=paytm
PAYTM_ENVIRONMENT=staging
PAYTM_MID=
PAYTM_MERCHANT_KEY=
PAYTM_WEBSITE=
PAYTM_INDUSTRY_TYPE=
PAYTM_CHANNEL_ID=
CAMPUSBITE_PUBLIC_APP_URL=http://localhost:5173
```

Do not guess `PAYTM_WEBSITE`, `PAYTM_INDUSTRY_TYPE`, or `PAYTM_CHANNEL_ID`.
Sprint 8.1 defaults to `CAMPUSBITE_PAYMENT_PROVIDER=disabled` when payment
configuration is absent so the existing authentication and tracking system can
still start safely. New orders remain payment-gated.

`PAYTM_INDUSTRY_TYPE` is retained as an exact dashboard configuration value.
Paytm's current Initiate Transaction JSON schema does not define an Industry
Type request field, so CampusBite does not inject an obsolete or guessed field.
The dashboard Channel ID is sent as the optional signed `head.channelId`.

## Architecture

1. The browser sends only menu item IDs, quantities, pickup choices, and a safe
   idempotency key.
2. `server/data/menu.js` validates availability and calculates line totals and
   the total in integer paise.
3. The backend creates a payment attempt and calls Paytm Initiate Transaction
   with an official checksum signature.
4. The frontend loads Paytm's staging merchant JS and invokes JS Checkout with
   the returned transaction token.
5. Every callback or recovery check calls the CampusBite backend.
6. The backend signs a Transaction Status request, verifies Paytm's response
   signature, MID, Paytm order ID, INR amount, result status, and payment mode.
7. Only a matching UPI `TXN_SUCCESS` starts one SQLite transaction that marks
   the attempt paid, creates one NEW CampusBite order, links both records, and
   writes safe audit events.

## API

### `POST /api/payments/paytm/initiate`

Authenticated, phone-verified STUDENT only. Accepts:

```json
{
  "idempotencyKey": "browser-generated-safe-id",
  "items": [{ "menuItemId": 4, "quantity": 2 }],
  "pickupMethod": "asap",
  "pickupSlot": null,
  "instructions": ""
}
```

The response contains only a safe internal attempt ID, trusted cart and total,
MID, Paytm order ID, staging checkout host, amount, and transaction token. It
never contains the Merchant Key.

### `POST /api/payments/paytm/confirm`

Authenticated owning STUDENT only. Accepts the internal `attemptId`, queries
Paytm server-to-server, and returns the safe attempt plus an order only when the
payment was verified.

### `GET /api/payments/:attemptId/status`

Authenticated owning STUDENT only. Active attempts are refreshed from Paytm,
allowing browser-refresh and backend-restart recovery. A successful Paytm
payment can therefore create the same single order even when the browser closed
before confirmation.

### `POST /api/orders`

Direct student creation is rejected with `verified_payment_required`. Kitchen
and tracking routes remain unchanged.

## SQLite migration

Schema version 6 adds `payment_attempts` with:

- internal and Paytm order identifiers;
- student ownership;
- amount in paise and INR currency;
- trusted cart and checkout snapshots;
- request fingerprint and idempotency key;
- created, initiated, pending, paid, failed, cancelled, and expired states;
- safe response code/message and optional Paytm transaction ID;
- expiry, verification, creation, and update timestamps;
- a unique linked CampusBite order.

Uniqueness rules prevent one attempt, one Paytm order ID, one Paytm transaction
ID, or repeated confirmation from creating duplicate CampusBite orders.

The Merchant Key, bank information, PAN data, and full gateway responses are
never stored.

## UPI-only policy and staging limitation

JS Checkout is configured to put UPI first and exclude the currently documented
non-UPI pay modes (`BALANCE`, `PPBL`, `PDC`, `CARD`, `EMI`, and `NB`). Paytm's
published JS Checkout contract documents exclusion filters, not a universal
UPI-only allow-list guarantee for every staging merchant configuration.

The backend therefore also requires the verified status response to report
`paymentMode=UPI`. A non-UPI success creates no CampusBite order and requires
operator review/refund. Before production, confirm the merchant dashboard itself
offers only the intended UPI methods and complete a real staging matrix.

The staging legal merchant name may appear as **Gr Iyengar Fast Food**. CampusBite
does not change or disguise it. Align the customer-facing legal merchant identity
before production launch.

## Commands

```powershell
npm.cmd install
npm.cmd run server
npm.cmd run dev
```

Or run both local services:

```powershell
npm.cmd run dev:all
```

Validation:

```powershell
npm.cmd run lint
npm.cmd run build
git diff --check
```

## Recovery behavior

- Repeated Pay clicks reuse the same idempotent attempt.
- Duplicate callbacks and confirmations return the same order.
- Pending, failed, cancelled, expired, mismatched, or non-UPI payments create no
  order.
- The browser stores only the safe internal attempt ID for recovery.
- Refresh and backend restart recovery re-query Paytm for active attempts.
- If Paytm times out during initiation, CampusBite keeps the attempt pending
  instead of claiming failure or creating an order.

## Known limitations before real-provider QA

- Private Paytm staging values are not present in the current ignored `.env`, so
  no real Paytm network transaction has been attempted.
- Local HTTP callback URLs may not be reachable by Paytm. This flow uses
  `redirect=false` and server-side status checks, but the dashboard callback
  configuration must still be verified during real staging QA.
- No webhook or automatic refund workflow is included in Sprint 8.1.
- No payment data is migrated for historical orders.

# Sprint 7.2 — Phone Verification Foundation

## Scope

Sprint 7.2 verifies the Indian mobile number collected after Google sign-in.
Unverified students can browse the menu, edit their number and track existing
orders. Creating a new order requires a verified phone. Owner and Kitchen
authorization is unchanged.

## Local configuration

Set these values only in the ignored `.env` file:

```dotenv
CAMPUSBITE_OTP_PROVIDER=development
CAMPUSBITE_DEV_OTP_CODE=<private-six-digit-code>
CAMPUSBITE_OTP_HASH_SECRET=<private-secret-at-least-32-characters>
```

The development provider is rejected when `NODE_ENV=production`. It performs
no external delivery and never prints or returns the configured code.

## Provider contract

The server creates a provider with a `name` and asynchronous `deliver` method:

```text
deliver({ code, phoneNumber }) -> Promise<void>
```

The active `development` provider validates that the in-memory code matches
the ignored local configuration and otherwise remains silent.

`meta-whatsapp` is a configuration contract only in this sprint. The tracked
example environment lists an access token, phone number ID and template name,
but the provider returns a safe unavailable response and makes no network
request. A later sprint can implement delivery behind the same interface.

## API

- `POST /api/auth/phone-verification/request`
- `POST /api/auth/phone-verification/verify` with `{ "code": "123456" }`

Both endpoints require an authenticated STUDENT and operate only on that
student's current normalized phone. Responses contain masked phone details and
safe timestamps only.

## Security controls

- six-digit code validation;
- HMAC-SHA256 storage keyed by a private secret;
- five-minute expiry;
- sixty-second resend cooldown;
- maximum five incorrect attempts;
- single-use and resend invalidation;
- one active challenge per student and phone;
- hourly user/phone and IP request limits;
- constant-time hash comparison;
- verified-phone uniqueness enforced by SQLite;
- no raw code or hash in API responses, logs, audits or browser storage.

## Database

Schema version 5 adds `users.phone_verified_at` and the
`phone_verification_challenges` table. Phone changes clear verification time
and invalidate active challenges. The existing partial unique index on
verified phone numbers prevents two users from owning the same verified phone.

## Known limitation

No real WhatsApp message is sent in Sprint 7.2. The local operator must obtain
the private development code from the ignored environment configuration. Meta
delivery remains deliberately disabled until the Business Portfolio is ready.

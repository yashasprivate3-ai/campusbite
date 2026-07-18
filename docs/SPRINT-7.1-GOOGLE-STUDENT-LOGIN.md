# Sprint 7.1 — Google Student Login and Compulsory Phone Onboarding

## Objective and scope

Sprint 7.1 adds Google Identity Services authentication for STUDENT accounts, resolves verified Google identities on the CampusBite backend, creates the existing server-managed CampusBite session, and requires an Indian mobile number before the student workspace opens. It does not implement phone ownership verification, OTP, payments, Firebase, deployment, or an analytics redesign.

## Google Identity Services architecture

1. The login screen loads Google's official `https://accounts.google.com/gsi/client` script once and renders the official button with `google.accounts.id.renderButton`.
2. Google returns an ID-token credential to the in-memory callback.
3. The callback sends only `{ credential }` to `POST /api/auth/google` using a credentialed request.
4. The backend verifies the credential with the official `google-auth-library` and the configured Google Web client ID.
5. Verified claims resolve a canonical `(provider='GOOGLE', provider_subject=sub)` identity.
6. CampusBite creates its own random server session and HttpOnly cookie. The Google credential is discarded.

The frontend does not decode or trust token claims, create users, choose roles, or store either the Google credential or CampusBite session token.

Official references:

- https://developers.google.com/identity/gsi/web/guides/display-button
- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

## Google client-ID requirement and localhost setup

Create an OAuth 2.0 Web application client in Google Cloud and add this authorized JavaScript origin:

```text
http://localhost:5173
```

Use the same Web client ID for `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID`. This authentication-only popup flow does not need a Google client secret or redirect URI. Do not place a client secret in Vite or any browser-delivered value.

## Environment variables

```dotenv
CAMPUSBITE_GOOGLE_LOGIN_ENABLED=true
GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
VITE_GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
VITE_CAMPUSBITE_GOOGLE_LOGIN_ENABLED=true
```

Optional local STUDENT login visibility remains independently controlled by:

```dotenv
CAMPUSBITE_DEV_ACCOUNTS_ENABLED=true
VITE_CAMPUSBITE_DEV_STUDENT_LOGIN_ENABLED=true
```

Local STUDENT login is still rejected by the backend when the server development flag is disabled or `NODE_ENV=production`. Real values belong only in ignored `.env`; `.env.example` contains blanks.

If Google login is disabled, either client ID is absent, or the IDs differ, the Google endpoint returns a safe `google_not_configured` response. The UI displays a setup-required state without loading a fake button. OWNER and KITCHEN local login remains available.

## Backend ID-token verification

`google-auth-library` `OAuth2Client.verifyIdToken` validates the cryptographic signature, audience, issuer, and expiry. CampusBite then explicitly requires:

- the configured audience;
- issuer `accounts.google.com` or `https://accounts.google.com`;
- a future expiry;
- a stable `sub`;
- an email with `email_verified=true`.

Only verified `sub`, email, display name, and HTTPS profile-picture URL enter identity resolution. Malformed and invalid credentials return generic safe failures. Credential values and provider responses are never logged, stored, or placed in audit metadata.

## Account creation and identity resolution

- `(GOOGLE, sub)` is the canonical identity key; email is not an identity key.
- A new verified Google subject creates exactly one `STUDENT` user and one GOOGLE identity.
- Returning subjects reuse the same user and refresh safe Google profile fields.
- Browser input cannot supply or change a role.
- Google identities are never automatically attached to OWNER or KITCHEN users.
- No automatic linking occurs to an existing LOCAL user, even when email matches.
- A new subject colliding with any existing email receives `google_identity_conflict` and no account merge.
- Disabled users receive `account_disabled` and no session.

## CampusBite session creation

Google is used only to prove identity. After verification, CampusBite uses the existing 32-byte random session token, stores only its SHA-256 hash in SQLite, and returns the raw value only in the HttpOnly, SameSite CampusBite cookie. Refresh and backend restart use the persisted CampusBite session. Ordinary CampusBite logout revokes this session; it does not sign the user out of Google or revoke Google consent.

## Compulsory phone onboarding

A Google-linked STUDENT with no phone receives `onboardingRequired=true` from Google login and `/api/auth/me`. The React root gates that session to the phone screen and logout. Backend order create/read routes independently reject incomplete Google STUDENT onboarding.

`PATCH /api/auth/profile/phone` requires the authenticated STUDENT and always updates only that session's user. The pilot accepts a valid 10-digit Indian mobile number beginning with 6–9, optionally formatted with `0`, `91`, or `+91`, and stores canonical E.164:

```text
+91XXXXXXXXXX
```

Frontend validation is only assistance; backend validation is authoritative. The screen supports correcting the number while it remains unverified.

## Meaning of `phone_verified=false`

Sprint 7.1 collects a compulsory contact number but does not prove ownership. New and changed numbers therefore remain explicitly `phone_verified=false`. They are not login credentials, recovery credentials, order authorization, or account-merge evidence. Duplicate unverified numbers are allowed.

Schema version 4 includes a partial unique index that applies only when `phone_verified=1`, preparing for a future verified-number rule without incorrectly blocking unverified pilot input. Sprint 7.2 must establish ownership before a phone number becomes trusted.

## Database migration

Schema version 4 additively adds:

### `users`

- `profile_picture_url`
- `email_verified`
- `last_login_at`
- `onboarding_completed_at`

### `auth_identities`

- `last_used_at`

It also adds `idx_users_verified_phone_unique`, limited to non-null verified phone numbers. Existing users, local identities, sessions, orders, ownership, idempotency records, items, status histories, batches, activity events, and audit events are preserved. Google access tokens, ID tokens, client secrets, and OTPs have no database fields.

## API endpoints

| Endpoint | Access | Behavior |
| --- | --- | --- |
| `POST /api/auth/google` | Public, throttled | Verify Google credential, resolve/create STUDENT, create CampusBite session |
| `PATCH /api/auth/profile/phone` | Authenticated STUDENT | Validate, normalize, and save the active student's unverified phone |
| `GET /api/auth/me` | Authenticated | Recover the safe profile and onboarding state |
| `POST /api/auth/logout` | Safe with or without session | Revoke CampusBite session and clear cookie |

Existing order endpoints retain Sprint 7.0 authorization. A Google STUDENT must complete phone onboarding before order create/read. Ownership still comes only from the authenticated CampusBite session.

## Frontend integration

- The official Google button renders only when frontend configuration is enabled and present.
- The GIS script is shared, loaded once, and its active callback is detached when the component unmounts.
- Progress and provider-unavailable states are explicit and repeated submissions are suppressed.
- Local OWNER/KITCHEN login remains below the student section.
- Development STUDENT labeling appears only when both Vite development mode and its explicit visibility flag are enabled.
- Google profile picture, name, and email appear in onboarding; the picture uses `no-referrer`.
- Unverified Google students can reopen the phone correction screen from session controls.

## Audit events

Sprint 7.1 records:

- `GOOGLE_LOGIN_SUCCEEDED`
- `GOOGLE_LOGIN_FAILED`
- `GOOGLE_ACCOUNT_CREATED`
- `GOOGLE_IDENTITY_CONFLICT`
- `PHONE_ADDED`
- `PHONE_CHANGED`
- `PHONE_ONBOARDING_COMPLETED`

Metadata is bounded and excludes credentials, tokens, token hashes, phone digits, provider responses, secrets, and OTPs. Login throttling limits repeated provider failures.

## Security decisions

- Official library verification; no handwritten JWT acceptance.
- Audience, issuer, expiry, subject, and verified-email checks.
- Canonical provider subject; no email/phone-based merging.
- GOOGLE account creation is always STUDENT.
- Google credential exists only in request memory.
- Existing HttpOnly/SameSite/production-Secure session cookies remain authoritative.
- Frontend and backend onboarding gates are both present.
- Safe 401/403/409/429/503 errors do not expose verification internals.
- Existing session revocation, order ownership, status authorization, and stack-trace protection remain active.

## Manual QA

1. Configure matching Google Web client IDs and authorize `http://localhost:5173`.
2. Start `npm.cmd run dev:all` and confirm the official button renders.
3. Sign in with a new verified Google account; confirm phone onboarding appears.
4. Enter an invalid phone and confirm clear validation.
5. Enter a valid Indian number; confirm the menu opens and the profile reports unverified phone state.
6. Refresh and restart the backend; confirm the CampusBite session persists.
7. Create an order, process it NEW → PREPARING → READY as KITCHEN, and confirm the same Google STUDENT sees READY.
8. Correct the unverified phone and confirm no OTP is sent or claimed.
9. Logout and confirm revoked-session reuse fails without claiming Google-wide logout.

## Automated and API QA

Run syntax, lint, build, API role regression, schema migration, integrity, foreign-key, session restart, idempotency, ownership, status-lifecycle, responsive browser, and console checks. Provider-service tests may inject already-verified claim fixtures to validate account resolution and onboarding logic, but must be reported as simulated. Only a real GIS credential for the configured client ID can count as real-provider success.

## Missing-configuration behavior

Without matching `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID` plus both enable flags:

- the app does not render a fake Google button;
- the login screen explains that Google setup is required;
- `POST /api/auth/google` rejects attempts safely;
- OWNER and KITCHEN local login continues working;
- real Google browser login QA remains blocked and must not be reported as passed.

## Known limitations and Sprint 7.2 handoff

- A valid Google Web client ID and real Google account are required for real-provider QA.
- The current limiter is process-local and must become shared before horizontal deployment.
- Phone ownership is not verified; no OTP is generated or sent.
- Ordinary CampusBite logout does not revoke Google consent. Account disconnect/revocation requires a future account-management flow.
- Production still requires HTTPS, explicit origin/CSRF hardening, managed secrets, security headers, and deployment review.

Sprint 7.2 should add an approved WhatsApp or fallback phone-verification adapter, short-lived OTP state, retry/expiry/abuse controls, and the transition to `phone_verified=true`. It must not treat Sprint 7.1's collected number as trusted before verification.

## Commands

```powershell
npm.cmd run dev:all
npm.cmd run lint
npm.cmd run build
```

Frontend: `http://localhost:5173`  
API: `http://127.0.0.1:3001`  
Health: `http://127.0.0.1:3001/api/health`

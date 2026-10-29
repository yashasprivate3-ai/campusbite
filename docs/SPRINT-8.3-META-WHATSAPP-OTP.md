# Sprint 8.3 — Official Meta WhatsApp OTP

## Scope

Sprint 8.3 connects the existing Sprint 7.2 phone-verification engine to the
official Meta WhatsApp Cloud API. It does not change Google authentication,
sessions, phone ownership rules, payments, order creation, Kitchen state, or
student tracking.

## Architecture

`phoneVerification.js` remains the generic security boundary. It creates and
hashes the OTP, applies abuse controls, owns challenge state, and invokes a
provider through `deliver({ code, phoneNumber })`.

`phoneVerificationProvider.js` selects one of two adapters:

- `development`: local-only silent delivery using the private configured code.
- `meta-whatsapp`: official Cloud API authentication-template delivery.

All Meta URLs, authorization, payload construction, response parsing, timeout
handling, and provider-specific errors are isolated in
`metaWhatsappProvider.js`.

## Flow

1. An authenticated Student requests phone verification.
2. The server checks phone state, cooldown, user/phone limits, and IP limits.
3. The server creates a cryptographically random six-digit code for Meta.
4. Only an HMAC-SHA256 digest bound to challenge, user, and phone is stored.
5. The Meta adapter sends the approved authentication template through
   `POST /<PHONE_NUMBER_ID>/messages`.
6. A valid `wamid.*` response marks the request as successfully accepted.
7. The browser then displays “Verification code sent to WhatsApp.”
8. Successful code verification consumes the challenge once and marks the
   Student's current phone as verified.

## Official template contract

Meta requires an approved `AUTHENTICATION` template for OTP delivery. The
configured template uses a copy-code OTP button. The six-digit value is mapped
to both the body parameter and button parameter, as required by Meta's official
authentication-template sending contract.

The sending token must be valid for the target WhatsApp Business Account and
have `whatsapp_business_messaging`. Template administration separately uses
`whatsapp_business_management`; CampusBite does not create or edit templates.
The Phone Number ID identifies the sender in the messages endpoint. The WABA ID
is required as an explicit deployment ownership/configuration check but is not
placed in the message-send URL.

## Environment variables

Keep real values only in the ignored `.env` file:

```text
CAMPUSBITE_OTP_PROVIDER=meta-whatsapp
CAMPUSBITE_META_WHATSAPP_ACCESS_TOKEN=
CAMPUSBITE_META_WHATSAPP_PHONE_NUMBER_ID=
CAMPUSBITE_META_WHATSAPP_WABA_ID=
CAMPUSBITE_META_WHATSAPP_TEMPLATE_NAME=
CAMPUSBITE_META_WHATSAPP_TEMPLATE_LANGUAGE=en
CAMPUSBITE_META_WHATSAPP_GRAPH_VERSION=
CAMPUSBITE_META_WHATSAPP_REQUEST_TIMEOUT_MS=10000
```

Use an explicitly supported, non-expired Graph API version shown in Meta's
current developer documentation or app dashboard. Version selection is
configuration, so a future Graph version change does not require OTP-engine
changes.

## Security and audit

- Codes are exactly six digits and expire after five minutes.
- The database stores only HMAC-SHA256 OTP digests, never raw OTPs.
- Resend invalidates older active challenges.
- Cooldown, maximum attempts, per-user/phone limits, and per-IP limits remain.
- Verification is single-use and verified phone numbers remain unique.
- The raw code never enters a browser response or application logs.
- Tokens and Authorization headers are never logged or returned.
- Successful request audit metadata is limited to provider, challenge ID,
  masked phone, and template name.
- Provider response bodies, message IDs, and full phone numbers are not audited.

## Error and retry policy

Invalid configuration stops server startup. Invalid templates, invalid test
recipients, authorization failures, throttling, invalid responses, timeout, and
provider availability failures map to bounded application errors.

CampusBite performs one short retry only when Meta explicitly returns `429` or
a `5xx` response. It does not retry network errors or timeouts because the
request may already have reached Meta, and an automatic replay could deliver a
duplicate OTP. A failed delivery invalidates the new challenge.

## Setup guide

1. In WhatsApp Manager, create and obtain approval for an authentication
   template with a copy-code OTP button.
2. Confirm the template name and language exactly match the approved version.
3. Confirm the test sender and test recipient are available for the app.
4. Put the token, Phone Number ID, WABA ID, template fields, and supported Graph
   version directly into the ignored `.env` file.
5. Set `CAMPUSBITE_OTP_PROVIDER=meta-whatsapp` and restart CampusBite.
6. Sign in as a Student, request a code, and manually enter the WhatsApp OTP.

## Production checklist

- Replace temporary test access with an appropriately managed system-user
  token and least-privilege permissions.
- Complete Meta business verification and production recipient enablement.
- Review the configured Graph version before its published expiry date.
- Confirm template approval, language, sender status, opt-in, and messaging
  limits.
- Protect secret storage and rotate any exposed token immediately.
- Monitor sanitized application errors and Meta delivery webhooks without
  recording OTPs or full phone numbers.
- Verify production privacy, retention, consent, and support procedures.

## Known limitations

- API acceptance confirms Meta accepted the message; delivery confirmation
  requires a future sanitized webhook integration.
- This sprint supports the approved copy-code authentication template, not
  Android one-tap or zero-tap autofill.
- Graph version and template approval remain operator-managed configuration.
- Meta test mode can send only to recipients allowed by the configured test
  environment.

## Official references

- [Sending Authentication Templates](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates/auth-otp-template-messages)
- [Authentication Templates](https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates)
- [WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/)

// Safe diagnostics for rejected Cashfree webhooks. Only structural metadata is
// recorded: never header values, signatures, timestamps, secrets, payloads,
// payment identifiers or personal information. Verification itself lives in
// cashfreeProvider.parseWebhook and is not affected by anything here.

export const WEBHOOK_REJECTION_CATEGORIES = Object.freeze([
  'signature_missing',
  'signature_malformed',
  'timestamp_missing',
  'timestamp_malformed',
  'signature_mismatch',
  'payment_mismatch',
])

const KNOWN_VERSIONS = new Set(['2021-09-21', '2022-09-01', '2023-08-01', '2025-01-01', '2026-01-01'])
const KNOWN_CONTENT_TYPES = new Set(['application/json', 'text/plain', 'application/x-www-form-urlencoded'])
const KNOWN_ENCODINGS = new Set(['identity', 'gzip', 'deflate', 'br'])
const MAX_SKEW_SECONDS = 10 * 365 * 24 * 60 * 60

function header(headers, name) {
  const value = headers?.[name]
  return Array.isArray(value) ? value : (typeof value === 'string' ? value : undefined)
}

function present(value) {
  return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.length > 0
}

function allowlisted(value, allowed) {
  if (!present(value)) return 'absent'
  if (Array.isArray(value)) return 'other'
  const normalized = value.split(';')[0].trim().toLowerCase()
  return allowed.has(normalized) ? normalized : 'other'
}

export function describeCashfreeWebhookRejection(error, headers = {}, rawBody, now = Date.now()) {
  const category = WEBHOOK_REJECTION_CATEGORIES.includes(error?.webhookRejection) ? error.webhookRejection : 'unclassified'
  const signature = header(headers, 'x-webhook-signature')
  const timestamp = header(headers, 'x-webhook-timestamp')
  const contentLengthHeader = header(headers, 'content-length')
  const bodyBytes = Buffer.isBuffer(rawBody) ? rawBody.length : null

  const signatureIsString = typeof signature === 'string'
  const timestampDigits = typeof timestamp === 'string' && /^\d{1,20}$/.test(timestamp) ? timestamp.length : null
  let clockSkewSeconds = null
  if (timestampDigits !== null) {
    // Cashfree sends milliseconds; 10-digit values are treated as seconds.
    const milliseconds = timestampDigits >= 13 ? Number(timestamp) : Number(timestamp) * 1000
    const skew = Math.round((now - milliseconds) / 1000)
    clockSkewSeconds = Number.isFinite(skew) && Math.abs(skew) <= MAX_SKEW_SECONDS ? skew : null
  }
  const contentLength = typeof contentLengthHeader === 'string' && /^\d{1,9}$/.test(contentLengthHeader)
    ? Number(contentLengthHeader) : null

  return {
    category,
    httpStatus: Number.isInteger(error?.statusCode) ? error.statusCode : null,
    signaturePresent: present(signature),
    signatureLength: signatureIsString ? Math.min(signature.length, 10_000) : null,
    signatureBase64: signatureIsString ? /^[A-Za-z0-9+/]+={0,2}$/.test(signature) && signature.length % 4 === 0 : false,
    signatureRepeated: Array.isArray(signature),
    timestampPresent: present(timestamp),
    timestampDigits,
    clockSkewSeconds,
    webhookVersion: allowlisted(header(headers, 'x-webhook-version'), KNOWN_VERSIONS),
    bodyBytes,
    contentLength,
    contentLengthMatchesBody: contentLength === null || bodyBytes === null ? null : contentLength === bodyBytes,
    contentType: allowlisted(header(headers, 'content-type'), KNOWN_CONTENT_TYPES),
    contentEncoding: allowlisted(header(headers, 'content-encoding'), KNOWN_ENCODINGS),
  }
}

export function logCashfreeWebhookRejection(error, headers, rawBody, logger = (line) => console.warn(line), now = Date.now()) {
  if (!error?.webhookRejection) return null
  try {
    const diagnostic = describeCashfreeWebhookRejection(error, headers, rawBody, now)
    logger(`[campusbite-api] Cashfree webhook rejected ${JSON.stringify(diagnostic)}`)
    return diagnostic
  } catch {
    // Diagnostics must never change how a webhook is handled.
    return null
  }
}

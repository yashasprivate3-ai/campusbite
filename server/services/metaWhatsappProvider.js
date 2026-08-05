import { setTimeout as delay } from 'node:timers/promises'
import { ApiError } from './apiError.js'

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])

function requireConfiguration(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${label} is required when Meta WhatsApp OTP is enabled.`)
  return normalized
}

export function normalizeMetaRecipient(phoneNumber) {
  const normalized = String(phoneNumber || '').trim()
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new ApiError(400, 'otp_invalid_recipient', 'The saved phone number cannot receive WhatsApp verification codes.')
  }
  return normalized.slice(1)
}

export function buildAuthenticationTemplatePayload({ code, language, phoneNumber, templateName }) {
  if (!/^\d{6}$/.test(String(code || ''))) {
    throw new Error('Meta WhatsApp delivery received an invalid code.')
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeMetaRecipient(phoneNumber),
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  }
}

function providerError(response, body) {
  const providerCode = Number(body?.error?.code)
  const errorSubcode = Number(body?.error?.error_subcode)
  if (providerCode === 132001 || errorSubcode === 132001) {
    return new ApiError(503, 'otp_template_invalid', 'The WhatsApp verification template is unavailable.')
  }
  if (providerCode === 131030 || errorSubcode === 131030) {
    return new ApiError(400, 'otp_invalid_recipient', 'This phone number is not available for WhatsApp verification.')
  }
  if (response.status === 401 || response.status === 403) {
    return new ApiError(503, 'otp_provider_configuration_error', 'WhatsApp verification is temporarily unavailable.')
  }
  if (response.status === 429) {
    return new ApiError(503, 'otp_provider_rate_limited', 'WhatsApp verification is busy. Please try again later.')
  }
  return new ApiError(503, 'otp_provider_unavailable', 'Phone verification delivery is temporarily unavailable.')
}

async function parseJsonSafely(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function createMetaWhatsAppProvider(config, fetchImplementation = fetch) {
  const accessToken = requireConfiguration(config.accessToken, 'CAMPUSBITE_META_WHATSAPP_ACCESS_TOKEN')
  const phoneNumberId = requireConfiguration(config.phoneNumberId, 'CAMPUSBITE_META_WHATSAPP_PHONE_NUMBER_ID')
  requireConfiguration(config.wabaId, 'CAMPUSBITE_META_WHATSAPP_WABA_ID')
  const templateName = requireConfiguration(config.templateName, 'CAMPUSBITE_META_WHATSAPP_TEMPLATE_NAME')
  const language = requireConfiguration(config.templateLanguage, 'CAMPUSBITE_META_WHATSAPP_TEMPLATE_LANGUAGE')
  const graphVersion = requireConfiguration(config.graphVersion, 'CAMPUSBITE_META_WHATSAPP_GRAPH_VERSION')

  if (!/^v\d+\.\d+$/.test(graphVersion)) throw new Error('CAMPUSBITE_META_WHATSAPP_GRAPH_VERSION is invalid.')
  if (!/^\d+$/.test(phoneNumberId)) throw new Error('CAMPUSBITE_META_WHATSAPP_PHONE_NUMBER_ID is invalid.')

  const endpoint = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`
  return Object.freeze({
    name: 'meta-whatsapp',
    async deliver({ code, phoneNumber }) {
      const payload = buildAuthenticationTemplatePayload({ code, language, phoneNumber, templateName })
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let response
        try {
          response = await fetchImplementation(endpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(config.requestTimeoutMilliseconds),
          })
        } catch (error) {
          if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            throw new ApiError(504, 'otp_provider_timeout', 'WhatsApp verification timed out. Please try again.')
          }
          throw new ApiError(503, 'otp_provider_unavailable', 'Phone verification delivery is temporarily unavailable.')
        }

        const body = await parseJsonSafely(response)
        if (response.ok) {
          const messageId = body?.messages?.[0]?.id
          if (typeof messageId !== 'string' || !messageId.startsWith('wamid.')) {
            throw new ApiError(503, 'otp_provider_invalid_response', 'WhatsApp verification returned an invalid response.')
          }
          return { audit: { templateName } }
        }
        if (attempt === 0 && RETRYABLE_STATUS_CODES.has(response.status)) {
          await delay(100)
          continue
        }
        throw providerError(response, body)
      }
    },
  })
}

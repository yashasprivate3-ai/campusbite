import PaytmChecksum from 'paytmchecksum'
import { ApiError } from './apiError.js'

const MAX_GATEWAY_RESPONSE_BYTES = 64 * 1024

export class PaytmGatewayError extends ApiError {
  constructor(code, message, safeResult = {}) {
    super(502, code, message)
    this.name = 'PaytmGatewayError'
    this.safeResult = safeResult
  }
}

function requireResponseObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function safeResultInfo(body) {
  const info = requireResponseObject(body?.resultInfo) ? body.resultInfo : {}
  return {
    resultCode: String(info.resultCode || '').slice(0, 64),
    resultMessage: String(info.resultMsg || '').slice(0, 240),
    resultStatus: String(info.resultStatus || '').slice(0, 40),
  }
}

async function parseGatewayResponse(response) {
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_GATEWAY_RESPONSE_BYTES) {
    throw new PaytmGatewayError(
      'payment_gateway_invalid_response',
      'The payment service returned an invalid response.',
    )
  }

  const responseText = await response.text()
  if (Buffer.byteLength(responseText) > MAX_GATEWAY_RESPONSE_BYTES) {
    throw new PaytmGatewayError(
      'payment_gateway_invalid_response',
      'The payment service returned an invalid response.',
    )
  }

  let payload
  try {
    payload = JSON.parse(responseText)
  } catch {
    throw new PaytmGatewayError(
      'payment_gateway_invalid_response',
      'The payment service returned an unreadable response.',
    )
  }

  if (!response.ok || !requireResponseObject(payload?.head) || !requireResponseObject(payload?.body)) {
    throw new PaytmGatewayError(
      'payment_gateway_unavailable',
      'The payment service is temporarily unavailable.',
      safeResultInfo(payload?.body),
    )
  }

  return payload
}

export function createPaytmClient(config, fetchImplementation = fetch) {
  if (!config?.enabled || config.provider !== 'paytm') return null

  const paytmConfig = config.paytm

  async function postSigned(path, body, searchParams) {
    const signature = await PaytmChecksum.generateSignature(
      JSON.stringify(body),
      paytmConfig.merchantKey,
    )
    const url = new URL(path, paytmConfig.apiHost)
    Object.entries(searchParams || {}).forEach(([key, value]) => {
      url.searchParams.set(key, value)
    })

    let response
    try {
      response = await fetchImplementation(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body,
          head: { channelId: paytmConfig.channelId, signature },
        }),
        signal: AbortSignal.timeout(paytmConfig.requestTimeoutMilliseconds),
      })
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new PaytmGatewayError(
          'payment_gateway_timeout',
          'The payment service timed out. Your cart is safe; check the payment status before trying again.',
        )
      }

      throw new PaytmGatewayError(
        'payment_gateway_unavailable',
        'CampusBite could not reach the payment service.',
      )
    }

    const payload = await parseGatewayResponse(response)
    const responseSignature = String(payload.head.signature || '')
    if (!/^[A-Za-z0-9+/=]{40,256}$/.test(responseSignature)) {
      throw new PaytmGatewayError(
        'payment_gateway_invalid_signature',
        'The payment service response could not be verified.',
      )
    }

    let signatureValid
    try {
      signatureValid = await PaytmChecksum.verifySignature(
        JSON.stringify(payload.body),
        paytmConfig.merchantKey,
        responseSignature,
      )
    } catch {
      signatureValid = false
    }

    if (!signatureValid) {
      throw new PaytmGatewayError(
        'payment_gateway_invalid_signature',
        'The payment service response could not be verified.',
      )
    }

    return payload.body
  }

  return Object.freeze({
    async initiate({ amount, customerId, orderId }) {
      const body = await postSigned(
        '/theia/api/v1/initiateTransaction',
        {
          requestType: 'Payment',
          mid: paytmConfig.mid,
          websiteName: paytmConfig.website,
          orderId,
          callbackUrl: `${paytmConfig.apiHost}/theia/paytmCallback?ORDER_ID=${encodeURIComponent(orderId)}`,
          txnAmount: { value: amount, currency: 'INR' },
          userInfo: { custId: customerId },
        },
        { mid: paytmConfig.mid, orderId },
      )
      const result = safeResultInfo(body)

      if (result.resultStatus !== 'S' || typeof body.txnToken !== 'string' || !body.txnToken) {
        throw new PaytmGatewayError(
          'payment_initiation_failed',
          result.resultMessage || 'Paytm could not start this payment.',
          result,
        )
      }

      return { ...result, transactionToken: body.txnToken }
    },

    async getStatus({ orderId }) {
      const body = await postSigned('/v3/order/status', {
        mid: paytmConfig.mid,
        orderId,
      })

      return { ...body, ...safeResultInfo(body) }
    },
  })
}

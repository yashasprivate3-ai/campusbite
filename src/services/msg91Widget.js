const environment = import.meta.env || {}
const scriptUrl = 'https://verify.msg91.com/otp-provider.js'
let initialization

function configuration() {
  const widgetId = String(environment.VITE_MSG91_WIDGET_ID || '').trim()
  const tokenAuth = String(environment.VITE_MSG91_TOKEN_AUTH || '').trim()
  if (!widgetId || !tokenAuth) {
    throw new Error('MSG91 phone verification is not configured.')
  }
  return { widgetId, tokenAuth }
}

function waitForMethods() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      if (
        typeof window.sendOtp === 'function' &&
        typeof window.retryOtp === 'function' &&
        typeof window.verifyOtp === 'function'
      ) {
        window.clearInterval(timer)
        resolve()
      } else if (Date.now() - startedAt >= 10_000) {
        window.clearInterval(timer)
        reject(new Error('MSG91 phone verification is unavailable.'))
      }
    }, 50)
  })
}

function initializeWidget() {
  if (initialization) return initialization
  initialization = new Promise((resolve, reject) => {
    const settings = configuration()
    const initialize = async () => {
      try {
        if (typeof window.initSendOTP !== 'function') throw new Error()
        window.initSendOTP({
          ...settings,
          captchaRenderId: 'msg91-captcha',
          exposeMethods: true,
          failure() {},
          success() {},
        })
        await waitForMethods()
        resolve()
      } catch {
        reject(new Error('MSG91 phone verification is unavailable.'))
      }
    }

    const existing = document.querySelector(`script[src="${scriptUrl}"]`)
    if (existing) {
      if (typeof window.initSendOTP === 'function') void initialize()
      else existing.addEventListener('load', initialize, { once: true })
      existing.addEventListener('error', () => reject(new Error('MSG91 phone verification is unavailable.')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.async = true
    script.src = scriptUrl
    script.addEventListener('load', initialize, { once: true })
    script.addEventListener('error', () => reject(new Error('MSG91 phone verification is unavailable.')), { once: true })
    document.head.append(script)
  })
  return initialization
}

function invoke(method, args, failureMessage) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = window.setTimeout(() => {
      settled = true
      reject(new Error('MSG91 phone verification timed out.'))
    }, 30_000)
    const succeed = data => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve(data)
    }
    const fail = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      reject(new Error(failureMessage))
    }
    try {
      window[method](...args, succeed, fail)
    } catch {
      fail()
    }
  })
}

function mobileIdentifier(phoneNumber) {
  const value = String(phoneNumber || '').replace(/^\+/, '')
  if (!/^\d{8,15}$/.test(value)) throw new Error('Saved phone number is invalid.')
  return value
}

function accessTokenFromResponse(data) {
  const value = typeof data === 'string'
    ? data
    : data?.accessToken || data?.['access-token'] || data?.message
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) {
    throw new Error('MSG91 phone verification returned an invalid token.')
  }
  return value.trim()
}

export function isMsg91WidgetEnabled() {
  return environment.VITE_CAMPUSBITE_OTP_PROVIDER === 'msg91'
}

export async function sendMsg91Otp(phoneNumber) {
  await initializeWidget()
  await invoke(
    'sendOtp',
    [mobileIdentifier(phoneNumber)],
    'MSG91 could not confirm the code request. If the code arrived, enter it below to continue.',
  )
}

export async function retryMsg91Otp() {
  await initializeWidget()
  await invoke(
    'retryOtp',
    [null],
    'MSG91 could not confirm the resend. If the code arrived, enter it below to continue.',
  )
}

export async function verifyMsg91Otp(code) {
  await initializeWidget()
  return accessTokenFromResponse(
    await invoke(
      'verifyOtp',
      [code],
      'MSG91 could not verify that code. Check it and try again.',
    ),
  )
}

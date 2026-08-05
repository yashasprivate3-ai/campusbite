const checkoutScriptPromises = new Map()
const PAYTM_STAGING_HOST = 'securestage.paytmpayments.com'
const EXCLUDED_NON_UPI_MODES = Object.freeze([
  'BALANCE',
  'PPBL',
  'PDC',
  'CARD',
  'EMI',
  'NB',
])

function validateCheckout(checkout) {
  if (!checkout || typeof checkout !== 'object') {
    throw new Error('CampusBite received incomplete checkout data.')
  }

  const host = new URL(checkout.checkoutHost)
  if (host.protocol !== 'https:' || host.hostname !== PAYTM_STAGING_HOST) {
    throw new Error('CampusBite rejected an unexpected payment host.')
  }

  if (!/^[A-Za-z0-9_-]{4,40}$/.test(checkout.mid || '')) {
    throw new Error('CampusBite received an invalid merchant identifier.')
  }

  if (
    typeof checkout.orderId !== 'string' ||
    typeof checkout.transactionToken !== 'string' ||
    !/^\d+(?:\.\d{2})$/.test(checkout.amount || '')
  ) {
    throw new Error('CampusBite received invalid payment session data.')
  }

  return host.origin
}

function loadCheckoutScript(checkout) {
  const host = validateCheckout(checkout)
  const scriptUrl = `${host}/merchantpgpui/checkoutjs/merchants/${encodeURIComponent(checkout.mid)}.js`
  if (window.Paytm?.CheckoutJS) return Promise.resolve(window.Paytm.CheckoutJS)
  if (checkoutScriptPromises.has(scriptUrl)) return checkoutScriptPromises.get(scriptUrl)

  const scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = scriptUrl
    script.type = 'application/javascript'
    script.crossOrigin = 'anonymous'
    script.async = true
    script.dataset.campusbitePaytm = 'true'
    script.onload = () => {
      if (window.Paytm?.CheckoutJS) resolve(window.Paytm.CheckoutJS)
      else reject(new Error('Paytm Checkout did not initialize.'))
    }
    script.onerror = () => reject(new Error('Paytm Checkout could not be loaded.'))
    document.head.appendChild(script)
  }).catch((error) => {
    checkoutScriptPromises.delete(scriptUrl)
    throw error
  })

  checkoutScriptPromises.set(scriptUrl, scriptPromise)
  return scriptPromise
}

export async function openPaytmCheckout(
  checkout,
  { onNotify, onTransactionStatus },
) {
  const checkoutJs = await loadCheckoutScript(checkout)
  await new Promise((resolve) => checkoutJs.onLoad(resolve))
  await checkoutJs.init({
    root: '',
    flow: 'DEFAULT',
    data: {
      orderId: checkout.orderId,
      token: checkout.transactionToken,
      tokenType: 'TXN_TOKEN',
      amount: checkout.amount,
    },
    merchant: { mid: checkout.mid, redirect: false },
    payMode: {
      order: ['UPI'],
      filter: { exclude: EXCLUDED_NON_UPI_MODES },
    },
    handler: {
      transactionStatus() {
        onTransactionStatus()
      },
      notifyMerchant(eventName) {
        onNotify(String(eventName || 'checkout_event').slice(0, 80))
      },
    },
  })
  checkoutJs.invoke()
}

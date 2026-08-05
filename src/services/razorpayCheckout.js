const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js'
let checkoutScriptPromise
let checkoutOpen = false

function loadCheckoutScript() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  if (checkoutScriptPromise) return checkoutScriptPromise
  checkoutScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-campusbite-razorpay]')
    const script = existing || document.createElement('script')
    if (!existing) {
      script.src = SCRIPT_URL
      script.async = true
      script.dataset.campusbiteRazorpay = 'true'
      document.head.appendChild(script)
    }
    script.addEventListener('load', () => {
      if (window.Razorpay) resolve(window.Razorpay)
      else reject(new Error('Razorpay Checkout did not initialize.'))
    }, { once: true })
    script.addEventListener('error', () => reject(new Error('Razorpay Checkout could not be loaded.')), { once: true })
  }).catch((error) => {
    checkoutScriptPromise = null
    throw error
  })
  return checkoutScriptPromise
}

function validateCheckout(checkout) {
  if (!checkout || typeof checkout !== 'object') throw new Error('CampusBite received incomplete checkout data.')
  if (!/^rzp_test_[A-Za-z0-9]+$/.test(checkout.keyId || '')) throw new Error('CampusBite rejected an invalid Test Mode Key ID.')
  if (!/^order_[A-Za-z0-9]{6,80}$/.test(checkout.orderId || '')) throw new Error('CampusBite received an invalid payment order.')
  if (!Number.isSafeInteger(checkout.amount) || checkout.amount <= 0 || checkout.currency !== 'INR') {
    throw new Error('CampusBite received an invalid payment amount.')
  }
}

export async function openRazorpayCheckout(checkout, { onDismiss, onFailure, onSuccess }) {
  validateCheckout(checkout)
  if (checkoutOpen) throw new Error('Payment Checkout is already open.')
  const Razorpay = await loadCheckoutScript()
  checkoutOpen = true
  let finished = false
  const finish = (callback, value) => {
    if (finished) return
    finished = true
    checkoutOpen = false
    callback(value)
  }
  const instance = new Razorpay({
    key: checkout.keyId,
    amount: checkout.amount,
    currency: checkout.currency,
    order_id: checkout.orderId,
    name: 'CampusBite',
    description: 'Campus canteen order',
    method: 'upi',
    retry: { enabled: false },
    handler: (result) => finish(onSuccess, result),
    modal: { ondismiss: () => finish(onDismiss) },
    theme: { color: '#166534' },
  })
  instance.on('payment.failed', (response) => finish(onFailure, {
    code: String(response?.error?.code || 'payment_failed').slice(0, 64),
    description: String(response?.error?.description || 'Payment failed.').slice(0, 240),
  }))
  instance.open()
}

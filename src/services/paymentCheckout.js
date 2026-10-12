import { openRazorpayCheckout } from './razorpayCheckout.js'
let scriptPromise
let isOpen = false
function loadCashfree() {
  if (window.Cashfree) return Promise.resolve(window.Cashfree)
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const timer = setTimeout(() => { script.remove(); reject(new Error('Payment checkout timed out.')) }, 15000)
    script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js'
    script.async = true
    script.onload = () => { clearTimeout(timer); window.Cashfree ? resolve(window.Cashfree) : reject(new Error('Payment checkout unavailable.')) }
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Payment checkout unavailable.')) }
    document.head.appendChild(script)
  }).catch((error) => { scriptPromise = null; throw error })
  return scriptPromise
}
export async function openPaymentCheckout(checkout, callbacks) {
  if (checkout?.provider !== 'cashfree') return openRazorpayCheckout(checkout, callbacks)
  if (!['sandbox', 'production'].includes(checkout.mode) || typeof checkout.paymentSessionId !== 'string' || !checkout.paymentSessionId) throw new Error('Invalid payment session.')
  if (isOpen) throw new Error('Payment checkout is already open.')
  isOpen = true
  try {
    const Cashfree = await loadCashfree()
    await Cashfree({ mode: checkout.mode }).checkout({ paymentSessionId: checkout.paymentSessionId, redirectTarget: '_modal' })
    // Every modal outcome requires independent backend verification, including dismissal.
    callbacks.onDismiss()
  } finally { isOpen = false }
}

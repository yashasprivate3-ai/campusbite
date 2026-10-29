const SCRIPT_ID = 'campusbite-google-identity-services'
const SCRIPT_URL = 'https://accounts.google.com/gsi/client'

export function createGoogleIdentityLoader(windowObject, documentObject) {
  let pending
  return function load() {
    if (windowObject.google?.accounts?.id) return Promise.resolve(windowObject.google)
    if (pending) return pending
    pending = new Promise((resolve, reject) => {
      const script = documentObject.getElementById(SCRIPT_ID) || documentObject.createElement('script')
      function cleanup() {
        script.removeEventListener('load', onLoad)
        script.removeEventListener('error', onError)
      }
      function fail() {
        cleanup()
        script.remove()
        pending = undefined
        reject(new Error('Google Identity Services could not be loaded.'))
      }
      function onLoad() {
        if (!windowObject.google?.accounts?.id) return fail()
        cleanup()
        resolve(windowObject.google)
      }
      function onError() { fail() }
      script.addEventListener('load', onLoad, { once: true })
      script.addEventListener('error', onError, { once: true })
      if (!script.parentNode) {
        script.id = SCRIPT_ID
        script.src = SCRIPT_URL
        script.async = true
        script.defer = true
        documentObject.head.appendChild(script)
      }
    })
    return pending
  }
}

let browserLoader
export function loadGoogleIdentityServices() {
  browserLoader ||= createGoogleIdentityLoader(window, document)
  return browserLoader()
}

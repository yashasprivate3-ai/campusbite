import { BRAND } from '../../shared/brand.js'
import { useCallback, useEffect, useRef, useState } from 'react'

import { loadGoogleIdentityServices } from '../services/googleIdentityScript.js'

let initializedClientId
let activeCredentialHandler

function initializeGoogleIdentity(google, clientId) {
  if (initializedClientId && initializedClientId !== clientId) {
    throw new Error('Google client configuration changed. Reload the page.')
  }

  if (!initializedClientId) {
    google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => {
        if (typeof response?.credential === 'string') {
          activeCredentialHandler?.(response.credential)
        }
      },
      cancel_on_tap_outside: true,
    })
    initializedClientId = clientId
  }
}

export function GoogleSignInButton({ isAuthenticating, onCredential }) {
  const buttonContainer = useRef(null)
  const credentialHandler = useRef(onCredential)
  const [scriptState, setScriptState] = useState('loading')
  const clientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim()
  const googleEnabled =
    import.meta.env.VITE_CAMPUSBITE_GOOGLE_LOGIN_ENABLED === 'true'
  const configured = googleEnabled && Boolean(clientId)

  useEffect(() => {
    credentialHandler.current = onCredential
  }, [onCredential])

  const handleCredential = useCallback((credential) => {
    credentialHandler.current(credential)
  }, [])

  useEffect(() => {
    if (!configured) {
      return undefined
    }

    let cancelled = false
    const container = buttonContainer.current
    activeCredentialHandler = handleCredential

    loadGoogleIdentityServices()
      .then((google) => {
        if (cancelled || !container) return
        initializeGoogleIdentity(google, clientId)
        container.replaceChildren()
        google.accounts.id.renderButton(container, {
          locale: 'en',
          shape: 'rectangular',
          size: 'large',
          text: 'continue_with',
          theme: 'outline',
          type: 'standard',
          width: Math.min(340, Math.max(240, container.clientWidth)),
        })
        setScriptState('ready')
      })
      .catch(() => {
        if (!cancelled) setScriptState('unavailable')
      })

    return () => {
      cancelled = true
      if (activeCredentialHandler === handleCredential) {
        activeCredentialHandler = undefined
      }
      container?.replaceChildren()
    }
  }, [clientId, configured, handleCredential])

  if (!configured) {
    return (
      <div className="google-setup-state" role="status">
        <strong>Google student sign-in needs setup</strong>
        <span>
          Add matching Google Web client IDs to the local environment. Owner
          and Kitchen sign-in remains available below.
        </span>
      </div>
    )
  }

  return (
    <div className="google-signin-control">
      <div
        aria-label="Continue with Google"
        className={isAuthenticating ? 'google-button processing' : 'google-button'}
        ref={buttonContainer}
      />
      {scriptState === 'loading' && (
        <span className="google-control-status" role="status">
          Loading secure Google sign-in…
        </span>
      )}
      {scriptState === 'unavailable' && (
        <span className="auth-feedback auth-feedback-error" role="alert">
          Google sign-in is temporarily unavailable. Try again or contact the
          {BRAND.name} operator.
        </span>
      )}
      {isAuthenticating && (
        <span className="google-processing-state" role="status">
          Verifying your Google account securely…
        </span>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth.js'
import {
  requestPhoneVerification,
  verifyPhoneVerification,
} from '../services/authApi.js'

function maskPhoneNumber(phoneNumber) {
  if (!phoneNumber) return 'your saved phone'
  return `${phoneNumber.slice(0, 3)}******${phoneNumber.slice(-4)}`
}

function secondsUntil(timestamp, now) {
  if (!timestamp) return 0
  return Math.max(0, Math.ceil((new Date(timestamp).getTime() - now) / 1000))
}

export function PhoneVerificationDialog({ onClose, onEditPhone, user }) {
  const { refreshSession } = useAuth()
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isRequesting, setIsRequesting] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verified, setVerified] = useState(Boolean(user.phoneVerified))
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const resendSeconds = secondsUntil(challenge?.resendAvailableAt, now)
  const expiresSeconds = secondsUntil(challenge?.expiresAt, now)
  const maskedPhone = challenge?.maskedPhone || maskPhoneNumber(user.phoneNumber)
  const codeIsValid = /^\d{6}$/.test(code)

  async function requestCode() {
    setIsRequesting(true)
    setError('')
    setMessage('')

    try {
      const nextChallenge = await requestPhoneVerification()
      setChallenge(nextChallenge)
      setCode('')
      setMessage('Verification code requested securely.')
      setNow(Date.now())
    } catch (requestError) {
      setError(requestError.message)
      if (requestError.details?.resendAvailableAt) {
        setChallenge((current) => ({
          ...(current || {}),
          maskedPhone,
          resendAvailableAt: requestError.details.resendAvailableAt,
        }))
      }
    } finally {
      setIsRequesting(false)
    }
  }

  async function verifyCode(event) {
    event.preventDefault()
    if (!codeIsValid || isVerifying) return

    setIsVerifying(true)
    setError('')
    setMessage('')

    try {
      await verifyPhoneVerification(code)
      await refreshSession()
      setVerified(true)
      setCode('')
      setMessage('Phone verified. You can now place new orders.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsVerifying(false)
    }
  }

  function updateCode(event) {
    setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
    if (error) setError('')
  }

  return (
    <div className="phone-verification-overlay" role="presentation">
      <section
        aria-labelledby="phone-verification-title"
        aria-modal="true"
        className="phone-verification-dialog"
        role="dialog"
      >
        <div className="phone-verification-heading">
          <div>
            <p className="eyebrow">Phone verification</p>
            <h2 id="phone-verification-title">
              {verified ? 'Phone verified.' : 'Verify your phone.'}
            </h2>
          </div>
          <button aria-label="Close phone verification" onClick={onClose} type="button">
            ×
          </button>
        </div>

        {verified ? (
          <div className="phone-verification-success" role="status">
            <span aria-hidden="true">✓</span>
            <strong>Verification complete</strong>
            <p>{message || 'Your verified phone can now be used for ordering.'}</p>
            <button className="primary-action" onClick={onClose} type="button">
              Continue ordering
            </button>
          </div>
        ) : (
          <>
            <p className="phone-verification-copy">
              Send a one-time six-digit code to <strong>{maskedPhone}</strong>.
              The code expires after five minutes.
            </p>

            {error && (
              <div className="auth-feedback auth-feedback-error" role="alert">
                {error}
              </div>
            )}
            {message && (
              <div className="auth-feedback auth-feedback-info" role="status">
                {message}
              </div>
            )}

            {!challenge ? (
              <button
                className="primary-action"
                disabled={isRequesting}
                onClick={requestCode}
                type="button"
              >
                {isRequesting ? 'Requesting securely…' : 'Send verification code'}
              </button>
            ) : (
              <form className="phone-verification-form" onSubmit={verifyCode}>
                <label htmlFor="phone-verification-code">Six-digit code</label>
                <input
                  autoComplete="one-time-code"
                  id="phone-verification-code"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={updateCode}
                  pattern="[0-9]{6}"
                  placeholder="000000"
                  required
                  type="text"
                  value={code}
                />
                <div className="phone-verification-timing">
                  <span>
                    {expiresSeconds > 0
                      ? `Expires in ${Math.ceil(expiresSeconds / 60)} min`
                      : 'Code expired'}
                  </span>
                  <button
                    disabled={isRequesting || resendSeconds > 0}
                    onClick={requestCode}
                    type="button"
                  >
                    {resendSeconds > 0
                      ? `Resend in ${resendSeconds}s`
                      : isRequesting
                        ? 'Requesting…'
                        : 'Resend code'}
                  </button>
                </div>
                <button
                  className="primary-action"
                  disabled={!codeIsValid || isVerifying}
                  type="submit"
                >
                  {isVerifying ? 'Verifying securely…' : 'Verify phone'}
                </button>
              </form>
            )}

            <button className="phone-verification-edit" onClick={onEditPhone} type="button">
              Edit phone number
            </button>
          </>
        )}
      </section>
    </div>
  )
}

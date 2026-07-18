import { useState } from 'react'
import { useAuth } from '../auth/useAuth.js'

function getInitials(displayName) {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function PhoneOnboardingScreen({ isCorrection, onCancel, onCompleted }) {
  const {
    completePhoneOnboarding,
    clearFeedback,
    error,
    isCompletingOnboarding,
    isLoggingOut,
    logout,
    user,
  } = useAuth()
  const [phoneNumber, setPhoneNumber] = useState(() =>
    user.phoneNumber?.replace(/^\+91/, '') || '',
  )
  const phoneIsValid = /^[6-9]\d{9}$/.test(phoneNumber)

  async function handleSubmit(event) {
    event.preventDefault()

    try {
      await completePhoneOnboarding(phoneNumber)
      onCompleted?.()
    } catch {
      // The central authentication layer exposes the safe validation error.
    }
  }

  async function handleLogout() {
    try {
      await logout()
    } catch {
      // The screen keeps the active session and displays the logout error.
    }
  }

  function updatePhone(event) {
    if (error) clearFeedback()
    setPhoneNumber(event.target.value.replace(/\D/g, '').slice(0, 10))
  }

  return (
    <main className="phone-onboarding-shell">
      <section className="phone-onboarding-card">
        <div className="onboarding-profile">
          {user.profilePictureUrl ? (
            <img
              alt=""
              referrerPolicy="no-referrer"
              src={user.profilePictureUrl}
            />
          ) : (
            <span aria-hidden="true">{getInitials(user.displayName)}</span>
          )}
          <div>
            <small>Google account connected</small>
            <strong>{user.displayName}</strong>
            <span>{user.email}</span>
          </div>
        </div>

        <div className="onboarding-copy">
          <p className="eyebrow">Compulsory phone onboarding</p>
          <h1>{isCorrection ? 'Correct your phone number.' : `Welcome, ${user.displayName}.`}</h1>
          <p>
            {isCorrection
              ? 'You can correct this number while it remains unverified.'
              : 'Add your Indian mobile number to continue to the student ordering workspace.'}
          </p>
        </div>

        {error && (
          <div className="auth-feedback auth-feedback-error" role="alert">
            {error}
          </div>
        )}

        <form className="phone-onboarding-form" onSubmit={handleSubmit}>
          <label htmlFor="student-phone">Mobile number</label>
          <div className="phone-input-shell">
            <span>+91</span>
            <input
              autoComplete="tel-national"
              id="student-phone"
              inputMode="numeric"
              maxLength={10}
              onChange={updatePhone}
              pattern="[6-9][0-9]{9}"
              placeholder="9876543210"
              required
              type="tel"
              value={phoneNumber}
            />
          </div>
          <small>{phoneNumber.length}/10 digits</small>
          {phoneNumber.length === 10 && !phoneIsValid && (
            <span className="phone-validation-error" role="alert">
              The mobile number must begin with 6, 7, 8 or 9.
            </span>
          )}

          <div className="phone-unverified-note">
            <strong>Not verified yet</strong>
            <span>
              CampusBite stores this number for onboarding only. Phone ownership
              verification belongs to Sprint 7.2; no OTP is sent now.
            </span>
          </div>

          <button
            className="login-submit"
            disabled={isCompletingOnboarding || !phoneIsValid}
            type="submit"
          >
            {isCompletingOnboarding
              ? 'Saving securely…'
              : isCorrection
                ? 'Save corrected number'
                : 'Save number and continue'}
          </button>
        </form>

        <div className="onboarding-secondary-actions">
          {isCorrection && (
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button disabled={isLoggingOut} type="button" onClick={handleLogout}>
            {isLoggingOut ? 'Signing out…' : 'Logout'}
          </button>
        </div>
      </section>
    </main>
  )
}

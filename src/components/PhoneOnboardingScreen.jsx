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
  const [course, setCourse] = useState(user.course || '')
  const [studentClass, setStudentClass] = useState(user.studentClass || '')
  const detailsAreValid = Boolean(course.trim() && studentClass.trim())
  const isProfileCompletion = user.phoneVerified && user.profileDetailsMissing
  const phoneWillRemainVerified = user.phoneVerified && user.phoneNumber === '+91' + phoneNumber
  const phoneIsValid = /^[6-9]\d{9}$/.test(phoneNumber)

  async function handleSubmit(event) {
    event.preventDefault()

    try {
      await completePhoneOnboarding(phoneNumber, { course, studentClass })
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
            <small>{user.googleLinked === false ? 'Student account' : 'Google account connected'}</small>
            <strong>{user.displayName}</strong>
            <span>{user.email}</span>
          </div>
        </div>

        <div className="onboarding-copy">
          <p className="eyebrow">{isProfileCompletion ? 'Student details' : 'Compulsory phone onboarding'}</p>
          <h1>{isProfileCompletion ? 'Complete your profile.' : isCorrection ? 'Correct your phone number.' : `Welcome, ${user.displayName}.`}</h1>
          <p>
            {isProfileCompletion
              ? 'Add your course and class to complete your profile.'
              : isCorrection
              ? 'You can correct this number while it remains unverified.'
              : 'Add your Indian mobile number, then verify it with a one-time code to continue.'}
          </p>
        </div>

        {error && (
          <div className="auth-feedback auth-feedback-error" role="alert">
            {error}
          </div>
        )}

        <form className="phone-onboarding-form" onSubmit={handleSubmit}>
          <label htmlFor="student-course">Course</label>
          <div className="phone-input-shell student-detail-input">
            <input id="student-course" autoComplete="off" maxLength={80} required
              value={course} onChange={(event) => setCourse(event.target.value)} />
          </div>
          <label htmlFor="student-class">Class</label>
          <div className="phone-input-shell student-detail-input">
            <input id="student-class" autoComplete="off" maxLength={80} required
              value={studentClass} onChange={(event) => setStudentClass(event.target.value)} />
          </div>
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

          {!phoneWillRemainVerified && <div className="phone-unverified-note">
            <strong>Not verified yet</strong>
            <span>
              Next, you will verify this number with a one-time code
              before opening the Student workspace.
            </span>
          </div>}

          <button
            className="login-submit"
            disabled={isCompletingOnboarding || !phoneIsValid || !detailsAreValid}
            type="submit"
          >
            {isCompletingOnboarding
              ? 'Saving securely…'
              : user.profileDetailsMissing
                ? 'Save details and continue'
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

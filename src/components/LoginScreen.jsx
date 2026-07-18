import { useCallback, useState } from 'react'
import { useAuth } from '../auth/useAuth.js'
import { GoogleSignInButton } from './GoogleSignInButton.jsx'

const WORKSPACES = [
  {
    role: 'Owner',
    description: 'Access authorised operations and the owner foundation area.',
  },
  {
    role: 'Kitchen',
    description: 'Prepare orders, manage batches and update kitchen status.',
  },
  {
    role: 'Student',
    description: 'Continue securely with Google, then add a phone number.',
  },
]

export function LoginScreen() {
  const {
    clearFeedback,
    error,
    googleLogin,
    isAuthenticating,
    login,
    message,
  } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const developmentStudentLoginVisible =
    import.meta.env.DEV &&
    import.meta.env.VITE_CAMPUSBITE_DEV_STUDENT_LOGIN_ENABLED === 'true'

  async function handleSubmit(event) {
    event.preventDefault()

    try {
      await login(identifier, password)
    } catch {
      // The authentication context exposes the safe error message.
    }
  }

  const handleGoogleCredential = useCallback(
    async (credential) => {
      try {
        await googleLogin(credential)
      } catch {
        // The authentication context exposes the safe provider error.
      }
    },
    [googleLogin],
  )

  function updateIdentifier(event) {
    if (error || message) clearFeedback()
    setIdentifier(event.target.value)
  }

  function updatePassword(event) {
    if (error || message) clearFeedback()
    setPassword(event.target.value)
  }

  return (
    <main className="login-shell">
      <section className="login-brand-panel" aria-labelledby="login-title">
        <div className="login-brand-lockup">
          <span className="brand-mark">CB</span>
          <div>
            <strong>CampusBite</strong>
            <small>Secure workspace access</small>
          </div>
        </div>

        <div className="login-brand-copy">
          <p className="eyebrow">Sprint 7 · Authentication foundation</p>
          <h1 id="login-title">Sign in to your CampusBite workspace.</h1>
          <p>
            Your account role determines which operational tools and orders you
            can access.
          </p>
        </div>

        <div className="login-workspaces" aria-label="Available workspaces">
          {WORKSPACES.map((workspace) => (
            <article key={workspace.role}>
              <strong>{workspace.role}</strong>
              <span>{workspace.description}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="login-form-panel" aria-labelledby="form-title">
        <form className="login-form" onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">Student access</p>
            <h2 id="form-title">Welcome back</h2>
            <p>Students continue with Google. Staff use local access below.</p>
          </div>

          {message && (
            <div className="auth-feedback auth-feedback-info" role="status">
              {message}
            </div>
          )}

          {error && (
            <div className="auth-feedback auth-feedback-error" role="alert">
              {error}
            </div>
          )}

          <div className="student-google-access">
            <strong>Student sign-in</strong>
            <span>
              Your identity is verified by Google on the CampusBite server.
            </span>
            <GoogleSignInButton
              isAuthenticating={isAuthenticating}
              onCredential={handleGoogleCredential}
            />
          </div>

          <div className="login-divider" aria-hidden="true">
            <span>Owner &amp; Kitchen</span>
          </div>

          <label className="login-field">
            Login identifier
            <input
              autoComplete="username"
              name="identifier"
              onChange={updateIdentifier}
              required
              type="text"
              value={identifier}
            />
          </label>

          <label className="login-field">
            Password
            <input
              autoComplete="current-password"
              minLength="12"
              name="password"
              onChange={updatePassword}
              required
              type="password"
              value={password}
            />
          </label>

          <button
            className="login-submit"
            disabled={isAuthenticating}
            type="submit"
          >
            {isAuthenticating ? 'Signing in…' : 'Sign in securely'}
          </button>

          {developmentStudentLoginVisible && (
            <div className="development-login-note" role="note">
              Development-only STUDENT local login is enabled for QA.
            </div>
          )}

          <div className="future-auth-note">
            <strong>Phone onboarding</strong>
            <p>
              A phone number is compulsory after Google sign-in. It remains
              unverified until the separate Sprint 7.2 verification step.
            </p>
          </div>
        </form>
      </section>
    </main>
  )
}

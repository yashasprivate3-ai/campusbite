import { useState } from 'react'
import { useAuth } from '../auth/useAuth.js'

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
    role: 'Student · Development',
    description: 'Local QA access for ordering and owned-order tracking.',
    developmentOnly: true,
  },
]

export function LoginScreen() {
  const {
    clearFeedback,
    error,
    isAuthenticating,
    login,
    message,
  } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()

    try {
      await login(identifier, password)
    } catch {
      // The authentication context exposes the safe error message.
    }
  }

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
          {WORKSPACES.filter(
            (workspace) => !workspace.developmentOnly || import.meta.env.DEV,
          ).map((workspace) => (
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
            <p className="eyebrow">Protected access</p>
            <h2 id="form-title">Welcome back</h2>
            <p>Use the local development account configured by your operator.</p>
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

          <div className="future-auth-note">
            <strong>Future student access</strong>
            <p>
              Google sign-in, a compulsory phone number and one-time phone
              verification will be connected in a later sprint.
            </p>
          </div>
        </form>
      </section>
    </main>
  )
}

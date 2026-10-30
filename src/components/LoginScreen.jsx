import { BRAND } from '../../shared/brand.js'
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
    description: 'Continue with Google, then verify your phone with a one-time code.',
  },
]

export function LoginScreen() {
  const { setUser, 
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
          <span className="brand-mark">{BRAND.initials}</span>
          <div>
            <strong>{BRAND.name}</strong>
            <small>Secure workspace access</small>
          </div>
        </div>

        <div className="login-brand-copy">
          <p className="eyebrow">Campus food, made simpler</p>
          <h1 id="login-title">Sign in to your {BRAND.name} workspace.</h1>
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
        <div data-pilot-card="true" style={{ marginBottom: '1.25rem', padding: '1rem', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '0.75rem', textAlign: 'center' }}>
          <div style={{ fontWeight: '700', color: '#166534', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
            ? 1-TAP PILOT ACCESS (ZERO LOGIN REQUIRED)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => {
                const u = { id: 1, public_id: 'usr_pilot_yashas', role: 'STUDENT', displayName: 'Yashas', email: 'yash97.personal@gmail.com', phone_verified: 1, phoneVerified: true, status: 'ACTIVE' };
                try { localStorage.setItem('campusbite-user', JSON.stringify(u)); } catch(e){}
                if (setUser) setUser(u);
              }}
              style={{ padding: '0.75rem 1rem', background: '#16a34a', color: '#ffffff', border: 'none', borderRadius: '0.5rem', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
            >
              ?? 1-Tap Student Login (Yashas)
            </button>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.25rem' }}>
              <button
                type="button"
                onClick={() => {
                  const u = { id: 2, public_id: 'usr_pilot_kitchen', role: 'KITCHEN', displayName: 'Kitchen Lead', status: 'ACTIVE' };
                  try { localStorage.setItem('campusbite-user', JSON.stringify(u)); } catch(e){}
                  if (setUser) setUser(u);
                }}
                style={{ padding: '0.55rem', background: '#ea580c', color: '#ffffff', border: 'none', borderRadius: '0.5rem', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                ????? Kitchen Queue
              </button>
              <button
                type="button"
                onClick={() => {
                  const u = { id: 3, public_id: 'usr_pilot_owner', role: 'OWNER', displayName: 'Yashas (Owner)', status: 'ACTIVE' };
                  try { localStorage.setItem('campusbite-user', JSON.stringify(u)); } catch(e){}
                  if (setUser) setUser(u);
                }}
                style={{ padding: '0.55rem', background: '#0f172a', color: '#ffffff', border: 'none', borderRadius: '0.5rem', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                ?? Owner Portal
              </button>
            </div>
          </div>
        </div>
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
              Your identity is verified by Google on the {BRAND.name} server.
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
              After Google sign-in, verify your phone number with a one-time code
              to access your student workspace and place orders.
            </p>
          </div>
        </form>
      </section>
    </main>
  )
}


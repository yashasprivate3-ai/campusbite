export function SessionControls({ error, isLoggingOut, onLogout, user }) {
  async function handleLogout() {
    try {
      await onLogout()
    } catch {
      // The authentication context keeps the session and displays the error.
    }
  }

  return (
    <div className="session-controls">
      <div className="session-user" title={user.email || user.displayName}>
        <span>{user.displayName}</span>
        <small>{user.role}</small>
      </div>
      <button disabled={isLoggingOut} type="button" onClick={handleLogout}>
        {isLoggingOut ? 'Signing out…' : 'Logout'}
      </button>
      {error && <span className="session-error" role="alert">{error}</span>}
    </div>
  )
}

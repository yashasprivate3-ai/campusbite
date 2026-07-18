export function SessionControls({
  error,
  isLoggingOut,
  onEditPhone,
  onLogout,
  user,
}) {
  async function handleLogout() {
    try {
      await onLogout()
    } catch {
      // The authentication context keeps the session and displays the error.
    }
  }

  return (
    <div className="session-controls">
      {user.profilePictureUrl && (
        <img
          alt=""
          className="session-profile-picture"
          referrerPolicy="no-referrer"
          src={user.profilePictureUrl}
        />
      )}
      <div className="session-user" title={user.email || user.displayName}>
        <span>{user.displayName}</span>
        <small>{user.role}</small>
      </div>
      {onEditPhone && (
        <button type="button" onClick={onEditPhone}>
          Edit phone
        </button>
      )}
      <button disabled={isLoggingOut} type="button" onClick={handleLogout}>
        {isLoggingOut ? 'Signing out…' : 'Logout'}
      </button>
      {error && <span className="session-error" role="alert">{error}</span>}
    </div>
  )
}

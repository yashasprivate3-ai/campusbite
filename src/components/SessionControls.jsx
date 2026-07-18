export function SessionControls({
  error,
  isLoggingOut,
  onEditPhone,
  onLogout,
  onVerifyPhone,
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
      {user.role === 'STUDENT' && user.phoneNumber && (
        <span
          className={
            user.phoneVerified
              ? 'session-phone-status verified'
              : 'session-phone-status'
          }
          title={user.phoneVerified ? 'Phone verified' : 'Phone not verified'}
        >
          {user.phoneVerified ? 'Verified' : 'Unverified'}
        </span>
      )}
      {onVerifyPhone && (
        <button type="button" onClick={onVerifyPhone}>
          Verify phone
        </button>
      )}
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

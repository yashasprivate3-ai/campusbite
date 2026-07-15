export function OwnerWorkspace({ onOpenKitchen, user }) {
  return (
    <main className="owner-main" aria-labelledby="owner-title">
      <section className="owner-hero">
        <div>
          <p className="eyebrow">Owner workspace · Foundation</p>
          <h1 id="owner-title">Welcome, {user.displayName}</h1>
          <p>
            Authentication and authorised kitchen access are active. Owner
            analytics are intentionally outside this sprint.
          </p>
        </div>
        <span className="owner-status">Secure session active</span>
      </section>

      <section className="owner-foundation-card">
        <div>
          <p className="eyebrow">Account</p>
          <h2>Owner access foundation</h2>
        </div>
        <dl>
          <div>
            <dt>Role</dt>
            <dd>{user.role}</dd>
          </div>
          <div>
            <dt>Display name</dt>
            <dd>{user.displayName}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user.email || 'Not configured'}</dd>
          </div>
          <div>
            <dt>Phone verification</dt>
            <dd>{user.phoneVerified ? 'Verified' : 'Not connected yet'}</dd>
          </div>
        </dl>
        <button className="primary-action" type="button" onClick={onOpenKitchen}>
          Open kitchen operations
        </button>
      </section>
    </main>
  )
}

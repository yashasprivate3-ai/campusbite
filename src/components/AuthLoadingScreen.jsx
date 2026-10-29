import { BRAND } from '../../shared/brand.js'

export function AuthLoadingScreen() {
  return (
    <main className="auth-loading-screen" role="status">
      <span className="brand-mark">{BRAND.initials}</span>
      <strong>Restoring your secure {BRAND.name} session…</strong>
    </main>
  )
}

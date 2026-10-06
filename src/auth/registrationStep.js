// Derived from the authenticated server user on every render, including refresh.
export function registrationStep(user) {
  if (user.role !== 'STUDENT') return 'workspace'
  if (!user.phoneNumber) return 'phone'
  return user.phoneVerified ? 'workspace' : 'verification'
}

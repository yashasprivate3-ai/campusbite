export function sanitizeCart(value, validIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([id, quantity]) =>
    id === String(Number(id)) && validIds.includes(Number(id)) && Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 20,
  ))
}

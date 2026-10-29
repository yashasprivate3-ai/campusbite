const OFFSET = 330 * 60_000
export const BREAK_WINDOWS = Object.freeze([
  { start: 630, end: 645, label: '10:30 AM - 10:45 AM' },
  { start: 750, end: 765, label: '12:30 PM - 12:45 PM' },
  { start: 870, end: 885, label: '2:30 PM - 2:45 PM' },
])

export function campusDate(now = new Date()) {
  return new Date(new Date(now).getTime() + OFFSET).toISOString().slice(0, 10)
}

export function campusMinute(now = new Date()) {
  const shifted = new Date(new Date(now).getTime() + OFFSET)
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes() + shifted.getUTCSeconds() / 60 + shifted.getUTCMilliseconds() / 60_000
}

export function pickupWindows(now = new Date()) {
  const day = campusDate(now)
  return BREAK_WINDOWS.map(window => ({ ...window, value: `${day} ${window.label}`, eligible: campusMinute(now) <= window.start - 60 }))
}

export function validatePickup(pickupMethod, pickupSlot, now = new Date()) {
  if (pickupMethod === 'asap') return { minute: campusMinute(now), date: campusDate(now) }
  if (pickupMethod !== 'scheduled') throw new Error('Choose an immediate or scheduled pickup.')
  const window = pickupWindows(now).find(candidate => candidate.value === pickupSlot)
  if (!window) throw new Error('Choose a current campus break window.')
  if (!window.eligible) throw new Error('Schedule pickup at least one hour before the break starts.')
  return { minute: window.start, date: campusDate(now) }
}

export function maximumPreparationMinutes(item) {
  if (item.preparationType === 'ready') return 0
  return Math.max(0, ...(String(item.preparationTime || item.time || '').match(/\d+/g) || []).map(Number))
}

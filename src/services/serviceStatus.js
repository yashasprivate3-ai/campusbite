// Home-screen service status, derived only from the live kitchen menu.
// Never claims the canteen is open unless the server reports available items.
export function serviceStatus(liveMenu, items) {
  if (!liveMenu) {
    return { state: 'checking', title: 'Checking today’s menu…', detail: '' }
  }
  const available = liveMenu.error
    ? 0
    : (items || []).filter(item => item.live?.available).length
  if (available > 0) {
    return {
      state: 'open',
      title: 'Open for orders',
      detail: `${available} ${available === 1 ? 'item' : 'items'} available now`,
    }
  }
  return {
    state: 'closed',
    title: 'We will be live shortly....❤️',
    detail: 'Ordering opens when today’s menu is ready.',
  }
}

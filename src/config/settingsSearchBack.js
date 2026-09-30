/**
 * While hub search is open, the first committed edge-swipe dismisses
 * search instead of leaving Settings. The second swipe finds no handler
 * and pops the route as usual.
 */
let handler = null

export function setSettingsSearchBackHandler(fn) {
  handler = typeof fn === 'function' ? fn : null
}

export function settingsSearchBackActive() {
  return handler != null
}

/** @returns {boolean} true when the gesture was consumed */
export function consumeSettingsSearchBack() {
  if (!handler) return false
  return handler() === true
}

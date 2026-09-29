const CLEAR_MODE_HINT_KEY = 'gt:list-clear-mode-hint:v1'

export function hasSeenClearModeHint() {
  try {
    return localStorage.getItem(CLEAR_MODE_HINT_KEY) === '1'
  } catch {
    return false
  }
}

export function markClearModeHintSeen() {
  try {
    localStorage.setItem(CLEAR_MODE_HINT_KEY, '1')
  } catch {
    // best-effort — hint may show again
  }
}

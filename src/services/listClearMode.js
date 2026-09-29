const CLEAR_MODE_KEY = 'gt:list-clear-mode:v1'
const CLEAR_MODE_HINT_KEY = 'gt:list-clear-mode-hint:v1'

function readModeMap() {
  try {
    const raw = localStorage.getItem(CLEAR_MODE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeModeMap(map) {
  try {
    localStorage.setItem(CLEAR_MODE_KEY, JSON.stringify(map))
  } catch {
    // localStorage unavailable — in-memory state still applies this session
  }
}

/** Whether immersive clear mode is on for this list (persists until toggled off). */
export function readListClearMode(listId) {
  if (!listId) return false
  return !!readModeMap()[listId]
}

export function writeListClearMode(listId, enabled) {
  if (!listId) return
  const map = readModeMap()
  if (enabled) {
    map[listId] = true
  } else {
    delete map[listId]
  }
  writeModeMap(map)
}

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
    // best-effort
  }
}

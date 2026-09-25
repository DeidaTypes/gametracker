// TEMPORARY device debug — delete this file when the iOS status-tile /
// swipe-deck investigation is done, and remove every import of it.

import { getLocalStorageSizes, getTotalLocalStorageBytes } from './storageQuota'

/** Flip to false to hide the overlay and silence every debugLog call. */
export const DEBUG_DEVICE_OVERLAY = true

const MAX_LINES = 14
const PROBE_KEY = 'gt:debug:ls-probe:v1'

let lines = []
const listeners = new Set()
let lastSetStatusError = null

function emit() {
  const snapshot = lines
  listeners.forEach((fn) => fn(snapshot))
}

export function debugLog(line) {
  if (!DEBUG_DEVICE_OVERLAY) return
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  lines = [...lines, `${hh}:${mm}:${ss} ${line}`].slice(-MAX_LINES)
  emit()
}

export function subscribeDebugLog(fn) {
  listeners.add(fn)
  fn(lines)
  return () => listeners.delete(fn)
}

export function clearDebugLog() {
  lines = []
  emit()
}

export function debugClearSetStatusError() {
  lastSetStatusError = null
}

export function debugNoteSetStatusError(message) {
  lastSetStatusError = message
}

export function debugTakeSetStatusError() {
  const message = lastSetStatusError
  lastSetStatusError = null
  return message
}

const STATUS_LIST_IDS = {
  want: 'want-to-play',
  currently: 'currently-playing',
  played: 'played',
  dropped: 'dropped',
}

export function debugLogLibraryMembership(gameId, statusKey) {
  if (!DEBUG_DEVICE_OVERLAY) return
  const listId = STATUS_LIST_IDS[statusKey] || String(statusKey)
  try {
    const raw = localStorage.getItem('gameLibrary')
    const lib = raw ? JSON.parse(raw) : null
    const games = lib?.lists?.[listId]?.games
    const hit = Array.isArray(games) && games.some((g) => g && String(g.id) === String(gameId))
    debugLog(`e. list=${listId} inList=${hit} len=${Array.isArray(games) ? games.length : 'n/a'}`)
  } catch (err) {
    debugLog(`e. read gameLibrary threw: ${err?.message || String(err)}`)
  }
}

/**
 * Log every localStorage key's size, largest first — the "measure the
 * actual size of every app localStorage key on device, in bytes" step of
 * the quota-exhaustion diagnosis. Call from the physical device and read
 * the on-screen overlay (or Xcode's device console) to get real numbers;
 * this file has no way to fabricate or estimate them on its own.
 */
export function debugLogStorageSizes(label = 'storage sizes') {
  if (!DEBUG_DEVICE_OVERLAY) return
  try {
    const rows = getLocalStorageSizes()
    const total = getTotalLocalStorageBytes()
    debugLog(`p. ${label} — total=${total}B (${Math.round((total / 1024) * 10) / 10}KB)`)
    rows.slice(0, 10).forEach((row) => {
      debugLog(`p.   ${row.key}=${row.bytes}B`)
    })
    if (rows.length > 10) {
      debugLog(`p.   … +${rows.length - 10} more keys`)
    }
  } catch (err) {
    debugLog(`p. storage-size probe threw: ${err?.message || String(err)}`)
  }
}

/** Log a migrateLibraryToSlimShape() / pruneSwipeHistory() result. */
export function debugLogMigrationResult(name, result) {
  if (!DEBUG_DEVICE_OVERLAY) return
  try {
    debugLog(`q. ${name} → ${JSON.stringify(result)}`)
  } catch (err) {
    debugLog(`q. ${name} log threw: ${err?.message || String(err)}`)
  }
}

export function runDeviceStorageProbe() {
  if (!DEBUG_DEVICE_OVERLAY) return
  let prior = null
  try {
    prior = localStorage.getItem(PROBE_KEY)
  } catch (err) {
    debugLog(`m. probe read threw: ${err?.message || String(err)}`)
    prior = undefined
  }
  if (prior !== undefined) {
    if (prior == null) debugLog('m. no prior probe — force-quit and reopen to test survival')
    else debugLog(`m. probe SURVIVED restart value=${prior}`)
  }

  const stamp = String(Date.now())
  try {
    localStorage.setItem(PROBE_KEY, stamp)
    const back = localStorage.getItem(PROBE_KEY)
    debugLog(`l. wrote=${stamp} read=${back} match=${back === stamp}`)
  } catch (err) {
    debugLog(`l. localStorage write/read threw: ${err?.message || String(err)}`)
  }

  try {
    const raw = localStorage.getItem('gameLibrary')
    if (!raw) {
      debugLog('n. gameLibrary missing')
      return
    }
    const lib = JSON.parse(raw)
    const lists = lib?.lists && typeof lib.lists === 'object' ? lib.lists : null
    if (!lists) {
      debugLog('n. gameLibrary has no lists object')
      return
    }
    const parts = Object.keys(lists).map((key) => {
      const count = Array.isArray(lists[key]?.games) ? lists[key].games.length : 'n/a'
      return `${key}:${count}`
    })
    debugLog(`n. lists ${parts.join(' ') || '(none)'}`)
  } catch (err) {
    debugLog(`n. gameLibrary parse threw: ${err?.message || String(err)}`)
  }
}

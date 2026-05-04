// Celebration Service — manages the "first-time Played" celebration queue
//
// Purpose
//   When libraryService.setGameStatus detects a fresh transition into
//   `played` (per-game, lifetime — see `played_first_at` on gameProgress),
//   it calls `queueCelebration({ igdbGameId, completedAt })`. A single
//   <CompletionCelebration> mounted in App subscribes to this queue and
//   renders the head item; calling `dismissCurrent()` shifts to the next
//   queued item (handles the rare case of two near-simultaneous
//   transitions — celebrations show sequentially, never stacked).
//
// Generated share-card PNGs (Sprint 4 = preview only; Sprint 5 will wire
// them into the iOS native share sheet via Capacitor) are stored on the
// same module so the upcoming share UI can pick them up by gameId without
// having to re-render the offscreen card.

let _queue = []
let _shareableCards = {} // { [igdbGameId]: dataUrl }
const _listeners = new Set()
const _shareListeners = new Set()

function emit() {
  for (const fn of _listeners) {
    try {
      fn()
    } catch (err) {
      console.error('[celebration] listener threw:', err)
    }
  }
}

function emitShare() {
  for (const fn of _shareListeners) {
    try {
      fn()
    } catch (err) {
      console.error('[celebration] share-listener threw:', err)
    }
  }
}

/* ============================================================
   Queue API
   ============================================================ */

/**
 * Enqueue a celebration. If one is already on screen, this one shows
 * after `dismissCurrent()` is called for the current head.
 *
 * @param {{ igdbGameId: string|number, completedAt: string }} item
 */
export function queueCelebration(item) {
  if (!item || item.igdbGameId == null) return
  // Defensive: if the same gameId is already queued, don't double-queue.
  // Prevents duplicate fires from rapid status taps before the celebration
  // mounts and persists `played_first_at`.
  const id = String(item.igdbGameId)
  if (_queue.some((q) => String(q.igdbGameId) === id)) return
  _queue = [..._queue, { ...item, igdbGameId: id, completedAt: item.completedAt || new Date().toISOString() }]
  emit()
}

/**
 * Drop the current head. Use when the user dismisses the celebration
 * (Done button, backdrop tap, escape, or after the auto-pipeline of
 * "Write a review" closes the celebration).
 */
export function dismissCurrent() {
  if (_queue.length === 0) return
  _queue = _queue.slice(1)
  emit()
}

export function getCurrentCelebration() {
  return _queue[0] || null
}

export function getQueueSnapshot() {
  return _queue
}

/**
 * React-friendly subscription. Returns an unsubscribe function.
 * Wire this into useSyncExternalStore / a manual useEffect for renders
 * that depend on the celebration head.
 */
export function subscribe(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

/* ============================================================
   Shareable cards — Sprint 4: preview only, Sprint 5 wires native share
   ============================================================ */

/**
 * Stash a generated PNG (data URL) keyed by igdbGameId. Sprint 5's
 * Capacitor share-sheet integration reads from here.
 */
export function storeShareableCard(igdbGameId, dataUrl) {
  if (igdbGameId == null || !dataUrl) return
  _shareableCards = { ..._shareableCards, [String(igdbGameId)]: dataUrl }
  emitShare()
}

export function getShareableCard(igdbGameId) {
  if (igdbGameId == null) return null
  return _shareableCards[String(igdbGameId)] || null
}

export function getAllShareableCards() {
  return _shareableCards
}

export function subscribeShareableCards(fn) {
  _shareListeners.add(fn)
  return () => _shareListeners.delete(fn)
}

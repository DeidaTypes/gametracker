import { useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useBadges } from './useBadges'
import { dispatchBadgeEarned } from '../components/BadgeReveal'
import { syncEarnedBadge, syncAllEarnedBadges } from '../services/badgeService'

const STORAGE_PREFIX = 'gt:earnedBadges:v1'

function storageKey(userId) {
  return `${STORAGE_PREFIX}:${userId}`
}

function parseIdSet(raw) {
  if (!raw) return null
  const arr = JSON.parse(raw)
  // An empty array is not a real baseline — the old global key was
  // often persisted as [] during hydration and then treated every
  // earned badge as new. Treat [] as "no seed".
  if (!Array.isArray(arr) || arr.length === 0) return null
  return new Set(arr)
}

function readPersistedEarnedIds(userId) {
  if (!userId) return null
  try {
    const keyed = parseIdSet(localStorage.getItem(storageKey(userId)))
    if (keyed) return keyed
    // One-time lift of a non-empty legacy global key. Empty / missing
    // legacy values are ignored so a poisoned [] cannot seed this user.
    const legacy = parseIdSet(localStorage.getItem(STORAGE_PREFIX))
    if (legacy) {
      persistEarnedIds(userId, legacy)
      return legacy
    }
    return null
  } catch {
    return null
  }
}

function persistEarnedIds(userId, set) {
  if (!userId) return
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(Array.from(set)))
  } catch {
    // localStorage unavailable — best effort. Toast suppression then
    // becomes session-scoped only.
  }
}

/**
 * Sprint 5 P9 — Badge unlock watcher (reveal overlay edition).
 *
 * Mounted once at the top of the app (see App.jsx). Subscribes to the
 * current user's badge state and fires a celebratory overlay whenever a
 * new badge crosses `isEarned`.
 *
 * Seeding rules (all of these exist to stop a relaunch / auth-flicker
 * from replaying the entire catalogue):
 *   - Never seed or diff while useBadges.loading is true.
 *   - Never persist an in-flight empty snapshot.
 *   - Persist the seen-set per user id, not globally.
 *   - A brief userId=null (relaunch / auth flicker) of the SAME user
 *     keeps the in-memory set; a different user re-reads that user's key.
 *   - Empty → N in a single tick is hydration, not N unlocks.
 *
 * A genuine single unlock still dispatches exactly once.
 */
export function useBadgeUnlockWatcher() {
  const { user } = useAuth()
  const userId = user?.id || null
  const { earned, loading } = useBadges(userId)
  // null sentinel = no baseline yet for this user. Once populated this
  // is the canonical "what we've already toasted for" set.
  const previousIdsRef = useRef(null)
  const lastUserIdRef = useRef(null)

  useEffect(() => {
    if (!userId) {
      // Sign-out / auth flicker. Keep the ref so the same id returning
      // does not look like a new session. Genuine sign-out wipes the
      // persisted keys via localUserData; the next sign-in re-seeds
      // from the first loaded snapshot without dispatching.
      return
    }

    if (lastUserIdRef.current !== userId) {
      previousIdsRef.current = readPersistedEarnedIds(userId)
      lastUserIdRef.current = userId
    }

    // Empty snapshot during hydration is not a baseline.
    if (loading) return

    const currentIds = new Set(earned.map((b) => b.id))

    if (previousIdsRef.current === null) {
      previousIdsRef.current = currentIds
      persistEarnedIds(userId, currentIds)
      syncAllEarnedBadges(userId, Array.from(currentIds))
      return
    }

    const newlyEarned = earned.filter((b) => !previousIdsRef.current.has(b.id))
    if (newlyEarned.length === 0) return

    // Hydration, not N simultaneous unlocks. A single first-ever badge
    // (empty → 1) still celebrates; a catalogue dump does not.
    if (previousIdsRef.current.size === 0 && newlyEarned.length > 1) {
      const next = new Set([...previousIdsRef.current, ...currentIds])
      previousIdsRef.current = next
      persistEarnedIds(userId, next)
      syncAllEarnedBadges(userId, Array.from(currentIds))
      return
    }

    for (const badge of newlyEarned) {
      dispatchBadgeEarned(badge)
      syncEarnedBadge(userId, badge.id)
    }

    const next = new Set([...previousIdsRef.current, ...currentIds])
    previousIdsRef.current = next
    persistEarnedIds(userId, next)
  }, [earned, userId, loading])
}

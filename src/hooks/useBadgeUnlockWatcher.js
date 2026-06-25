import { useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useBadges } from './useBadges'
import { dispatchBadgeEarned } from '../components/BadgeReveal'

const STORAGE_KEY = 'gt:earnedBadges:v1'

function readPersistedEarnedIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    return new Set(arr)
  } catch {
    return null
  }
}

function persistEarnedIds(set) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)))
  } catch {
    // localStorage unavailable — best effort. Toast suppression then
    // becomes session-scoped only, which is still an improvement on
    // toast-spam-on-every-load.
  }
}

/**
 * Sprint 5 P9 — Badge unlock watcher (reveal overlay edition).
 *
 * Mounted once at the top of the app (see App.jsx). Subscribes to the
 * current user's badge state and fires a celebratory toast whenever a
 * new badge crosses `isEarned`.
 *
 * **Critical first-mount semantics**: on the *first* run of a session
 * the ref is `null`. We initialize it from `localStorage`'s persisted
 * earned-id set (NOT from the current `earned` array, which can still
 * be empty while useUserStats is mid-fetch). Reading from localStorage
 * is the only way to reliably distinguish "earned this session" from
 * "already earned before page load" given the multi-tick async stats
 * hydration: stats tick 1 = empty, tick 2 = local-only, tick 3 = fully
 * fetched. Snapshotting `earned` at tick 1 would treat the entire
 * collection as "newly earned" the moment tick 3 lands.
 *
 * If localStorage is empty (genuine first-ever load) we seed the ref
 * with whatever `earned` is right now and persist it. From that point
 * on, diffs are reliable.
 *
 * On subsequent runs we diff the current earned id-set against the
 * union of (ref + localStorage). Each new id fires one toast with
 * the badge's icon, then the ref + localStorage are synced to the
 * new set so the same badge never re-toasts.
 *
 * No-op when there's no signed-in user.
 */
export function useBadgeUnlockWatcher() {
  const { user } = useAuth()
  const userId = user?.id || null
  const { earned } = useBadges(userId)
  // null sentinel = first mount of this session; once populated this
  // becomes the canonical "what we've already toasted for" set.
  const previousIdsRef = useRef(null)

  useEffect(() => {
    if (!userId) {
      // Sign-out clears the ref so the next sign-in re-reads from
      // localStorage and starts fresh.
      previousIdsRef.current = null
      return
    }

    const currentIds = new Set(earned.map((b) => b.id))

    // ── First mount of the session ────────────────────────────────
    // Seed the ref from localStorage if available — this is what
    // protects us from toasting on initial load for badges the user
    // earned in a prior session. If localStorage is empty the user
    // is genuinely brand-new on this device, so we snapshot the
    // current earned set (which will be the correct anti-spam
    // baseline once stats finish hydrating).
    if (previousIdsRef.current === null) {
      const persisted = readPersistedEarnedIds()
      if (persisted) {
        // Union the persisted set with whatever's already earned in
        // memory — that way a brand-new badge that landed *before*
        // the watcher mounted (extremely rare race) still gets
        // suppressed rather than spuriously toasted.
        const seed = new Set([...persisted, ...currentIds])
        previousIdsRef.current = seed
        persistEarnedIds(seed)
      } else {
        previousIdsRef.current = currentIds
        persistEarnedIds(currentIds)
      }
      return
    }

    // ── Subsequent runs — diff and toast newly-earned badges ─────
    const newlyEarned = earned.filter((b) => !previousIdsRef.current.has(b.id))
    if (newlyEarned.length === 0) return

    for (const badge of newlyEarned) {
      // Dispatch to BadgeReveal (full-screen overlay). Reveal handles
      // queueing so multiple same-session unlocks play sequentially.
      dispatchBadgeEarned(badge)
    }

    // Union with previous so a badge can never re-toast even if a
    // future stats refresh happens to drop and re-add it (e.g. cache
    // race during sign-out/sign-in).
    const next = new Set([...previousIdsRef.current, ...currentIds])
    previousIdsRef.current = next
    persistEarnedIds(next)
  }, [earned, userId])
}

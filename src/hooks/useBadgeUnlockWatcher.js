import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { BADGES } from '../data/badges'
import { useBadges } from './useBadges'
import { useBadgeBackfill } from './useBadgeBackfill'
import { APP_RESUMED_EVENT, isLongAbsence } from './useAppResume'
import { dispatchBadgeEarned } from '../components/BadgeReveal'
import { syncEarnedBadge, syncAllEarnedBadges, acknowledgeBadgeCelebration, recomputeBadgesSoon } from '../services/badgeService'
import { claimBadgeMoments, isBadgeMomentsHeld, showBadgeMoments } from '../services/badgeMoments'

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
 *     That rule applies to tiered badges only. One-step badges
 *     (kind === 'single') never enter the seen-set; they celebrate
 *     from celebrated_at through badgeMoments.
 *
 * A genuine single tiered unlock still dispatches exactly once.
 *
 * Backfill coordination (this prompt — not the loading/replay fix):
 *   wait until useBadgeBackfill has settled, absorb any historical
 *   grant ids into the seen-set, and skip families whose
 *   celebrated_at is already set. Loading/hydration rules above are
 *   untouched.
 */
export function useBadgeUnlockWatcher() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const userId = user?.id || null
  const { earned, stats, loading } = useBadges(userId)
  const backfill = useBadgeBackfill()
  // null sentinel = no baseline yet for this user. Once populated this
  // is the canonical "what we've already toasted for" set.
  const previousIdsRef = useRef(null)
  const lastUserIdRef = useRef(null)
  const absorbedBackfillRef = useRef(false)
  // Bumped when a badgeMoments hold clears, so singles earned during
  // the hold (onboarding) get a chance to show.
  const [momentsEpoch, setMomentsEpoch] = useState(0)

  useEffect(() => {
    const onRelease = () => setMomentsEpoch((n) => n + 1)
    window.addEventListener('badgeMomentsReleased', onRelease)
    return () => window.removeEventListener('badgeMomentsReleased', onRelease)
  }, [])

  useEffect(() => {
    if (!userId) {
      // Sign-out / auth flicker. Keep the ref so the same id returning
      // does not look like a new session. Genuine sign-out wipes the
      // persisted keys via localUserData; the next sign-in re-seeds
      // from the first loaded snapshot without dispatching.
      return
    }

    // Do not seed or diff until historical grants are stamped
    // celebrated_at. Prevents a first-launch race against backfill.
    // A failed RPC must not fall through into a catalogue dump.
    if (!backfill.settled || backfill.failed) return

    if (lastUserIdRef.current !== userId) {
      previousIdsRef.current = readPersistedEarnedIds(userId)
      lastUserIdRef.current = userId
      absorbedBackfillRef.current = false
    }

    if (!absorbedBackfillRef.current) {
      absorbedBackfillRef.current = true
      // One-step badges never enter the seen-set. Tiered grants still do.
      const grantIds = backfill.grants
        .filter((b) => b.kind !== 'single')
        .map((b) => b.id)
      if (grantIds.length > 0) {
        const next = new Set([
          ...(previousIdsRef.current || []),
          ...grantIds,
        ])
        previousIdsRef.current = next
        persistEarnedIds(userId, next)
      }
    }

    // Empty snapshot during hydration is not a baseline.
    if (loading) return

    // One-step badges. Families this launch's backfill just stamped
    // belong to the Already earned card; stats can lag that stamp by
    // one read, so those families are not moments.
    if (!isBadgeMomentsHeld()) {
      const grantedFamilies = new Set(
        backfill.grants.map((badge) => badge.family).filter(Boolean)
      )
      const pending = BADGES.filter((badge) => (
        badge.kind === 'single'
        && badge.isEarned(stats)
        && !stats?.[`${badge.family}__celebrated`]
        && !grantedFamilies.has(badge.family)
      ))
      const claimed = claimBadgeMoments(pending)
      if (claimed.length) {
        showBadgeMoments(claimed, { context: 'app', stats, userId, navigate })
      }
    }

    // Everything below is the tiered path, unchanged, on non-single badges.
    const tiered = earned.filter((b) => b.kind !== 'single')
    const currentIds = new Set(tiered.map((b) => b.id))
    // S16-4: Sprint 16 badges (badge.category === 'sprint16') are already
    // persisted server-side by recompute_my_badges() under their FAMILY
    // id (e.g. 'finisher'), with real tier/current_value columns — not
    // this per-tier id ('finisher-bronze'/'-silver'/'-gold'). Feeding
    // those ids into syncEarnedBadge/syncAllEarnedBadges (which only ever
    // write bare {user_id, badge_id} rows, Sprint-5-P9-style) would
    // insert a SEPARATE, malformed row per tier with no tier/current_value
    // — silently polluting user_badges and badge_rarity() with ids no
    // definition or query expects. Only legacy (pre-Sprint-16) badges use
    // that sync path; Sprint 16 badges are filtered out of every sync
    // call below. This is additive filtering only — it does not touch
    // the separately-diagnosed `loading`/replay bug in this effect.
    const legacyEarnedIds = () =>
      tiered.filter((b) => b.category !== 'sprint16').map((b) => b.id)

    if (previousIdsRef.current === null) {
      previousIdsRef.current = currentIds
      persistEarnedIds(userId, currentIds)
      syncAllEarnedBadges(userId, legacyEarnedIds())
      return
    }

    const newlyEarned = tiered.filter((b) => !previousIdsRef.current.has(b.id))
    if (newlyEarned.length === 0) return

    // Hydration, not N simultaneous unlocks. A single first-ever badge
    // (empty → 1) still celebrates; a catalogue dump does not.
    if (previousIdsRef.current.size === 0 && newlyEarned.length > 1) {
      const next = new Set([...previousIdsRef.current, ...currentIds])
      previousIdsRef.current = next
      persistEarnedIds(userId, next)
      syncAllEarnedBadges(userId, legacyEarnedIds())
      return
    }

    for (const badge of newlyEarned) {
      // S16-4 celebration-collision rule: Kept the Fire overlaps streak
      // milestones (S16-2) at day 7/30/100 exactly, so it never gets its
      // own toast — it still records/shows a tier normally, it just
      // never reaches dispatchBadgeEarned. This is the ONLY change made
      // in this file for S16-4 besides the sprint16-id sync filtering
      // above; the separately-diagnosed `loading`/replay bug in the
      // effect above is untouched, and this guard can only ever SKIP a
      // dispatch, never add one, so it cannot increase how many badges a
      // mass-fire replays.
      if (badge.silent) continue
      // Backfill (and any later acknowledge) stamps celebrated_at on
      // the family row. Skip those — they are already acknowledged.
      if (badge.family && stats?.[`${badge.family}__celebrated`]) continue
      dispatchBadgeEarned(badge)
      if (badge.category !== 'sprint16') syncEarnedBadge(userId, badge.id)
      else acknowledgeBadgeCelebration(badge.family)
    }

    const next = new Set([...previousIdsRef.current, ...currentIds])
    previousIdsRef.current = next
    persistEarnedIds(userId, next)
  }, [earned, stats, userId, loading, backfill.settled, backfill.failed, backfill.grants, navigate, momentsEpoch])

  // Hearts and follows that arrived while the app was away move Fan Mail,
  // Fan Favorite and Squad Goals only when this user recomputes. A long
  // absence is the catch-up; a short return leaves the rows alone.
  useEffect(() => {
    function onResume(e) {
      if (!isLongAbsence(e)) return
      recomputeBadgesSoon()
    }
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [])
}

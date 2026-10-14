import { useCallback, useEffect, useMemo } from 'react'
import { BADGES, TIER_RANK } from '../data/badges'
import { supabase } from '../services/supabase'
import { useCachedResource } from './useCachedResource'

/**
 * Sprint 16 (S16-4) — Badge state hook, rewritten as a READER.
 *
 * Sprint 5 P9's version of this hook wrapped useUserStats and computed
 * every badge's progress/isEarned from 20+ live Supabase/localStorage
 * queries on every mount. That is gone. This hook now does exactly ONE
 * thing on mount: a single indexed
 *   select badge_id, tier, current_value, celebrated_at from user_badges where user_id = X
 * query. All actual computation happens server-side in
 * recompute_my_badges() (see
 * supabase/migrations/20260914190930_badge_tiers_persistence.sql), fired
 * from the write-side call sites (sessionService, journalService,
 * reviewService, libraryService.setGameStatus) — never from here, and
 * never on mount. See the chat report for the measured cost of that one
 * query vs. the old per-mount computation.
 *
 * Reshapes the query result into the `stats` shape src/data/badges.js's
 * tieredBadge() reads: `{ [familyId]: current_value, [familyId +
 * '__tier']: tier }`. Refetches on the same `badgesUpdated` event
 * badgeService.recomputeBadges() dispatches after a successful RPC call,
 * plus `storage` for cross-tab consistency (matching the old hook's
 * refresh convention).
 *
 * Return shape is UNCHANGED from Sprint 5 — { earned, inProgress, locked,
 * stats, loading } — so BadgesRow / UserBadgesPage / BadgeShowcase /
 * BadgeDetailModal (all out of scope here, S16-5) need no changes.
 */
function shapeBadgeStats(rows) {
  const next = {}
  for (const row of rows || []) {
    next[row.badge_id] = Number(row.current_value) || 0
    next[`${row.badge_id}__tier`] = row.tier || null
    next[`${row.badge_id}__celebrated`] = !!row.celebrated_at
  }
  return next
}

export function useBadges(userId) {
  const key = userId ? `profile:badges:${userId}` : null

  const fetcher = useCallback(async () => {
    const { data, error } = await supabase
      .from('user_badges')
      .select('badge_id, tier, current_value, celebrated_at')
      .eq('user_id', userId)

    if (error) throw error
    return shapeBadgeStats(data)
  }, [userId])

  const { data, error, refresh } = useCachedResource(key, fetcher, { enabled: !!userId })
  const stats = data ?? {}
  const loading = !!userId && data === undefined && !error

  useEffect(() => {
    if (!userId) return undefined
    const onChange = () => {
      refresh().catch(() => {})
    }
    window.addEventListener('storage', onChange)
    window.addEventListener('badgesUpdated', onChange)
    return () => {
      window.removeEventListener('storage', onChange)
      window.removeEventListener('badgesUpdated', onChange)
    }
  }, [userId, refresh])

  const partitioned = useMemo(() => {
    const earned = []
    const inProgress = []
    const locked = []

    for (const badge of BADGES) {
      const progress = badge.progress(stats)
      const isEarned = badge.isEarned(stats)

      if (isEarned) {
        earned.push(badge)
      } else if (progress > 0) {
        inProgress.push(badge)
      } else {
        locked.push(badge)
      }
    }

    const byTierThenName = (a, b) => {
      const t = (TIER_RANK[a.tier] ?? 99) - (TIER_RANK[b.tier] ?? 99)
      if (t !== 0) return t
      return a.name.localeCompare(b.name)
    }

    earned.sort(byTierThenName)
    inProgress.sort(byTierThenName)
    locked.sort(byTierThenName)

    return { earned, inProgress, locked, stats }
  }, [stats])

  return { ...partitioned, loading }
}

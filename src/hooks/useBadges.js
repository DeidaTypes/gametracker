import { useMemo } from 'react'
import { BADGES, TIER_RANK } from '../data/badges'
import { useUserStatsState } from './useUserStats'

/**
 * Sprint 5 P9 — Badge state hook.
 *
 * Wraps useUserStats and partitions BADGES into:
 *   earned     — isEarned(stats) === true
 *   inProgress — isEarned === false AND progress(stats) > 0
 *   locked     — progress(stats) === 0
 *
 * Each list is sorted by tier ascending so callers can render a
 * predictable visual hierarchy (bronze → platinum) without re-sorting
 * at every consumer site.
 *
 * The return value is memoized on the stats object so identical stats
 * don't trigger downstream re-renders. The unlock watcher relies on
 * the `earned` array's reference identity: when stats genuinely change,
 * `earned` is a new reference; when stats are unchanged it stays
 * pointer-stable so the watcher's diff doesn't fire spuriously.
 */
export function useBadges(userId) {
  const { stats, loading } = useUserStatsState(userId)

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

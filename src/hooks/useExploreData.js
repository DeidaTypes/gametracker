import { useEffect, useState, useCallback, useRef } from 'react'
import {
  getTrendingThisWeek,
  getTrendingCircle,
  getTrendingByGenre,
  getJustFinished,
  getMostPlayedThisWeek,
  getMostPlayedInCircle,
} from '../services/communityService'
import {
  getRecentCommunityReviews,
  getPopularReviews,
  getReviewsFromFollowing,
} from '../services/reviewService'
import { getUpcomingReleases, getRecentReleasesForDiscover } from '../services/igdb'
import { APP_RESUMED_EVENT } from './useAppResume'

/**
 * Generic loader hook.
 *
 * Loads once on mount and exposes a `refetch()` function that returns a
 * real Promise (resolves when the new data arrives, rejects on error).
 * Every loader fails soft (resolves to [] on error) and the loading flag
 * is always cleared in `finally`, so a section can never hang on a spinner.
 *
 * Pass an optional `deps` array to re-fetch whenever deps change (e.g. scope).
 * Omit `deps` (or pass null) for the classic "run once on mount" behaviour.
 */
function useAsyncSection(loaderFn, deps = null) {
  // Keep a ref so `doFetch` never needs loaderFn in its dep array (the
  // inline arrow passed by callers is a new identity every render).
  const loaderRef = useRef(loaderFn)
  loaderRef.current = loaderFn

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Stable fetch function — safe to call from pull-to-refresh handlers.
  const doFetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await loaderRef.current()
      setData(result)
      return result
    } catch (err) {
      const msg = err?.message || 'Failed to load'
      setError(msg)
      throw new Error(msg)
    } finally {
      setLoading(false)
    }
  }, []) // intentionally empty — uses ref internally

  // When deps is null → run once on mount (legacy behaviour).
  // When deps is an array → re-run whenever deps change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const effectDeps = deps === null ? [] : deps
  useEffect(() => {
    let cancelled = false
    const _t0 = Date.now()
    setLoading(true)
    setError(null)
    loaderRef.current()
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setLoading(false)
          if (import.meta.env.DEV) console.log(`[⏱ useExploreData] section resolved in ${Date.now() - _t0}ms`)
        }
      })
      .catch((err) => { if (!cancelled) { setError(err?.message || 'Failed to load'); setLoading(false) } })
    return () => { cancelled = true }
  }, effectDeps) // eslint-disable-line react-hooks/exhaustive-deps

  // Resume recovery: the WebView is not remounted when the app returns to
  // the foreground, so the mount-time load above never re-runs on its own.
  // Refetch on the global resume event so stale mount-time data reloads.
  useEffect(() => {
    const onResume = () => { doFetch().catch(() => {}) }
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [doFetch])

  return { data, loading, error, refetch: doFetch }
}

export function useTrendingThisWeek() {
  return useAsyncSection(() => getTrendingThisWeek(10))
}

/**
 * Trending section with scope switching.
 *
 * `scope` is one of: 'global' | 'circle' | 'genre'
 *
 * Re-fetches whenever scope changes so the carousel immediately reflects the
 * new data source. The loaderRef pattern means the arrow below is always the
 * latest scope without needing it in the useCallback dep array.
 */
export function useTrendingByScope(scope) {
  return useAsyncSection(
    () => {
      if (scope === 'circle') return getTrendingCircle(10)
      if (scope === 'genre')  return getTrendingByGenre(10)
      return getTrendingThisWeek(10)
    },
    [scope],
  )
}

export function useJustFinished() {
  return useAsyncSection(() => getJustFinished(20))
}

export function useRecentReviews() {
  return useAsyncSection(() => getRecentCommunityReviews(20))
}

export function useNewReleases() {
  return useAsyncSection(() => getUpcomingReleases(10))
}

/** Discover page — "NEW" games carousel: recent IGDB releases newest-first. */
export function useDiscoverGamesNew() {
  return useAsyncSection(() => getRecentReleasesForDiscover(20))
}

/** Discover page — "POPULAR" reviews feed: like-ranked, 30-day window w/ fallback. */
export function usePopularReviews() {
  return useAsyncSection(() => getPopularReviews({ days: 30, limit: 25 }))
}

/** Discover page — "FOLLOWING" reviews feed: newest-first from followed users. */
export function useFollowingReviews() {
  return useAsyncSection(async () => {
    const result = await getReviewsFromFollowing({ page: 1, limit: 20 })
    return result.items || []
  })
}

/**
 * Discover page — "Most played this week" rail.
 * Top 5 games by summed community session hours in the last 7 days.
 * Returns [] when no sessions fall in the window → section stays hidden.
 */
export function useMostPlayedThisWeek() {
  return useAsyncSection(() => getMostPlayedThisWeek(5))
}

/**
 * Discover page — "In your circle" most-played rail.
 * Top 10 games by distinct-friend activity_events in the last 7 days,
 * filtered to the viewer's follow graph. Includes WoW rank movement.
 * Returns [] when the viewer has no follows or circle is quiet.
 */
export function useCircleMostPlayed() {
  return useAsyncSection(() => getMostPlayedInCircle(10))
}

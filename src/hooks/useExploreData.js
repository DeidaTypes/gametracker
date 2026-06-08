import { useEffect, useState, useCallback, useRef } from 'react'
import {
  getTrendingThisWeek,
  getJustFinished,
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
 */
function useAsyncSection(loaderFn) {
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

  // Initial load with cancel-on-unmount safety.
  useEffect(() => {
    let cancelled = false
    const _t0 = Date.now()
    loaderRef.current()
      .then((result) => {
        if (!cancelled) {
          setData(result)
          if (import.meta.env.DEV) console.log(`[⏱ useExploreData] section resolved in ${Date.now() - _t0}ms`)
        }
      })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, []) // runs once on mount

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

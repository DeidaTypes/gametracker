import { useEffect, useState, useCallback, useRef } from 'react'
import {
  getTrendingThisWeek,
  getJustFinished,
} from '../services/communityService'
import { getRecentCommunityReviews } from '../services/reviewService'
import { getUpcomingReleases } from '../services/igdb'

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
    loaderRef.current()
      .then((result) => { if (!cancelled) setData(result) })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, []) // runs once on mount

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
  return useAsyncSection(() => getUpcomingReleases(20))
}

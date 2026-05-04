import { useEffect, useState } from 'react'
import {
  getTrendingThisWeek,
  getJustFinished,
} from '../services/communityMockService'
import { getRecentCommunityReviews } from '../services/reviewService'
import { getUpcomingReleases } from '../services/igdb'

/**
 * Generic loader hook. Each section calls its loader once on mount.
 * The community-mock service shares an internal single-flight cache, so
 * even though we call four hooks in parallel they only kick off one IGDB
 * pool fetch under the hood.
 */
function useAsyncSection(loader) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    loader()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
    // Loader is a stable reference passed in by the caller (a module-scope
    // function), so we intentionally do not include it in deps to avoid
    // re-firing when an inline arrow gets a new identity each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { data, loading, error }
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

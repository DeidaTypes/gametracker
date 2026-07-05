import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getHomeFeed } from '../services/communityService'
import { prefetchLikeStatesForReviews } from './useLikeState'
import { APP_RESUMED_EVENT } from './useAppResume'

/**
 * useHomeFeed — pagination + scope tracking for the Home text-forward
 * review feed (see communityService.getHomeFeed / HomeReviewCard).
 *
 * Mirrors useCircleActivity's shape ({ items, loading, loadingMore,
 * hasMore, loadMore, refresh }) plus a `scope` field the UI can use to
 * label the section ('following' | 'community' | 'mixed').
 *
 * Pagination contract: the `scope` decided on page 1 is pinned and
 * passed back on every `loadMore` call so the feed doesn't re-decide
 * its source mid-scroll (see getHomeFeed's doc comment).
 *
 * Every page's review ids are pushed into the shared like-state cache
 * via prefetchLikeStatesForReviews so HomeReviewCard's react button
 * renders the correct liked/count on first paint without an extra
 * per-card round-trip.
 */
export function useHomeFeed({ pageSize = 15 } = {}) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [scope, setScope] = useState('following')
  const [error, setError] = useState(null)

  const cursorRef = useRef(null)
  const scopeRef = useRef(null)

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setItems([])
      setHasMore(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    cursorRef.current = null
    scopeRef.current = null
    try {
      const result = await getHomeFeed({ limit: pageSize })
      setItems(result.items)
      setHasMore(result.hasMore)
      setScope(result.scope)
      cursorRef.current = result.nextCursor
      scopeRef.current = result.scope
      if (result.items.length) {
        prefetchLikeStatesForReviews(result.items.map((it) => it.id))
      }
    } catch (err) {
      setError(err)
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [user?.id, pageSize])

  const loadMore = useCallback(async () => {
    if (!user?.id) return
    if (loadingMore || !hasMore || !cursorRef.current) return
    setLoadingMore(true)
    try {
      const result = await getHomeFeed({
        cursor: cursorRef.current,
        scope: scopeRef.current,
        limit: pageSize,
      })
      setItems((prev) => {
        const seen = new Set(prev.map((it) => it.id))
        const merged = [...prev]
        for (const item of result.items) {
          if (!seen.has(item.id)) merged.push(item)
        }
        return merged
      })
      setHasMore(result.hasMore)
      cursorRef.current = result.nextCursor
      if (result.items.length) {
        prefetchLikeStatesForReviews(result.items.map((it) => it.id))
      }
    } catch (err) {
      setError(err)
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }, [user?.id, pageSize, loadingMore, hasMore])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    function onResume() {
      refresh()
    }
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [refresh])

  return { items, loading, loadingMore, hasMore, scope, error, refresh, loadMore }
}

export default useHomeFeed

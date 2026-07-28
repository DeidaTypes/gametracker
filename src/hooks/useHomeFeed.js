import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getHomeFeed } from '../services/communityService'
import { ACTIVITY_EVENT_LOGGED } from '../services/activityEventsService'
import { prefetchLikeStatesForReviews } from './useLikeState'
import { APP_RESUMED_EVENT } from './useAppResume'

const REVIEW_ITEM_TYPES = new Set(['reviewed', 'rated'])

/**
 * useHomeFeed — pagination + scope tracking for "The pulse", Home's
 * unified activity feed (see communityService.getHomeFeed /
 * HomeReviewCard). Items span reviewed/rated (from `reviews`) plus
 * started/finished/listed/played (from `activity_events`) — every
 * `item.id` is only guaranteed to be a `reviews` row id for
 * REVIEW_ITEM_TYPES ('reviewed'/'rated'); every other type's `id` is an
 * `activity_events` row id, which is why the like-state prefetch below
 * filters to REVIEW_ITEM_TYPES before hitting `review_likes`.
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
 *
 * Seamless own-activity updates: every mutation Home cares about
 * (create list, add to list, rate/review, mark finished, add to
 * backlog) already fire-and-forgets `logActivityEvent` AFTER its
 * primary write succeeds (see activityEventsService.js), which only
 * then dispatches ACTIVITY_EVENT_LOGGED. That ordering means a failed
 * mutation never fires the event — the feed is simply never touched,
 * so there's nothing to roll back. On success, this hook re-fetches
 * page 1 (the mutation is already committed, so getHomeFeed already
 * includes it) and splices in only the ids it hasn't already
 * rendered, prepended to the top — no loading-flag flip, so the rest
 * of the list never flashes/reloads.
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
      const reviewIds = result.items.filter((it) => REVIEW_ITEM_TYPES.has(it.type)).map((it) => it.id)
      if (reviewIds.length) {
        prefetchLikeStatesForReviews(reviewIds)
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
      const reviewIds = result.items.filter((it) => REVIEW_ITEM_TYPES.has(it.type)).map((it) => it.id)
      if (reviewIds.length) {
        prefetchLikeStatesForReviews(reviewIds)
      }
    } catch (err) {
      setError(err)
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }, [user?.id, pageSize, loadingMore, hasMore])

  const silentRefresh = useCallback(async () => {
    if (!user?.id) return
    try {
      const result = await getHomeFeed({ limit: pageSize })
      setItems((prev) => {
        const seen = new Set(prev.map((it) => it.id))
        const fresh = result.items.filter((it) => !seen.has(it.id))
        return fresh.length ? [...fresh, ...prev] : prev
      })
      setScope(result.scope)
      if (result.items.length) {
        prefetchLikeStatesForReviews(
          result.items.filter((it) => REVIEW_ITEM_TYPES.has(it.type)).map((it) => it.id)
        )
      }
    } catch {
      // Soft-fail — the next natural refresh (mount / app resume) still
      // picks the new row up eventually.
    }
  }, [user?.id, pageSize])

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

  useEffect(() => {
    function onActivityLogged(e) {
      if (e?.detail?.actor_user_id === user?.id) silentRefresh()
    }
    window.addEventListener(ACTIVITY_EVENT_LOGGED, onActivityLogged)
    return () => window.removeEventListener(ACTIVITY_EVENT_LOGGED, onActivityLogged)
  }, [user?.id, silentRefresh])

  return { items, loading, loadingMore, hasMore, scope, error, refresh, loadMore }
}

export default useHomeFeed

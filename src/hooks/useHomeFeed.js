import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getHomeFeed } from '../services/communityService'
import { ACTIVITY_EVENT_LOGGED } from '../services/activityEventsService'
import { prefetchLikeStatesForReviews } from './useLikeState'
import { prefetchReactionsBatch } from './useReactions'
import { APP_RESUMED_EVENT } from './useAppResume'
import { getSWR, peekSWR } from '../services/swrCache'

const REVIEW_ITEM_TYPES = new Set(['reviewed', 'rated'])

/**
 * Batch-load the like and reaction state a page of cards needs, in two
 * round-trips each instead of one per card.
 *
 * Must be called *before* the items are put into state: both prefetches
 * mark their ids in-flight synchronously, which is what stops the
 * about-to-mount cards from firing their own individual queries.
 */
function prefetchRowInteractions(pageItems) {
  const reviewRows = pageItems.filter((it) => REVIEW_ITEM_TYPES.has(it.type))
  const reviewIds = reviewRows.map((it) => it.id)
  if (reviewIds.length) {
    // getHomeFeed already batched these counts onto every item, so handing
    // them over avoids re-running the identical `review_likes` count query
    // the feed just finished.
    const knownCounts = new Map(reviewRows.map((it) => [it.id, it.likeCount || 0]))
    prefetchLikeStatesForReviews(reviewIds, { knownCounts }).catch(() => {})
  }

  // Only non-review rows carry a reactionTargetId (see getHomeFeed).
  const activityIds = pageItems.map((it) => it.reactionTargetId).filter(Boolean)
  if (activityIds.length) prefetchReactionsBatch('activity', activityIds)
}

/** How long page 1 of the feed is reused before the next entry revalidates. */
const FEED_TTL_MS = 60 * 1000

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

  // Page 1 goes through the shared cache so returning to Home shows the
  // feed the user was just looking at instead of rebuilding it from an
  // empty list. Later pages are deliberately uncached: they're only
  // reachable by scrolling, which means the user is already on the screen
  // and there is no navigation flash to avoid.
  const pageOneKey = user?.id ? `home:feed:${user.id}:${pageSize}` : null
  const cachedPageOne = pageOneKey ? peekSWR(pageOneKey) : undefined

  const [items, setItems] = useState(cachedPageOne?.items ?? [])
  const [loading, setLoading] = useState(cachedPageOne === undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(cachedPageOne?.hasMore ?? true)
  const [scope, setScope] = useState(cachedPageOne?.scope ?? 'following')
  const [error, setError] = useState(null)

  const cursorRef = useRef(cachedPageOne?.nextCursor ?? null)
  const scopeRef = useRef(cachedPageOne?.scope ?? null)

  const loadPageOne = useCallback(async ({ force }) => {
    if (!user?.id) {
      setItems([])
      setHasMore(false)
      setLoading(false)
      return
    }
    const key = `home:feed:${user.id}:${pageSize}`
    const warm = force ? undefined : peekSWR(key)
    // Only show the spinner when we have nothing at all to render;
    // a warm feed revalidates silently underneath the existing list.
    if (warm === undefined) setLoading(true)
    setError(null)
    if (!warm) {
      cursorRef.current = null
      scopeRef.current = null
    }
    try {
      const result = await getSWR(key, () => getHomeFeed({ limit: pageSize }), {
        ttlMs: FEED_TTL_MS,
        force,
      })
      prefetchRowInteractions(result.items)
      setItems(result.items)
      setHasMore(result.hasMore)
      setScope(result.scope)
      cursorRef.current = result.nextCursor
      scopeRef.current = result.scope
    } catch (err) {
      setError(err)
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [user?.id, pageSize])

  // Pull-to-refresh and resume both mean "go get new data", so they skip
  // the cache outright.
  const refresh = useCallback(() => loadPageOne({ force: true }), [loadPageOne])

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
      prefetchRowInteractions(result.items)
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
      // Forced through the cache rather than around it: this runs right
      // after the user's own mutation, so the cached page 1 must end up
      // holding the new row too — otherwise navigating away and back
      // within the TTL would serve a page 1 that predates their action.
      const result = await getSWR(
        `home:feed:${user.id}:${pageSize}`,
        () => getHomeFeed({ limit: pageSize }),
        { ttlMs: FEED_TTL_MS, force: true }
      )
      prefetchRowInteractions(result.items)
      setItems((prev) => {
        const seen = new Set(prev.map((it) => it.id))
        const fresh = result.items.filter((it) => !seen.has(it.id))
        return fresh.length ? [...fresh, ...prev] : prev
      })
      setScope(result.scope)
    } catch {
      // Soft-fail — the next natural refresh (mount / app resume) still
      // picks the new row up eventually.
    }
  }, [user?.id, pageSize])

  useEffect(() => {
    loadPageOne({ force: false })
  }, [loadPageOne])

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

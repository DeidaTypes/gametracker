import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getHomeFeed } from '../services/communityService'
import { qaPulse } from '../services/qaService'
import { coverUrlFromImageId } from '../services/igdb'
import { isQaQuestionHidden, useQaHides } from '../pages/qa/qaHides'
import { ACTIVITY_EVENT_LOGGED, PULSE_ITEM_REMOVED, emitPulseItemRemoved } from '../services/activityEventsService'
import { prefetchLikeStatesForReviews } from './useLikeState'
import { prefetchReactionsBatch } from './useReactions'
import { APP_RESUMED_EVENT } from './useAppResume'
import { getSWR, peekSWR, updateSWR } from '../services/swrCache'
import { isDuplicateCompletionOrReview } from '../utils/homeFeedDedupe'

const REVIEW_ITEM_TYPES = new Set(['reviewed', 'rated'])

/**
 * Drop a Pulse item from the page-1 SWR cache and notify a mounted
 * useHomeFeed to splice it out of `items`. Call this from the delete
 * path *before* navigating back — Home may be unmounted, so the
 * window event alone would miss the cache.
 */
export function removePulseFeedItem(userId, itemId, pageSize = 15) {
  if (!itemId) return
  if (userId) {
    updateSWR(`home:feed:${userId}:${pageSize}`, (data) => {
      if (!data?.items) return data
      return { ...data, items: data.items.filter((it) => it.id !== itemId) }
    })
  }
  emitPulseItemRemoved(itemId)
}

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


/* ------------------------------------------------------------------ */
/* Q&A rows                                                            */
/* ------------------------------------------------------------------ */

/** Pulse item types for Q&A rows. Neither is a review type and neither carries a reactionTargetId. */
const QA_ITEM_TYPES = new Set(['qa_asked', 'qa_best'])

/** At most this many Q&A rows per Pulse load, and never two in a row. */
const QA_PULSE_MAX = 2

export function isQaPulseItem(item) {
  return QA_ITEM_TYPES.has(item?.type)
}

/** One qa_pulse event -> a Pulse item FeedRow's Q&A row can render. Null when a field it needs is missing. */
function qaEventToItem(event) {
  if (!event?.question_id || !event.title || !event.event_at || !event.actor?.id) return null
  if (event.kind !== 'asked' && event.kind !== 'best') return null
  return {
    id: `qa:${event.kind}:${event.question_id}`,
    type: event.kind === 'best' ? 'qa_best' : 'qa_asked',
    createdAt: event.event_at,
    isOwn: false,
    author: {
      id: event.actor.id,
      username: event.actor.username || null,
      displayName: event.actor.display_name || event.actor.username || null,
      avatarUrl: event.actor.avatar_url || null,
    },
    game: {
      id: event.igdb_game_id,
      title: event.game_title || '',
      image: event.game_cover_image_id
        ? coverUrlFromImageId(String(event.game_cover_image_id), 'cover_big')
        : null,
    },
    qa: {
      questionId: event.question_id,
      title: event.title,
      igdbGameId: event.igdb_game_id,
      gameTitle: event.game_title || '',
      gameCoverImageId: event.game_cover_image_id || null,
    },
  }
}

/**
 * Drop up to QA_PULSE_MAX Q&A rows into page 1 by recency, one row per
 * question, with a feed row between any two of them. Done before the page is
 * cached, so the rows are part of the first paint and never inserted after it.
 * A Q&A row that cannot be separated from the previous one (the feed is too
 * short) is dropped rather than shown back to back.
 */
function mergeQaIntoFeed(feedItems, qaEvents) {
  if (!qaEvents?.length) return feedItems
  const seen = new Set()
  const qa = qaEvents
    .map(qaEventToItem)
    .filter((item) => {
      if (!item || seen.has(item.qa.questionId)) return false
      seen.add(item.qa.questionId)
      return true
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, QA_PULSE_MAX)
  if (!qa.length) return feedItems

  const out = [...feedItems]
  let lastQaIndex = -2
  for (const item of qa) {
    const at = new Date(item.createdAt).getTime()
    let index = out.findIndex((it) => new Date(it.createdAt).getTime() < at)
    if (index === -1) index = out.length
    index = Math.max(index, lastQaIndex + 2)
    if (index > out.length) break
    out.splice(index, 0, item)
    lastQaIndex = index
  }
  return out
}

/** Page 1: the feed and the Q&A events load in parallel and are cached as one. */
async function fetchPageOne(pageSize) {
  const [feed, qaEvents] = await Promise.all([getHomeFeed({ limit: pageSize }), qaPulse()])
  return { ...feed, items: mergeQaIntoFeed(feed.items, qaEvents) }
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
  const { tick: qaHideTick } = useQaHides()

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
      const result = await getSWR(key, () => fetchPageOne(pageSize), {
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
          if (seen.has(item.id)) continue
          // Same gap as silentRefresh, reachable on scroll: a page-2+
          // row can be a 'finished'/'reviewed' twin of something already
          // rendered from an earlier page (id-based `seen` never catches
          // this — see isDuplicateCompletionOrReview's doc comment).
          if (isDuplicateCompletionOrReview(item, merged)) continue
          merged.push(item)
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
        () => fetchPageOne(pageSize),
        { ttlMs: FEED_TTL_MS, force: true }
      )
      prefetchRowInteractions(result.items)
      setItems((prev) => {
        const seen = new Set(prev.map((it) => it.id))
        // BUG 2 fix: id alone doesn't catch a finish + a same-session
        // review for the same game — an activity_events row and a
        // reviews row for the same completion have two different ids,
        // so both used to pass this filter and both sat on screen until
        // the next full re-fetch replaced the list wholesale.
        // Q&A rows are skipped: this refresh answers the viewer's own
        // mutation, and a Q&A row prepended here would break the page's
        // "two at most, never adjacent" placement. The cached page 1 above
        // already holds them for the next entry.
        const fresh = result.items.filter(
          (it) => !isQaPulseItem(it) && !seen.has(it.id) && !isDuplicateCompletionOrReview(it, prev)
        )
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

  useEffect(() => {
    function onPulseItemRemoved(e) {
      const id = e?.detail?.id
      if (!id) return
      setItems((prev) => prev.filter((it) => it.id !== id))
      if (user?.id) {
        updateSWR(`home:feed:${user.id}:${pageSize}`, (data) => {
          if (!data?.items) return data
          return { ...data, items: data.items.filter((it) => it.id !== id) }
        })
      }
    }
    window.addEventListener(PULSE_ITEM_REMOVED, onPulseItemRemoved)
    return () => window.removeEventListener(PULSE_ITEM_REMOVED, onPulseItemRemoved)
  }, [user?.id, pageSize])

  // Q&A rows ride in the cached page, so reporting a question has to take
  // effect here rather than wait for a refetch.
  const visibleItems = useMemo(
    () =>
      items.some(isQaPulseItem)
        ? items.filter((it) => !isQaPulseItem(it) || !isQaQuestionHidden(it.qa.questionId))
        : items,
    [items, qaHideTick]
  )

  return { items: visibleItems, loading, loadingMore, hasMore, scope, error, refresh, loadMore }
}

export default useHomeFeed

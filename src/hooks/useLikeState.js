import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import {
  isLiked,
  getLikeCount,
  getLikeCountsForReviews,
} from '../services/likeService'

/**
 * useLikeState — Sprint 6 P0
 *
 * Drop-in replacement for the now-deleted `useLikeState` from
 * src/utils/likes.js. Returns `{ liked, count }` so ReviewCard's
 * existing usage works unchanged; the only difference is that the
 * value is now Supabase-backed and shared across devices.
 *
 * Architecture:
 *   - In-process Map cache keyed by reviewId. Many cards rendering
 *     the same review share one entry, so a like in the Profile
 *     Reviews tab updates the same review on the Home timeline
 *     without any extra fetches.
 *   - Map-based pub/sub (no React Query dependency — kept simple).
 *   - `publishLikeState(reviewId, next)` is the single mutator;
 *     ReviewCard's optimistic-update handler calls it directly,
 *     which is also how rollback works (publish twice — once
 *     optimistically, once on the error path).
 *   - On mount the hook checks the cache first; only fires the
 *     per-review SELECT EXISTS + COUNT pair when no cached entry
 *     exists. Lists / timelines should call
 *     `prefetchLikeStatesForReviews(ids)` after fetching their rows
 *     so individual cards render with correct values on first paint
 *     without firing N round-trips.
 */

const stateCache = new Map()
const subscribers = new Map()

// Review ids covered by a prefetch that hasn't resolved yet. Without this,
// every card in a freshly-rendered list round-trips individually in the
// window between the prefetch being fired and its results landing.
const inFlight = new Set()

function readCache(reviewId) {
  return stateCache.get(reviewId) || { liked: false, count: 0 }
}

/**
 * Push a new like state for `reviewId` into the cache and notify
 * all mounted hooks watching it. Used both for fetched values and
 * for the optimistic/rollback updates fired from ReviewCard.
 */
export function publishLikeState(reviewId, next) {
  if (!reviewId) return
  stateCache.set(reviewId, next)
  const subs = subscribers.get(reviewId)
  if (subs) subs.forEach((cb) => cb(next))
}

function subscribe(reviewId, cb) {
  if (!subscribers.has(reviewId)) subscribers.set(reviewId, new Set())
  subscribers.get(reviewId).add(cb)
  return () => {
    const s = subscribers.get(reviewId)
    if (!s) return
    s.delete(cb)
    if (s.size === 0) subscribers.delete(reviewId)
  }
}

export function useLikeState(reviewId) {
  const [state, setState] = useState(() => readCache(reviewId))

  useEffect(() => {
    if (!reviewId) return undefined
    // Re-read on id change so a parent swapping reviews (rare, but
    // possible in the demo screen) gets the right initial value.
    setState(readCache(reviewId))
    const unsubscribe = subscribe(reviewId, setState)

    let cancelled = false
    // Only round-trip when the cache is cold for this review and no
    // batch prefetch already covers it. Lists call
    // prefetchLikeStatesForReviews up-front so this typically no-ops
    // on timeline cards.
    if (!stateCache.has(reviewId) && !inFlight.has(reviewId)) {
      Promise.all([isLiked(reviewId), getLikeCount(reviewId)])
        .then(([liked, count]) => {
          if (cancelled) return
          publishLikeState(reviewId, { liked, count })
        })
        .catch(() => {
          /* soft-fail — render keeps {liked:false, count:0} */
        })
    }

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [reviewId])

  return state
}

/**
 * Batch-prefetch like counts AND the signed-in user's liked-set
 * for an array of review IDs, then seed the in-process cache so
 * mounted ReviewCards render with correct values on first paint.
 *
 * Two queries total:
 *   1. likes count per review_id (via getLikeCountsForReviews)
 *   2. SELECT review_id FROM likes WHERE user_id = me AND review_id IN (...)
 *
 * The count query and the auth lookup don't depend on each other, so
 * they're fired together via Promise.all instead of waiting on counts
 * before even starting the auth round-trip — only the liked-set query
 * itself has a real dependency (it needs the resolved user id).
 *
 * Returns the count Map so callers (TimelineFeed, Profile, GameDetail)
 * can use it directly for sort comparisons without re-querying.
 *
 * Signed-out callers still get accurate counts; the liked-set is
 * just empty.
 */
export async function prefetchLikeStatesForReviews(reviewIds) {
  if (!reviewIds || reviewIds.length === 0) return new Map()

  // Marked on the synchronous path, before the first await, so cards
  // mounting later in the same tick defer to this batch.
  const pending = reviewIds.filter((id) => id && !stateCache.has(id))
  for (const id of pending) inFlight.add(id)

  try {
    const [counts, userResult] = await Promise.all([
      getLikeCountsForReviews(reviewIds),
      supabase.auth.getUser().catch(() => ({ data: { user: null } })),
    ])

    let likedSet = new Set()
    try {
      const user = userResult?.data?.user
      if (user) {
        const { data, error } = await supabase
          .from('review_likes')
          .select('review_id')
          .eq('user_id', user.id)
          .in('review_id', reviewIds)
        if (!error && data) {
          likedSet = new Set(data.map((r) => r.review_id))
        }
      }
    } catch {
      // Soft-fail — counts still seed the cache below.
    }

    for (const id of reviewIds) {
      publishLikeState(id, {
        liked: likedSet.has(id),
        count: counts.get(id) || 0,
      })
    }

    return counts
  } finally {
    for (const id of pending) inFlight.delete(id)
  }
}

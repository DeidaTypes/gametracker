import { useCallback, useEffect, useState } from 'react'
import {
  addReaction,
  removeReaction,
  getReactions,
  getReactionsBatch,
} from '../services/reactionService'
import { hapticImpact } from '../utils/haptics'
import { showToast } from '../components/Toast'

// Same glyph activity hearts are stored as (U+2764 U+FE0F). Other emojis
// are not likes.
const ACTIVITY_LIKE_EMOJI = '\u2764\uFE0F'

/**
 * useReactions — shared reaction state for all surfaces.
 *
 * Mirrors the useLikeState pattern: in-process Map cache + pub/sub so
 * the same target rendered in multiple places stays in sync without
 * extra round-trips.
 *
 * Returns:
 *   {
 *     reactions: Array<{ emoji, count, reacted }>,
 *     toggle:    (emoji: string) => void
 *   }
 *
 * `reactions` only includes emojis with count > 0. Zero-count entries
 * collapse automatically after a rollback, matching the acceptance
 * criterion "zero collapses".
 *
 * Usage:
 *   const { reactions, toggle } = useReactions('review', reviewId)
 *   const { reactions, toggle } = useReactions('comment', commentId)
 */

const stateCache = new Map()
const subscribers = new Map()

// Keys covered by a batch fetch that hasn't resolved yet. Mounting hooks
// check this so a list of N cards waits on the one batch instead of each
// firing its own round-trip in the window before the batch lands.
const inFlight = new Set()

// Keys with a toggle() mutation currently in flight. Separate from the
// batch-fetch `inFlight` above (different lifecycle) — this guards a
// double-tap/rapid-toggle from firing a second add/removeReaction write
// for the same target+emoji before the first one resolves.
const mutationInFlight = new Set()

function cacheKey(targetType, targetId) {
  return `${targetType}::${targetId}`
}

function readCache(targetType, targetId) {
  return stateCache.get(cacheKey(targetType, targetId)) || []
}

// Each entry records whether the *viewer* reacted, so this cache is
// account-scoped and must not survive a user switch. See the matching
// listener in useLikeState.js for why the teardown broadcasts instead of
// importing this module.
if (typeof window !== 'undefined') {
  window.addEventListener('gt:user-data-cleared', () => {
    stateCache.clear()
    inFlight.clear()
    subscribers.forEach((subs) => subs.forEach((cb) => cb([])))
  })
}

export function publishReactionState(targetType, targetId, next) {
  const key = cacheKey(targetType, targetId)
  // Collapse zero-count entries before storing so every subscriber
  // receives the canonical "non-zero only" array.
  const filtered = next.filter((r) => r.count > 0)
  stateCache.set(key, filtered)
  const subs = subscribers.get(key)
  if (subs) subs.forEach((cb) => cb(filtered))
}

function subscribe(targetType, targetId, cb) {
  const key = cacheKey(targetType, targetId)
  if (!subscribers.has(key)) subscribers.set(key, new Set())
  subscribers.get(key).add(cb)
  return () => {
    const s = subscribers.get(key)
    if (!s) return
    s.delete(cb)
    if (s.size === 0) subscribers.delete(key)
  }
}

/**
 * Pre-seed the cache with batch-fetched data so mounted Reactions
 * components render with correct values on first paint without
 * firing individual round-trips.
 *
 * @param {string} targetType
 * @param {Map<string, Array<{emoji,count,reacted}>>} batchMap
 */
export function seedReactionsBatch(targetType, batchMap) {
  for (const [targetId, summary] of batchMap.entries()) {
    publishReactionState(targetType, targetId, summary)
  }
}

/**
 * Fetch reactions for a whole list in one round-trip and seed the cache.
 *
 * Call this synchronously *before* setting the state that renders the
 * cards: the ids are marked in-flight on the synchronous path, so the
 * hooks mounting a tick later skip their own fetch and simply wait for
 * this batch to publish.
 *
 * Ids already cached are skipped (no second query for the same ids).
 * Targets with no reactions are published as empty arrays so they don't
 * get re-fetched on the next mount.
 *
 * Returns Map<targetId, Array<{emoji, count, reacted}>> covering every
 * requested id that was cached or just fetched. Callers that need the
 * heart count (getHomeFeed) read this map instead of querying again.
 *
 * @param {string} targetType
 * @param {Array<string>} targetIds
 * @returns {Promise<Map<string, Array<{emoji, count, reacted}>>>}
 */
export async function prefetchReactionsBatch(targetType, targetIds, viewerId = null) {
  const result = new Map()
  if (!targetType || !targetIds || targetIds.length === 0) return result

  const unique = [...new Set(targetIds.filter(Boolean))]
  const fresh = []
  for (const id of unique) {
    const key = cacheKey(targetType, id)
    if (stateCache.has(key)) result.set(id, readCache(targetType, id))
    else fresh.push(id)
  }
  if (fresh.length === 0) return result

  // Synchronous — MessagesThread relies on this happening before the
  // first await so mounted hooks see the ids as in-flight.
  for (const id of fresh) inFlight.add(cacheKey(targetType, id))
  try {
    const batch = await getReactionsBatch(targetType, fresh, viewerId)
    seedReactionsBatch(targetType, batch)
    for (const [id, summary] of batch.entries()) result.set(id, summary)
  } catch {
    // Soft-fail — cards keep their empty array, same as a failed
    // individual fetch.
  } finally {
    for (const id of fresh) inFlight.delete(cacheKey(targetType, id))
  }
  return result
}

export function useReactions(targetType, targetId) {
  const [reactions, setReactions] = useState(() => readCache(targetType, targetId))

  useEffect(() => {
    if (!targetType || !targetId) return undefined
    setReactions(readCache(targetType, targetId))
    const unsubscribe = subscribe(targetType, targetId, setReactions)

    let cancelled = false
    const key = cacheKey(targetType, targetId)
    if (!stateCache.has(key) && !inFlight.has(key)) {
      getReactions(targetType, targetId)
        .then((data) => {
          if (!cancelled) publishReactionState(targetType, targetId, data)
        })
        .catch(() => {
          /* soft-fail — keep empty array */
        })
    }

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [targetType, targetId])

  const toggle = useCallback(
    async (emoji) => {
      if (!emoji || !targetType || !targetId) return

      // Guard against a double-tap/rapid-toggle on the same emoji firing a
      // second add/removeReaction write before the first resolves.
      const mutationKey = `${cacheKey(targetType, targetId)}::${emoji}`
      if (mutationInFlight.has(mutationKey)) return
      mutationInFlight.add(mutationKey)

      const prev = readCache(targetType, targetId)
      const existing = prev.find((r) => r.emoji === emoji)
      const wasReacted = existing?.reacted ?? false
      const isActivityLike = targetType === 'activity' && emoji === ACTIVITY_LIKE_EMOJI

      // Activity hearts haptic only when the like is added, and before
      // the write so it feels instant. Removing a like is silent.
      // Every other reaction (comment emoji pills included) keeps the
      // existing tap haptic.
      if (!isActivityLike || !wasReacted) hapticImpact('Light')

      // Optimistic update
      let optimistic
      if (wasReacted) {
        optimistic = prev
          .map((r) =>
            r.emoji === emoji ? { ...r, count: r.count - 1, reacted: false } : r
          )
          .filter((r) => r.count > 0)
      } else {
        const found = prev.find((r) => r.emoji === emoji)
        if (found) {
          optimistic = prev.map((r) =>
            r.emoji === emoji ? { ...r, count: r.count + 1, reacted: true } : r
          )
        } else {
          optimistic = [...prev, { emoji, count: 1, reacted: true }]
        }
      }
      publishReactionState(targetType, targetId, optimistic)

      try {
        if (wasReacted) {
          await removeReaction(targetType, targetId, emoji)
        } else {
          await addReaction(targetType, targetId, emoji)
        }
      } catch (err) {
        // Roll back
        publishReactionState(targetType, targetId, prev)
        console.error('[useReactions] toggle failed, rolled back:', err.message)
        if (isActivityLike) showToast("Couldn't save your like", 'error', null, null, null, { sub: 'Try again' })
      } finally {
        mutationInFlight.delete(mutationKey)
      }
    },
    [targetType, targetId]
  )

  return { reactions, toggle }
}

import { useCallback, useEffect, useState } from 'react'
import {
  addReaction,
  removeReaction,
  getReactions,
  getReactionsBatch,
} from '../services/reactionService'

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
 * Ids already cached are skipped. Targets with no reactions are published
 * as empty arrays so they don't get re-fetched on the next mount.
 *
 * @param {string} targetType
 * @param {Array<string>} targetIds
 */
export async function prefetchReactionsBatch(targetType, targetIds) {
  if (!targetType || !targetIds || targetIds.length === 0) return

  const fresh = [
    ...new Set(
      targetIds.filter((id) => id && !stateCache.has(cacheKey(targetType, id)))
    ),
  ]
  if (fresh.length === 0) return

  for (const id of fresh) inFlight.add(cacheKey(targetType, id))
  try {
    seedReactionsBatch(targetType, await getReactionsBatch(targetType, fresh))
  } catch {
    // Soft-fail — cards keep their empty array, same as a failed
    // individual fetch.
  } finally {
    for (const id of fresh) inFlight.delete(cacheKey(targetType, id))
  }
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

      const prev = readCache(targetType, targetId)
      const existing = prev.find((r) => r.emoji === emoji)
      const wasReacted = existing?.reacted ?? false

      // Haptic feedback (Capacitor) — fire-and-forget, never blocks
      try {
        const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
        Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
      } catch {
        // plugin unavailable on web
      }

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
      }
    },
    [targetType, targetId]
  )

  return { reactions, toggle }
}

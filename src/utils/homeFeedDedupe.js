// Home Pulse feed — client-side merge dedupe (BUG 2 fix).
//
// communityService.getHomeFeed's own _suppressNearbyCompletions already
// drops a completion card server-side when a nearby review-with-body
// exists for the same (actor, game) within a 24h window — but that only
// works WITHIN a single fetch's own row set. useHomeFeed's silentRefresh
// and loadMore each merge a NEW fetch's rows into the items already on
// screen from a PRIOR fetch by id alone, which misses this case: a
// finish (an `activity_events` row) and a review-with-body (a `reviews`
// row) for the same completion get two different ids, so both pass an
// id-based "already seen" filter and both stay on screen simultaneously
// until a full re-fetch (mount / pull-to-refresh) replaces the whole
// list wholesale and re-applies the server-side suppression from
// scratch.
//
// Pulled into its own module (rather than living inline in
// useHomeFeed.js) so it's importable from a plain Node test without
// pulling in React/Supabase — see homeFeedDedupe.test.js.

// Types that represent "I finished this game" on screen — a completion
// card (type 'finished') and a review-with-body (type 'reviewed') for
// the same (actor, game) are the same real-world event told two ways.
export const COMPLETION_REVIEW_TYPES = new Set(['finished', 'reviewed'])

// Mirrors communityService.js's REVIEW_COMPLETION_DEDUPE_MS. Duplicated
// rather than imported because that constant is private to the
// server-side suppression function — this is a separate, client-side
// merge-time guard, not a call into that logic (FIX 2's constraint:
// don't touch the server-side window/logic).
export const REVIEW_COMPLETION_DEDUPE_MS = 24 * 60 * 60 * 1000

/**
 * True when `candidate` (a freshly-fetched item) is the same real-world
 * completion as something already sitting in `onScreen` — same actor,
 * same game, one of them a 'finished' card and the other a 'reviewed'
 * card (or both the same type), within the server's own 24h dedupe
 * window. Only ever compares within COMPLETION_REVIEW_TYPES — a
 * 'finished'/'reviewed' item for a DIFFERENT game, or any other item
 * type entirely, never matches.
 *
 * @param {{type:string, author?:{id?:string}, game?:{id?:string|number}, createdAt:string}} candidate
 * @param {Array<{type:string, author?:{id?:string}, game?:{id?:string|number}, createdAt:string}>} onScreen
 * @returns {boolean}
 */
export function isDuplicateCompletionOrReview(candidate, onScreen) {
  if (!candidate || !COMPLETION_REVIEW_TYPES.has(candidate.type)) return false
  const actorId = candidate.author?.id
  const gameId = candidate.game?.id
  if (!actorId || gameId == null) return false
  const candidateMs = new Date(candidate.createdAt).getTime()
  if (!Number.isFinite(candidateMs)) return false

  return (onScreen || []).some((it) => {
    if (!it || !COMPLETION_REVIEW_TYPES.has(it.type)) return false
    if (it.author?.id !== actorId) return false
    if (it.game?.id == null) return false
    if (String(it.game.id) !== String(gameId)) return false
    const existingMs = new Date(it.createdAt).getTime()
    if (!Number.isFinite(existingMs)) return false
    return Math.abs(existingMs - candidateMs) <= REVIEW_COMPLETION_DEDUPE_MS
  })
}

const MOMENT_TYPES = new Set(['started', 'finished'])

/**
 * Identity of one Home "moment": a start or a finish by one person for
 * one game. Reviews, lists, sessions, and rows missing an author or
 * game have no key and are never collapsed by it.
 *
 * @param {{type?:string, author?:{id?:string}, game?:{id?:string|number}}} item
 * @returns {string|null}
 */
export function momentKey(item) {
  if (!item || !MOMENT_TYPES.has(item.type)) return null
  const authorId = item.author?.id
  const gameId = item.game?.id
  if (!authorId || gameId == null) return null
  return `${item.type}|${authorId}|${gameId}`
}

function personGameKey(item) {
  const authorId = item?.author?.id
  const gameId = item?.game?.id
  if (!authorId || gameId == null) return null
  return `${authorId}|${gameId}`
}

function createdMs(item) {
  const ms = new Date(item?.createdAt).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * One post per person, per game, per kind. `items` arrive newest first.
 * The first item of each `momentKey` stays; later repeats drop. A
 * 'started' item also drops when the same author has a 'finished' or
 * 'reviewed' item for the same game with a greater `createdAt` anywhere
 * in the array. Rows without a key pass through. Order of what remains
 * is unchanged.
 *
 * @param {Array<object>} items
 * @returns {Array<object>}
 */
export function collapseRepeatMoments(items) {
  if (!Array.isArray(items) || items.length === 0) return Array.isArray(items) ? items : []

  const newerFinishOrReviewMs = new Map()
  for (const it of items) {
    if (!it || (it.type !== 'finished' && it.type !== 'reviewed')) continue
    const pk = personGameKey(it)
    if (!pk) continue
    const ms = createdMs(it)
    if (ms == null) continue
    const prev = newerFinishOrReviewMs.get(pk)
    if (prev == null || ms > prev) newerFinishOrReviewMs.set(pk, ms)
  }

  const seen = new Set()
  const out = []
  for (const it of items) {
    const key = momentKey(it)
    if (!key) {
      out.push(it)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    if (it.type === 'started') {
      const ms = createdMs(it)
      const newer = newerFinishOrReviewMs.get(personGameKey(it))
      if (ms != null && newer != null && newer > ms) continue
    }
    out.push(it)
  }
  return out
}

/**
 * True when `candidate` repeats a moment already in `onScreen`: same
 * start or finish for the same person and game, or a 'started' candidate
 * whose author already has a 'finished' or 'reviewed' item for that game
 * on screen.
 *
 * @param {object} candidate
 * @param {Array<object>} onScreen
 * @returns {boolean}
 */
export function isRepeatMoment(candidate, onScreen) {
  if (!candidate) return false
  const screen = Array.isArray(onScreen) ? onScreen : []
  const key = momentKey(candidate)
  if (key && screen.some((it) => momentKey(it) === key)) return true
  if (candidate.type !== 'started') return false
  const pk = personGameKey(candidate)
  if (!pk) return false
  return screen.some((it) => {
    if (!it || (it.type !== 'finished' && it.type !== 'reviewed')) return false
    return personGameKey(it) === pk
  })
}

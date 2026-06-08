import { supabase } from './supabase'

/**
 * Block Service — Supabase-backed user blocking.
 *
 * Schema (run `supabase/blocked_users.sql` in the Supabase SQL editor
 * before this code is exercised):
 *
 *   CREATE TABLE blocked_users (
 *     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     blocker_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *     blocked_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *     created_at  timestamptz NOT NULL DEFAULT now(),
 *     UNIQUE(blocker_id, blocked_id),
 *     CHECK(blocker_id != blocked_id)
 *   );
 *
 * Reads are filtered by an in-memory cache that's loaded on first
 * access and refreshed whenever the current user blocks or unblocks
 * someone. Service callers (reviewService, commentService,
 * messageService, activityService) call `loadBlockedIds()` once at
 * the start of a fetch and then build a `not.in` filter against the
 * combined `blocked-by-me` ∪ `blocked-me` set.
 *
 * Cache behaviour:
 *   - first call hydrates from Supabase, returns the Set
 *   - subsequent calls return the cached Set synchronously via
 *     `getBlockedIdsSync()` (returns null if not yet hydrated, so
 *     callers can decide whether to await loadBlockedIds() first)
 *   - signing out clears the cache via `clearBlockCache()`
 */

let _cache = null
let _cachedUserId = null
let _hydratePromise = null

/* ============================================================
   Auth helper
   ============================================================ */

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error) {
    console.error('[blocks] auth.getUser failed:', error.message)
    return null
  }
  return user?.id || null
}

/* ============================================================
   Cache
   ============================================================ */

export function clearBlockCache() {
  _cache = null
  _cachedUserId = null
  _hydratePromise = null
}

/**
 * Synchronous read for callers that have already hydrated. Returns:
 *   - { selfBlocked: Set<string>, blockedMe: Set<string>, all: Set<string> }
 *   - null if the cache hasn't been populated yet
 */
export function getBlockedIdsSync() {
  return _cache
}

/**
 * Hydrate the block cache for the current user. Returns the same
 * shape as getBlockedIdsSync. Soft-fails to empty Sets on error so
 * a flaky network never blocks downstream reads.
 *
 * Safe to call repeatedly — multiple in-flight calls share the same
 * promise so we never double-fetch.
 */
export async function loadBlockedIds() {
  // Fast-path A: join any in-flight hydration without an extra auth round-trip
  if (_hydratePromise) return _hydratePromise
  // Fast-path B: warm cache for the same user. clearBlockCache() is called on
  // sign-out so _cachedUserId going non-null always implies the current user.
  if (_cache && _cachedUserId) return _cache

  const _t0 = Date.now()
  const userId = await getCurrentUserId()
  if (import.meta.env.DEV) console.log(`[⏱ blocks] auth.getUser(): ${Date.now() - _t0}ms`)
  if (!userId) {
    _cache = { selfBlocked: new Set(), blockedMe: new Set(), all: new Set() }
    _cachedUserId = null
    return _cache
  }

  if (_hydratePromise) return _hydratePromise

  _hydratePromise = (async () => {
    const _t0 = Date.now()
    try {
      const { data, error } = await supabase
        .from('blocked_users')
        .select('blocker_id, blocked_id')
        .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`)
      if (import.meta.env.DEV) console.log(`[⏱ blocks] blocked_users query: ${Date.now() - _t0}ms`)
      if (error) {
        console.error('[blocks] loadBlockedIds failed:', error.message)
        _cache = {
          selfBlocked: new Set(),
          blockedMe: new Set(),
          all: new Set(),
        }
      } else {
        const selfBlocked = new Set()
        const blockedMe = new Set()
        for (const row of data || []) {
          if (row.blocker_id === userId) selfBlocked.add(row.blocked_id)
          if (row.blocked_id === userId) blockedMe.add(row.blocker_id)
        }
        const all = new Set([...selfBlocked, ...blockedMe])
        _cache = { selfBlocked, blockedMe, all }
      }
      _cachedUserId = userId
      return _cache
    } finally {
      _hydratePromise = null
    }
  })()
  return _hydratePromise
}

/**
 * Convenience: returns just the union Set as an Array, after
 * hydrating if needed. The most common shape callers need for an
 * `.not('user_id', 'in', `(...)`)` Supabase filter.
 */
export async function getBlockedIdsArray() {
  const cache = await loadBlockedIds()
  return Array.from(cache.all)
}

/**
 * Synchronous version of the above. Returns [] when the cache hasn't
 * been hydrated yet. Use this for client-side filters where the
 * fetch is already in flight (timeline, feeds) so render isn't
 * blocked by the round-trip.
 */
export function getBlockedIdsArraySync() {
  if (!_cache) return []
  return Array.from(_cache.all)
}

/**
 * Apply a `not.in.(...)` filter on the supplied Supabase query
 * builder for the given column, using the current user's combined
 * blocked-by-me ∪ blocked-me set. Hydrates the cache first if
 * necessary so the filter is always accurate.
 *
 * Returns the (possibly modified) query builder so callers can chain.
 *
 * Usage:
 *   let q = supabase.from('reviews').select('*').eq('igdb_game_id', id)
 *   q = await applyBlockFilter(q, 'user_id')
 *   const { data } = await q
 */
export async function applyBlockFilter(query, column) {
  if (!query || !column) return query
  try {
    const cache = await loadBlockedIds()
    const ids = Array.from(cache.all)
    if (ids.length === 0) return query
    return query.not(column, 'in', `(${ids.join(',')})`)
  } catch {
    // Network / auth flake — skip the filter rather than block render.
    // The block table is server-side enforced via RLS for the writer side
    // (you can't see what blocked-you wrote about you on a personal feed
    // because the join target row often hides via your own filter
    // on subsequent fetches anyway).
    return query
  }
}

/**
 * Filter an already-fetched array of rows in place so any row whose
 * `column` value matches the current user's blocked-set is removed.
 *
 * Useful for surfaces where the underlying query couldn't carry a
 * server-side `not.in` (eg. joins via PostgREST embedded selects) —
 * we still get the correct visible result by post-filtering.
 *
 * Returns a new array; the input is not mutated.
 */
export function filterBlockedRows(rows, column) {
  if (!Array.isArray(rows) || rows.length === 0) return rows || []
  if (!_cache || _cache.all.size === 0) return rows
  const blocked = _cache.all
  return rows.filter((row) => row && !blocked.has(row?.[column]))
}

/* ============================================================
   Mutations
   ============================================================ */

/**
 * Block `targetUserId`. Idempotent — re-blocking an already-blocked
 * user resolves silently (Postgres unique-violation 23505 swallowed).
 */
export async function blockUser(targetUserId) {
  if (!targetUserId) throw new Error('targetUserId is required')
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to block.')
  if (userId === targetUserId) {
    throw new Error("You can't block yourself.")
  }

  const { error } = await supabase
    .from('blocked_users')
    .insert({ blocker_id: userId, blocked_id: targetUserId })

  if (error && error.code !== '23505') {
    console.error('[blocks] blockUser failed:', error.message)
    throw new Error(error.message)
  }

  if (_cache) {
    _cache.selfBlocked.add(targetUserId)
    _cache.all.add(targetUserId)
  }
  emitBlockChanged({ targetUserId, blocked: true })
}

export async function unblockUser(targetUserId) {
  if (!targetUserId) throw new Error('targetUserId is required')
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to unblock.')

  const { error } = await supabase
    .from('blocked_users')
    .delete()
    .eq('blocker_id', userId)
    .eq('blocked_id', targetUserId)

  if (error) {
    console.error('[blocks] unblockUser failed:', error.message)
    throw new Error(error.message)
  }

  if (_cache) {
    _cache.selfBlocked.delete(targetUserId)
    if (!_cache.blockedMe.has(targetUserId)) {
      _cache.all.delete(targetUserId)
    }
  }
  emitBlockChanged({ targetUserId, blocked: false })
}

/**
 * List the users that the current user has blocked, with display
 * fields joined for the Blocked Users settings page.
 *
 * @returns {Promise<Array<{
 *   blocked_id: string,
 *   created_at: string,
 *   user: { id: string, username: string, display_name: string, avatar_url: string }
 * }>>}
 */
export async function listBlockedUsers() {
  const userId = await getCurrentUserId()
  if (!userId) return []

  const { data, error } = await supabase
    .from('blocked_users')
    .select(
      'blocked_id, created_at, user:users!blocked_id(id, username, display_name, avatar_url)'
    )
    .eq('blocker_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[blocks] listBlockedUsers failed:', error.message)
    return []
  }
  return data || []
}

/**
 * Synchronous boolean — true if the current user has blocked
 * `targetUserId` OR `targetUserId` has blocked the current user.
 * Returns false when the cache hasn't been hydrated yet (caller
 * should hydrate before relying on this for security-sensitive
 * decisions; the source-of-truth check happens server-side via
 * RLS / not-in filters anyway).
 */
export function isMutuallyBlocked(targetUserId) {
  if (!_cache) return false
  return _cache.all.has(targetUserId)
}

/* ============================================================
   Cross-surface change event
   ============================================================ */

export const BLOCK_CHANGED_EVENT = 'gtBlockChanged'

function emitBlockChanged(detail) {
  try {
    window.dispatchEvent(
      new CustomEvent(BLOCK_CHANGED_EVENT, { detail })
    )
  } catch {
    /* noop */
  }
}

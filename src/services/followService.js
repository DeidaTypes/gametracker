import { supabase } from './supabase'
import { applyBlockFilter } from './blockService'

/**
 * Follow Service — Supabase-backed.
 *
 * Schema (run in the Supabase SQL editor before this code is exercised):
 *
 *   CREATE TABLE follows (
 *     follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *     followee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *     created_at  timestamptz NOT NULL DEFAULT now(),
 *     PRIMARY KEY (follower_id, followee_id),
 *     CHECK (follower_id != followee_id)
 *   );
 *
 *   CREATE INDEX follows_followee_idx
 *     ON follows(followee_id, created_at DESC);
 *
 *   ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
 *
 *   CREATE POLICY follows_select_all ON follows
 *     FOR SELECT USING (true);
 *
 *   CREATE POLICY follows_insert_self ON follows
 *     FOR INSERT WITH CHECK (auth.uid() = follower_id);
 *
 *   CREATE POLICY follows_delete_self ON follows
 *     FOR DELETE USING (auth.uid() = follower_id);
 *
 * The pattern mirrors src/services/reviewService.js:
 *   - all writes pull auth.uid() from supabase.auth.getUser()
 *   - errors are logged via console.error and rethrown so callers can
 *     run their own optimistic-rollback logic
 *   - reads fail soft (return [] / 0 / false) since follower counts and
 *     follow-state checks should never block a render
 */

/**
 * Custom event broadcast whenever the signed-in user follows or
 * unfollows someone. Profile screens listen for this so the follower
 * numeral on the *target* profile updates in real time when YOU
 * follow them from somewhere else (eg. the Search Users tab).
 *
 *   detail: { followeeId: string, following: boolean }
 */
export const FOLLOW_CHANGED_EVENT = 'followChanged'

function emitFollowChanged(followeeId, following) {
  try {
    window.dispatchEvent(
      new CustomEvent(FOLLOW_CHANGED_EVENT, {
        detail: { followeeId, following },
      })
    )
  } catch {
    // SSR / no-window — best effort.
  }
}

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error) {
    console.error('[follows] auth.getUser failed:', error.message)
    return null
  }
  return user?.id || null
}

/* ============================================================
   Mutations
   ============================================================ */

/**
 * INSERT a row representing the current user following `followeeId`.
 * Idempotent — re-following an already-followed user resolves silently
 * (Postgres unique-violation 23505 swallowed) so optimistic UI races
 * don't surface as errors.
 *
 * RLS enforces follower_id = auth.uid(); the table CHECK constraint
 * blocks self-follows.
 */
export async function followUser(followeeId) {
  if (!followeeId) throw new Error('followeeId is required')
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to follow.')
  if (userId === followeeId) {
    // Defensive — RLS + CHECK constraint will also reject this server-side.
    throw new Error("You can't follow yourself.")
  }

  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: userId, followee_id: followeeId })

  if (error) {
    // Postgres unique_violation — already following. Treat as success
    // so callers can rely on the call being idempotent.
    if (error.code === '23505') {
      emitFollowChanged(followeeId, true)
      return
    }
    console.error('[follows] followUser failed:', error.message)
    throw new Error(error.message)
  }

  emitFollowChanged(followeeId, true)
}

/**
 * DELETE the row that represents the current user following
 * `followeeId`. No-op when no row exists — matches the idempotent
 * shape of followUser so retry logic stays simple.
 *
 * RLS enforces follower_id = auth.uid().
 */
export async function unfollowUser(followeeId) {
  if (!followeeId) throw new Error('followeeId is required')
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to unfollow.')

  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', userId)
    .eq('followee_id', followeeId)

  if (error) {
    console.error('[follows] unfollowUser failed:', error.message)
    throw new Error(error.message)
  }

  emitFollowChanged(followeeId, false)
}

/* ============================================================
   Reads
   ============================================================ */

/**
 * Returns true if the signed-in user follows `followeeId`. Returns
 * false for signed-out callers, missing args, and self-checks so the
 * caller never has to special-case the "this is me" path.
 */
export async function isFollowing(followeeId) {
  if (!followeeId) return false
  const userId = await getCurrentUserId()
  if (!userId) return false
  if (userId === followeeId) return false

  const { data, error } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', userId)
    .eq('followee_id', followeeId)
    .maybeSingle()

  if (error) {
    console.error('[follows] isFollowing failed:', error.message)
    return false
  }
  return !!data
}

/**
 * Number of users following `userId`. Soft-fails to 0 so the stat
 * numeral on Profile never blocks rendering.
 *
 * Blocked users are excluded with the same filter `getFollowers` uses,
 * so the numeral on the player card always equals the number of rows
 * the followers list actually renders.
 */
export async function getFollowerCount(userId) {
  if (!userId) return 0
  let query = supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('followee_id', userId)
  query = await applyBlockFilter(query, 'follower_id')
  const { count, error } = await query
  if (error) {
    console.error('[follows] getFollowerCount failed:', error.message)
    return 0
  }
  return count || 0
}

/**
 * Number of users `userId` follows. Soft-fails to 0. Excludes blocked
 * users to stay consistent with `getFollowing`.
 */
export async function getFollowingCount(userId) {
  if (!userId) return 0
  let query = supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('follower_id', userId)
  query = await applyBlockFilter(query, 'followee_id')
  const { count, error } = await query
  if (error) {
    console.error('[follows] getFollowingCount failed:', error.message)
    return 0
  }
  return count || 0
}

/**
 * Paginated list of users that `userId` follows. Joins the users
 * table on `followee_id` so the followers/following list page can
 * render avatar + username + display name without a follow-up
 * round-trip.
 *
 * The `users!followee_id` modifier disambiguates the foreign key —
 * `follows` references users via two columns and Supabase needs an
 * explicit hint to know which join to use.
 *
 * @param {string} userId
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<Array<{
 *   followee_id: string,
 *   created_at: string,
 *   followee: { id: string, username: string, display_name: string, avatar_url: string }
 * }>>}
 */
export async function getFollowing(userId, limit = 20, offset = 0) {
  if (!userId) return []
  const from = Math.max(0, offset)
  const to = from + Math.max(1, limit) - 1
  let query = supabase
    .from('follows')
    .select(
      'followee_id, created_at, followee:users!follows_followee_id_fkey(id, username, display_name, avatar_url)'
    )
    .eq('follower_id', userId)
    .order('created_at', { ascending: false })
    .range(from, to)
  // Filter out follow rows whose followee is in the current user's
  // blocked-set (either direction). The follower side is already the
  // viewed-profile owner, so the row column we filter is the followee.
  query = await applyBlockFilter(query, 'followee_id')
  const { data, error } = await query
  if (error) {
    console.error('[follows] getFollowing failed:', error.message)
    return []
  }
  return data || []
}

/**
 * Paginated list of users that follow `userId`. Joins on
 * `follower_id` so each row carries the follower's profile fields.
 *
 * @param {string} userId
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<Array<{
 *   follower_id: string,
 *   created_at: string,
 *   follower: { id: string, username: string, display_name: string, avatar_url: string }
 * }>>}
 */
export async function getFollowers(userId, limit = 20, offset = 0) {
  if (!userId) return []
  const from = Math.max(0, offset)
  const to = from + Math.max(1, limit) - 1
  let query = supabase
    .from('follows')
    .select(
      'follower_id, created_at, follower:users!follows_follower_id_fkey(id, username, display_name, avatar_url)'
    )
    .eq('followee_id', userId)
    .order('created_at', { ascending: false })
    .range(from, to)
  // Filter out follow rows whose follower is in the current user's
  // blocked-set (either direction).
  query = await applyBlockFilter(query, 'follower_id')
  const { data, error } = await query
  if (error) {
    console.error('[follows] getFollowers failed:', error.message)
    return []
  }
  return data || []
}

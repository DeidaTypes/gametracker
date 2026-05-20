import { supabase } from './supabase'

/**
 * Lightweight user lookups used by the Search screen's Users tab and
 * (eventually) the Profile-by-username route.
 *
 * Read-only — write paths for the `users` table live in auth.js
 * (signup bootstrap) and profileService (avatar / display_name updates).
 */

/**
 * Sprint 5 P3: Search users by username OR display_name, case-insensitive.
 * Returns up to `limit` rows. Empty query short-circuits to [].
 */
export async function searchUsers(query, limit = 20) {
  const trimmed = (query || '').trim()
  if (!trimmed) return []
  const escaped = trimmed.replace(/[\\%_]/g, (m) => `\\${m}`)
  const { data, error } = await supabase
    .from('users')
    .select('id, username, display_name, avatar_url')
    .or(`username.ilike.%${escaped}%,display_name.ilike.%${escaped}%`)
    .limit(limit)
  if (error) {
    console.error('[users] searchUsers failed:', error.message)
    return []
  }
  return data || []
}

/**
 * Look up a single user by their unique username (case-insensitive).
 * Returns null when no row matches so callers can render a clean
 * "user not found" state.
 */
export async function getUserByUsername(username) {
  const trimmed = (username || '').trim()
  if (!trimmed) return null
  const { data, error } = await supabase
    .from('users')
    .select('id, username, display_name, avatar_url, bio')
    .ilike('username', trimmed)
    .maybeSingle()
  if (error) {
    console.error('[users] getUserByUsername failed:', error.message)
    return null
  }
  return data || null
}

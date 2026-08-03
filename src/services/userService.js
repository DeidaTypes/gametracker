import { supabase } from './supabase'
import { applyBlockFilter } from './blockService'
import {
  ACTIVITY_EVENT_TYPES,
  logActivityEvent,
} from './activityEventsService'
import {
  AUTH_ERRORS,
  AuthError,
  USERNAME_PATTERN,
  normalizeUsername,
} from './auth'

/**
 * Lightweight user lookups used by the Search screen's Users tab and
 * the Profile-by-username route, plus the authoritative write path for
 * editable profile fields (display_name / username) on the `users` table.
 *
 * The signup-time bootstrap insert lives in auth.js; profileService owns
 * the localStorage mirror that the own-profile UI reads synchronously.
 */

/**
 * Sprint 5 P3: Search users by username OR display_name, case-insensitive.
 * Returns up to `limit` rows. Empty query short-circuits to [].
 *
 * Sprint 7: filters out users the current user has blocked or who
 * have blocked the current user.
 */
export async function searchUsers(query, limit = 20) {
  const trimmed = (query || '').trim()
  if (!trimmed) return []
  const escaped = trimmed.replace(/[\\%_]/g, (m) => `\\${m}`)
  let q = supabase
    .from('public_profiles')
    .select('id, username, display_name, avatar_url')
    .or(`username.ilike.%${escaped}%,display_name.ilike.%${escaped}%`)
    .limit(limit)
  q = await applyBlockFilter(q, 'id')
  const { data, error } = await q
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
    .from('public_profiles')
    .select('id, username, display_name, avatar_url, bio, favorite_games, current_obsessions')
    .ilike('username', trimmed)
    .maybeSingle()
  if (error) {
    console.error('[users] getUserByUsername failed:', error.message)
    return null
  }
  return data || null
}

/**
 * Look up a single user by their UUID. Used as a fallback navigation
 * target when a user has no username set — routes like /user/id/:userId
 * call this instead of getUserByUsername.
 *
 * @param {string} userId  UUID from auth.users / public.users
 * @returns {Promise<object|null>}
 */
export async function getUserById(userId) {
  const trimmed = (userId || '').trim()
  if (!trimmed) return null
  const { data, error } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, avatar_url, bio, favorite_games, current_obsessions')
    .eq('id', trimmed)
    .maybeSingle()
  if (error) {
    console.error('[users] getUserById failed:', error.message)
    return null
  }
  return data || null
}

/**
 * Persist editable profile fields to the authoritative `users` row. Used by
 * Edit Profile so that display name / username / favoriteGames changed after
 * signup are written server-side and survive a reinstall or a different device.
 *
 * Throws an AuthError(USERNAME_TAKEN) when the chosen handle collides with
 * another account so the caller can show a clean inline error.
 *
 * @param {string} userId
 * @param {{ displayName?: string, username?: string|null, bio?: string, avatarUrl?: string|null, favoriteGames?: Array, currentObsessions?: Array }} fields
 */
export async function updateUserProfile(userId, { displayName, username, bio, avatarUrl, favoriteGames, currentObsessions } = {}) {
  if (!userId) throw new Error('updateUserProfile requires a userId')

  const patch = {}
  if (displayName !== undefined) {
    const trimmed = (displayName || '').trim()
    if (trimmed) patch.display_name = trimmed
  }
  if (username !== undefined) {
    const handle = normalizeUsername(username)
    if (handle && !USERNAME_PATTERN.test(handle)) {
      throw new AuthError(
        AUTH_ERRORS.USERNAME_INVALID,
        'Username must be 3–20 characters (letters, numbers, underscores).'
      )
    }
    patch.username = handle || null
  }
  if (bio !== undefined) {
    patch.bio = (bio || '').trim() || null
  }
  if (avatarUrl !== undefined) {
    patch.avatar_url = avatarUrl || null
  }
  // Capture the pre-update favorites so we can emit one 'favorited'
  // activity_event per *newly added* game (covers existing ones are not
  // re-broadcast on every Save). Skipped when the caller isn't touching
  // favorites to keep the common write path round-trip-free.
  let previousFavoriteIds = null
  if (currentObsessions !== undefined) {
    patch.current_obsessions = (Array.isArray(currentObsessions) ? currentObsessions : [])
      .slice(0, 3)
      .map((g) => ({ id: g.id, title: g.title || '', image: g.image || null }))
  }
  if (favoriteGames !== undefined) {
    patch.favorite_games = (Array.isArray(favoriteGames) ? favoriteGames : [])
      .slice(0, 4)
      .map((g) => ({
        id: g.id,
        title: g.title || '',
        image: g.image || null,
        why: (g.why || '').trim() || null,
      }))
    try {
      const { data: existing } = await supabase
        .from('users')
        .select('favorite_games')
        .eq('id', userId)
        .maybeSingle()
      const prev = Array.isArray(existing?.favorite_games)
        ? existing.favorite_games
        : []
      previousFavoriteIds = new Set(prev.map((g) => String(g?.id)))
    } catch {
      // If the diff lookup fails, fall back to emitting events for the
      // full new list — best effort, never blocks the write.
      previousFavoriteIds = new Set()
    }
  }

  if (Object.keys(patch).length === 0) return

  const { error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', userId)

  if (error) {
    if (error.code === '23505') {
      throw new AuthError(
        AUTH_ERRORS.USERNAME_TAKEN,
        'That username is already taken. Please choose another.',
        error
      )
    }
    throw new AuthError(AUTH_ERRORS.UNKNOWN, error.message, error)
  }

  // Pulse — one 'favorited' event per *newly added* favorite. Diffing
  // by id means re-saving the same favorites (e.g. user reorders or
  // edits an unrelated field) does not emit duplicate events.
  if (favoriteGames !== undefined && patch.favorite_games) {
    const prev = previousFavoriteIds || new Set()
    for (const g of patch.favorite_games) {
      if (g?.id == null) continue
      if (prev.has(String(g.id))) continue
      logActivityEvent({
        type: ACTIVITY_EVENT_TYPES.FAVORITED,
        entityId: String(g.id),
        metadata: {
          game_title: g.title || null,
          game_image: g.image || null,
        },
      })
    }
  }
}

/**
 * Fetch public lists from all users that `userId` follows, ordered by most
 * recently updated, bounded to `limit`. Returns the same list shape as
 * getListsForUser so ListTile can render without adaptation.
 *
 * @param {string} userId  The current signed-in user id (the follower).
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function getListsFromFollowing(userId, limit = 8) {
  if (!userId) return []
  try {
    const { data: followRows, error: followErr } = await supabase
      .from('follows')
      .select('followee_id')
      .eq('follower_id', userId)
    if (followErr || !followRows?.length) return []

    const followeeIds = followRows.map((r) => r.followee_id)

    const { data, error } = await supabase
      .from('lists')
      .select(
        'id, name, description, user_id, is_public, cover_image_url, created_at, updated_at,' +
          ' users(username, display_name, avatar_url),' +
          ' list_games(igdb_game_id, game_title, game_image, position)'
      )
      .in('user_id', followeeIds)
      .eq('is_public', true)
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[users] getListsFromFollowing failed:', error.message)
      return []
    }

    return (data || []).map((row) => {
      const games = (row.list_games || [])
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((g) => ({ id: g.igdb_game_id, title: g.game_title || '', image: g.game_image || null }))
      const author = row.users
        ? { username: row.users.username || '', displayName: row.users.display_name || '' }
        : null
      return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        gameCount: games.length,
        previewGames: games.slice(0, 4),
        author,
        updatedAt: row.updated_at,
      }
    })
  } catch (err) {
    console.error('[users] getListsFromFollowing crashed:', err)
    return []
  }
}

/**
 * Fetch favorite games for all users that `userId` follows. Each entry
 * carries the game data plus which followed user favorited it.
 *
 * @param {string} userId  The current signed-in user id (the follower).
 * @param {number} limit   Max total favorite entries returned.
 * @returns {Promise<Array<{ game: { id, title, image }, owner: { id, username, displayName, avatarUrl } }>>}
 */
export async function getFollowingFavorites(userId, limit = 12) {
  if (!userId) return []
  try {
    const { data: followRows, error: followErr } = await supabase
      .from('follows')
      .select('followee_id')
      .eq('follower_id', userId)
    if (followErr || !followRows?.length) return []

    const followeeIds = followRows.map((r) => r.followee_id)

    // No deleted_at filter: public.users has no such column, so the filter this
    // query used to carry made PostgREST reject it (42703) and the function
    // returned [] every time.
    const { data, error } = await supabase
      .from('public_profiles')
      .select('id, username, display_name, avatar_url, favorite_games')
      .in('id', followeeIds)

    if (error) {
      console.error('[users] getFollowingFavorites failed:', error.message)
      return []
    }

    const items = []
    for (const row of data || []) {
      const favs = Array.isArray(row.favorite_games) ? row.favorite_games : []
      for (const g of favs) {
        if (!g?.id) continue
        items.push({
          game: { id: g.id, title: g.title || '', image: g.image || null },
          owner: {
            id: row.id,
            username: row.username || '',
            displayName: row.display_name || row.username || '',
            avatarUrl: row.avatar_url || null,
          },
        })
      }
    }
    return items.slice(0, limit)
  } catch (err) {
    console.error('[users] getFollowingFavorites crashed:', err)
    return []
  }
}

import { supabase } from './supabase'
import { logActivity } from './activityService'

/**
 * List Service — Supabase-backed custom lists.
 *
 * Schema (lists + list_games tables):
 *   lists (
 *     id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *     name             text NOT NULL,
 *     description      text,
 *     is_public        boolean NOT NULL DEFAULT true,
 *     cover_image_url  text,
 *     created_at       timestamptz NOT NULL DEFAULT now(),
 *     updated_at       timestamptz NOT NULL DEFAULT now()
 *   )
 *
 *   list_games (
 *     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     list_id      uuid NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
 *     igdb_game_id bigint NOT NULL,
 *     position     integer NOT NULL DEFAULT 0,
 *     game_title   text,
 *     game_image   text,
 *     added_at     timestamptz NOT NULL DEFAULT now(),
 *     UNIQUE(list_id, igdb_game_id)
 *   )
 *
 * RLS policies (must be active in Supabase):
 *   lists — read:   all authenticated users can read public lists
 *                   users can read their own private lists (user_id = auth.uid())
 *   lists — write:  user_id = auth.uid()
 *   list_games — inherits via CASCADE / same user_id via list ownership
 */

const LIBRARY_STORAGE_KEY = 'gameLibrary'
const MIGRATED_KEY = 'customLists_migratedToSupabase'

// ── Tracker list IDs that live in localStorage (not Supabase) ────────────────
export const TRACKER_LIST_IDS = new Set([
  'currently-playing',
  'played',
  'want-to-play',
  'dropped',
])

export function isTrackerList(listId) {
  return TRACKER_LIST_IDS.has(listId)
}

// ── Shape helpers ─────────────────────────────────────────────────────────────

/** Convert a list_games row into the normalized game shape the UI expects. */
function rowToGame(row) {
  return {
    id: row.igdb_game_id,
    title: row.game_title || '',
    image: row.game_image || null,
    position: row.position ?? 0,
    addedAt: row.added_at,
  }
}

/**
 * Convert a lists row (with optional nested list_games) into the list shape
 * used by the UI. Compatible with the legacy listInfo shape from libraryService.
 */
function rowToList(row) {
  const games = (row.list_games || [])
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(rowToGame)
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description || '',
    isPublic: row.is_public ?? true,
    isCustom: true,
    coverImageUrl: row.cover_image_url || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    games,
    gameCount: games.length,
    previewGames: games.slice(0, 4),
  }
}

function notifyChange() {
  try {
    window.dispatchEvent(new Event('libraryUpdated'))
  } catch {
    // SSR / no-window — best effort
  }
}

// ── Supabase API ──────────────────────────────────────────────────────────────

/**
 * SELECT * FROM lists LEFT JOIN list_games WHERE user_id = $1
 * ORDER BY updated_at DESC
 * Returns the full list shape including games array.
 */
export async function getListsForUser(userId) {
  if (!userId) return []
  const { data, error } = await supabase
    .from('lists')
    .select('*, list_games(igdb_game_id, game_title, game_image, position, added_at)')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) {
    console.error('[lists] getListsForUser failed:', error.message)
    return []
  }
  return (data || []).map(rowToList)
}

/**
 * Sprint 5 P3: Search public lists by name OR description, case-insensitive.
 * Joined with users (for the author row) and a slim list_games projection
 * so the Search Lists tab can render the 6-cover mosaic without a second
 * round-trip per list.
 */
export async function searchPublicLists(query, limit = 20) {
  const trimmed = (query || '').trim()
  if (!trimmed) return []
  const escaped = trimmed.replace(/[\\%_]/g, (m) => `\\${m}`)
  const { data, error } = await supabase
    .from('lists')
    .select(
      'id, name, description, user_id, is_public, cover_image_url, created_at, updated_at,' +
        ' users(username, display_name, avatar_url),' +
        ' list_games(igdb_game_id, game_title, game_image, position)'
    )
    .eq('is_public', true)
    .or(`name.ilike.%${escaped}%,description.ilike.%${escaped}%`)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[lists] searchPublicLists failed:', error.message)
    return []
  }
  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description || '',
    coverImageUrl: row.cover_image_url || null,
    author: row.users
      ? {
          username: row.users.username || '',
          displayName: row.users.display_name || '',
          avatarUrl: row.users.avatar_url || null,
        }
      : null,
    games: (row.list_games || [])
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map(rowToGame),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

/**
 * SELECT one list + all its games by listId (public lists visible to all,
 * private lists restricted to owner via RLS).
 */
export async function getListById(listId) {
  if (!listId) return null
  const { data, error } = await supabase
    .from('lists')
    .select('*, list_games(igdb_game_id, game_title, game_image, position, added_at)')
    .eq('id', listId)
    .single()
  if (error) {
    console.error('[lists] getListById failed:', error.message)
    return null
  }
  return data ? rowToList(data) : null
}

/**
 * INSERT a new list for the signed-in user.
 * Returns the new list's UUID.
 */
export async function createList({ name, description = '', isPublic = true }) {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) throw new Error('You must be signed in to create a list.')

  const { data, error } = await supabase
    .from('lists')
    .insert({
      user_id: user.id,
      name: name.trim(),
      description: description?.trim() || null,
      is_public: isPublic,
    })
    .select('id, name')
    .single()
  if (error) {
    console.error('[lists] createList failed:', error.message)
    throw new Error(error.message)
  }
  notifyChange()

  // Activity log — fire-and-forget AFTER the primary insert succeeds.
  logActivity({
    activityType: 'list_created',
    targetId: data.id,
    metadata: { list_name: data.name || null },
  })

  return data.id
}

/**
 * UPDATE list metadata (name, description, is_public).
 * Only supply fields you want to change — others are left as-is.
 */
export async function updateList(listId, { name, description, isPublic } = {}) {
  if (!listId) throw new Error('listId is required')
  const update = { updated_at: new Date().toISOString() }
  if (name !== undefined) update.name = name.trim()
  if (description !== undefined) update.description = description?.trim() || null
  if (isPublic !== undefined) update.is_public = isPublic

  const { error } = await supabase.from('lists').update(update).eq('id', listId)
  if (error) {
    console.error('[lists] updateList failed:', error.message)
    throw new Error(error.message)
  }
  notifyChange()
}

/**
 * DELETE a list. Cascades to list_games via ON DELETE CASCADE.
 */
export async function deleteList(listId) {
  if (!listId) throw new Error('listId is required')
  const { error } = await supabase.from('lists').delete().eq('id', listId)
  if (error) {
    console.error('[lists] deleteList failed:', error.message)
    throw new Error(error.message)
  }
  notifyChange()
}

/**
 * INSERT (or UPSERT) a game into list_games.
 * @param {string} listId            UUID of the list
 * @param {number|string} igdbGameId IGDB game id
 * @param {number} position          Sort order (0-based index)
 * @param {{ title?: string, image?: string }} gameData Denormalised cache
 */
export async function addGameToList(
  listId,
  igdbGameId,
  position = 0,
  gameData = {}
) {
  if (!listId || igdbGameId == null) return

  const payload = {
    list_id: listId,
    igdb_game_id: Number(igdbGameId),
    position: Number(position),
    game_title: gameData.title || null,
    game_image: gameData.image || null,
  }
  const { error } = await supabase
    .from('list_games')
    .upsert(payload, { onConflict: 'list_id,igdb_game_id' })
  if (error) {
    console.error('[lists] addGameToList failed:', error.message)
    throw new Error(error.message)
  }
  // Touch the list's updated_at so getListsForUser ordering stays fresh.
  await supabase
    .from('lists')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', listId)
  notifyChange()

  // Activity log — fire-and-forget AFTER the primary upsert succeeds.
  logActivity({
    activityType: 'game_added_to_list',
    igdbGameId,
    targetId: listId,
    metadata: { game_title: gameData.title || null },
  })
}

/**
 * DELETE a game from list_games.
 */
export async function removeGameFromList(listId, igdbGameId) {
  if (!listId || igdbGameId == null) return
  const { error } = await supabase
    .from('list_games')
    .delete()
    .eq('list_id', listId)
    .eq('igdb_game_id', Number(igdbGameId))
  if (error) {
    console.error('[lists] removeGameFromList failed:', error.message)
    throw new Error(error.message)
  }
  notifyChange()
}

/**
 * Batch-update position for all games in a list.
 * @param {string} listId
 * @param {Array<number|string>} orderedGameIds New order; array index = new position
 */
export async function reorderListGames(listId, orderedGameIds) {
  if (!listId || !orderedGameIds?.length) return
  await Promise.all(
    orderedGameIds.map((gameId, index) =>
      supabase
        .from('list_games')
        .update({ position: index })
        .eq('list_id', listId)
        .eq('igdb_game_id', Number(gameId))
    )
  )
  notifyChange()
}

// ── One-time localStorage → Supabase migration ───────────────────────────────

/**
 * If the device has customLists in localStorage and we haven't migrated for
 * this user yet, bulk-insert into lists + list_games. Idempotent per-user.
 *
 * Same pattern as migrateLocalReviewsIfNeeded in reviewService.
 */
export async function migrateLocalListsIfNeeded(userId) {
  if (!userId) return { migrated: 0, skipped: true, reason: 'no-user' }
  try {
    const marker = localStorage.getItem(MIGRATED_KEY)
    if (marker === userId) {
      return { migrated: 0, skipped: true, reason: 'already-migrated' }
    }

    const stored = localStorage.getItem(LIBRARY_STORAGE_KEY)
    if (!stored) {
      localStorage.setItem(MIGRATED_KEY, userId)
      return { migrated: 0, skipped: false, reason: 'nothing-to-migrate' }
    }

    let parsed
    try {
      parsed = JSON.parse(stored)
    } catch {
      localStorage.setItem(MIGRATED_KEY, userId)
      return { migrated: 0, skipped: true, reason: 'corrupt-localstorage' }
    }

    const customLists = parsed?.customLists
    if (!customLists || typeof customLists !== 'object') {
      localStorage.setItem(MIGRATED_KEY, userId)
      return { migrated: 0, skipped: false, reason: 'no-custom-lists' }
    }

    const entries = Object.entries(customLists)
    if (entries.length === 0) {
      localStorage.setItem(MIGRATED_KEY, userId)
      return { migrated: 0, skipped: false, reason: 'empty' }
    }

    let migrated = 0
    for (const [, listData] of entries) {
      if (!listData?.name) continue

      const { data: newList, error: listErr } = await supabase
        .from('lists')
        .insert({
          user_id: userId,
          name: listData.name,
          description: listData.description || null,
          is_public: true,
          created_at: listData.createdAt || new Date().toISOString(),
        })
        .select('id')
        .single()

      if (listErr) {
        console.error('[lists] migration: list insert failed:', listErr.message)
        continue
      }

      const games = listData.games || []
      if (games.length > 0) {
        const gameRows = games.map((g, idx) => ({
          list_id: newList.id,
          igdb_game_id: Number(g.id),
          position: idx,
          game_title: g.title || null,
          game_image: g.image || null,
          added_at: g.addedAt || new Date().toISOString(),
        }))
        await supabase.from('list_games').insert(gameRows)
      }
      migrated++
    }

    localStorage.setItem(MIGRATED_KEY, userId)
    return { migrated, skipped: false }
  } catch (err) {
    console.error('[lists] migration crashed:', err)
    return { migrated: 0, skipped: false, error: err }
  }
}

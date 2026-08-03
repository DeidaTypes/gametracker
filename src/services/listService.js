import { supabase } from './supabase'
import { logActivity } from './activityService'
import {
  ACTIVITY_EVENT_TYPES,
  logActivityEvent,
} from './activityEventsService'
import { applyBlockFilter, filterBlockedRows } from './blockService'

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
 *     is_pinned        boolean NOT NULL DEFAULT false,
 *     pinned_at        timestamptz,
 *     is_curated       boolean NOT NULL DEFAULT false,  -- admin-seeded "by Checkpoint" (see 20260701104500_curated_collections.sql)
 *     curator_label    text,                            -- curator display name for curated lists only
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

export const LIST_PIN_CHANGED_EVENT = 'listPinChanged'

const MAX_PINNED_LISTS = 5

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
    isPinned: row.is_pinned ?? false,
    pinnedAt: row.pinned_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    games,
    gameCount: games.length,
    previewGames: games.slice(0, 6),
    author: row.users
      ? {
          username: row.users.username || '',
          displayName: row.users.display_name || '',
          avatarUrl: row.users.avatar_url || null,
        }
      : null,
  }
}

function notifyChange() {
  try {
    window.dispatchEvent(new Event('libraryUpdated'))
  } catch {
    // SSR / no-window — best effort
  }
}

function notifyPinChange() {
  try {
    window.dispatchEvent(new Event(LIST_PIN_CHANGED_EVENT))
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
    .select('*, is_pinned, pinned_at, list_games(igdb_game_id, game_title, game_image, position, added_at)')
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
  let q = supabase
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
  q = await applyBlockFilter(q, 'user_id')
  const { data, error } = await q
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
 * SELECT one list + all its games + collaborators by listId.
 * Public lists are visible to all; private lists are restricted to
 * the owner and collaborators via RLS.
 */
export async function getListById(listId) {
  if (!listId) return null
  const { data, error } = await supabase
    .from('lists')
    .select(
      '*, ' +
      'list_games(igdb_game_id, game_title, game_image, position, added_at), ' +
      'users(username, display_name, avatar_url), ' +
      'list_collaborators(user_id, created_at, users!list_collaborators_user_id_fkey(username, display_name, avatar_url))'
    )
    .eq('id', listId)
    .single()
  if (error) {
    console.error('[lists] getListById failed:', error.message)
    return null
  }
  if (!data) return null
  const list = rowToList(data)
  list.collaborators = (data.list_collaborators || [])
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((row) => ({
      userId: row.user_id,
      username: row.users?.username || '',
      displayName: row.users?.display_name || row.users?.username || '',
      avatarUrl: row.users?.avatar_url || null,
      invitedAt: row.created_at,
    }))
  return list
}

/**
 * Discover — Collections shape helper. Distinct from rowToList (which
 * targets the "my lists" / list-detail shape); this keeps only what the
 * Collections shelf/browse page renders.
 */
function rowToCollection(row) {
  const games = (row.list_games || [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(rowToGame)
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    isCurated: !!row.is_curated,
    curatorLabel: row.is_curated ? (row.curator_label || 'Checkpoint') : null,
    owner: row.users
      ? {
          userId: row.user_id,
          username: row.users.username || '',
          displayName: row.users.display_name || '',
          avatarUrl: row.users.avatar_url || null,
        }
      : null,
    previewGames: games.slice(0, 4),
    gameCount: games.length,
    saveCount: 0, // filled in by attachSaveCounts() — never fabricated
    createdAt: row.created_at,
  }
}

/**
 * REAL save counts, as a Map of listId → count. Lists with no save rows are
 * absent from the map (callers read that as 0) — counts are never fabricated.
 * Returns an empty map on error so callers degrade to "no saves" rather than
 * failing.
 *
 * Goes through get_list_save_counts() rather than selecting from list_saves:
 * that table is owner-only since 20260803000000 (who saved what is a private
 * signal), and the RPC returns tallies without the saver identities.
 */
export async function getSaveCountsForLists(listIds) {
  if (!listIds?.length) return new Map()
  const { data, error } = await supabase.rpc('get_list_save_counts', {
    p_list_ids: listIds,
  })
  if (error) {
    console.error('[lists] getSaveCountsForLists failed:', error.message)
    return new Map()
  }
  const counts = new Map()
  for (const row of data || []) {
    counts.set(row.list_id, row.save_count || 0)
  }
  return counts
}

/**
 * Attach REAL save counts from list_saves for a batch of collections.
 * Lists with no save rows simply show 0 — counts are never fabricated.
 */
async function attachSaveCounts(collections) {
  if (!collections.length) return collections
  const counts = await getSaveCountsForLists(collections.map((c) => c.id))
  return collections.map((c) => ({ ...c, saveCount: counts.get(c.id) || 0 }))
}

const COLLECTIONS_SELECT =
  'id, name, description, user_id, is_public, is_curated, curator_label, created_at,' +
  ' users(username, display_name, avatar_url),' +
  ' list_games(igdb_game_id, game_title, game_image, position)'

/**
 * Discover "Collections" — curated ("by Checkpoint") lists mixed with
 * popular public community lists.
 *
 * - Curated: is_curated = true rows, admin-seeded (see
 *   supabase/migrations/20260701104500_curated_collections.sql). Newest
 *   first; the flag can't be set through the app, so this pool is fully
 *   editorial.
 * - Community: is_curated = false, public, non-empty lists ranked by
 *   REAL list_saves counts (ties broken by newest). No fabricated numbers.
 * - Both pools exclude private lists, empty lists (0 games), and lists
 *   owned by a blocked user.
 *
 * @param {{ curatedLimit?: number, communityLimit?: number }} opts
 * @returns {Promise<{ curated: Array, community: Array }>}
 */
export async function getCollections({ curatedLimit = 8, communityLimit = 12 } = {}) {
  let curatedQuery = supabase
    .from('lists')
    .select(COLLECTIONS_SELECT)
    .eq('is_public', true)
    .eq('is_curated', true)
    .order('created_at', { ascending: false })
    .limit(curatedLimit * 2)
  curatedQuery = await applyBlockFilter(curatedQuery, 'user_id')

  // Overfetch community candidates — they get re-ranked by real save
  // count client-side and empty lists get dropped before the cap applies.
  let communityQuery = supabase
    .from('lists')
    .select(COLLECTIONS_SELECT)
    .eq('is_public', true)
    .eq('is_curated', false)
    .order('created_at', { ascending: false })
    .limit(Math.max(communityLimit * 5, 50))
  communityQuery = await applyBlockFilter(communityQuery, 'user_id')

  const [curatedRes, communityRes] = await Promise.all([curatedQuery, communityQuery])
  if (curatedRes.error) {
    console.error('[lists] getCollections (curated) failed:', curatedRes.error.message)
  }
  if (communityRes.error) {
    console.error('[lists] getCollections (community) failed:', communityRes.error.message)
  }

  const curatedRows = filterBlockedRows(curatedRes.data || [], 'user_id')
  const communityRows = filterBlockedRows(communityRes.data || [], 'user_id')

  const curatedNonEmpty = curatedRows.map(rowToCollection).filter((c) => c.gameCount > 0)
  const communityNonEmpty = communityRows.map(rowToCollection).filter((c) => c.gameCount > 0)

  const [curatedWithSaves, communityWithSaves] = await Promise.all([
    attachSaveCounts(curatedNonEmpty),
    attachSaveCounts(communityNonEmpty),
  ])

  const curated = curatedWithSaves.slice(0, curatedLimit)
  const community = communityWithSaves
    .sort((a, b) => b.saveCount - a.saveCount || new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, communityLimit)

  return { curated, community }
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

  // Pulse — 'listed' covers both "made a list" and "added a game to a
  // list" with `kind` in metadata so the feed can render distinct
  // sentences without a second enum value.
  logActivityEvent({
    type: ACTIVITY_EVENT_TYPES.LISTED,
    entityId: data.id,
    metadata: {
      kind: 'list_created',
      list_name: data.name || null,
    },
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

  // Pulse — same 'listed' type as createList, differentiated by `kind`
  // and by the presence of `game_*` metadata. entity_id points at the
  // game (the more user-meaningful target), with list_id alongside in
  // metadata so deep-links can route to either side.
  logActivityEvent({
    type: ACTIVITY_EVENT_TYPES.LISTED,
    entityId: String(igdbGameId),
    metadata: {
      kind: 'game_added_to_list',
      list_id: listId,
      game_title: gameData.title || null,
      game_image: gameData.image || null,
    },
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

/**
 * Fetch the given user's rating (from `reviews`) for each game in a list.
 * Returns a plain object keyed by igdb_game_id (number) → rating (number).
 * Only games that have a review from this user are included.
 *
 * @param {string} userId         UUID of the list owner
 * @param {Array<number>} gameIds IGDB game IDs to look up
 */
export async function getOwnerRatingsForList(userId, gameIds) {
  if (!userId || !gameIds?.length) return {}
  const { data, error } = await supabase
    .from('reviews')
    .select('igdb_game_id, rating')
    .eq('user_id', userId)
    .in('igdb_game_id', gameIds.map(Number))
  if (error) {
    console.error('[lists] getOwnerRatingsForList failed:', error.message)
    return {}
  }
  return Object.fromEntries((data || []).map((r) => [r.igdb_game_id, r.rating]))
}

/**
 * Fetch the list owner's tracker status + hours_played for each game in a
 * list (real data only — `game_trackers`, gated by the same
 * `trackers_select_visible` RLS tiering `reviews`/`getOwnerRatingsForList`
 * already relies on). Powers the list-detail stats row's "Played" count
 * and "Total hours" cell, plus the per-cover status dot.
 *
 * Note: `game_trackers.igdb_game_id` is stored as text (see hoursService),
 * unlike `reviews`/`list_games`, which are bigint — hence the String()
 * cast on the query and the Number() cast back on the returned keys so
 * this lines up with the numeric `game.id` used everywhere else.
 *
 * @param {string} userId         UUID of the list owner
 * @param {Array<number>} gameIds IGDB game IDs to look up
 * @returns {Promise<Object<number, { status: string|null, hoursPlayed: number }>>}
 */
export async function getOwnerTrackerDataForList(userId, gameIds) {
  if (!userId || !gameIds?.length) return {}
  const { data, error } = await supabase
    .from('game_trackers')
    .select('igdb_game_id, status, hours_played')
    .eq('user_id', userId)
    .in('igdb_game_id', gameIds.map(String))
  if (error) {
    console.error('[lists] getOwnerTrackerDataForList failed:', error.message)
    return {}
  }
  return Object.fromEntries(
    (data || []).map((r) => [
      Number(r.igdb_game_id),
      { status: r.status || null, hoursPlayed: Number(r.hours_played) || 0 },
    ])
  )
}

// ── Collaboration ─────────────────────────────────────────────────────────────

/**
 * Fetch all collaborators for a list, joined with the users table.
 * Returns an array sorted by invite time (oldest first).
 *
 * @param {string} listId
 * @returns {Promise<Array<{ userId, username, displayName, avatarUrl, invitedAt }>>}
 */
export async function getCollaborators(listId) {
  if (!listId) return []
  const { data, error } = await supabase
    .from('list_collaborators')
    .select('user_id, created_at, users(username, display_name, avatar_url)')
    .eq('list_id', listId)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[lists] getCollaborators failed:', error.message)
    return []
  }
  return (data || []).map((row) => ({
    userId: row.user_id,
    username: row.users?.username || '',
    displayName: row.users?.display_name || row.users?.username || '',
    avatarUrl: row.users?.avatar_url || null,
    invitedAt: row.created_at,
  }))
}

/**
 * Add a collaborator to a list. Only the list owner may call this;
 * the RLS policy will reject anyone else.
 *
 * @param {string} listId
 * @param {string} targetUserId  UUID of the user to invite
 */
export async function addCollaborator(listId, targetUserId) {
  if (!listId || !targetUserId) throw new Error('listId and targetUserId are required')
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) throw new Error('You must be signed in.')

  const { error } = await supabase.from('list_collaborators').insert({
    list_id: listId,
    user_id: targetUserId,
    invited_by: user.id,
  })
  if (error) {
    if (error.code === '23505') return // already a collaborator — idempotent
    console.error('[lists] addCollaborator failed:', error.message)
    throw new Error(error.message)
  }
  notifyChange()
}

/**
 * Remove a collaborator from a list. Only the list owner may call this.
 *
 * @param {string} listId
 * @param {string} targetUserId  UUID of the collaborator to remove
 */
export async function removeCollaborator(listId, targetUserId) {
  if (!listId || !targetUserId) throw new Error('listId and targetUserId are required')
  const { error } = await supabase
    .from('list_collaborators')
    .delete()
    .eq('list_id', listId)
    .eq('user_id', targetUserId)
  if (error) {
    console.error('[lists] removeCollaborator failed:', error.message)
    throw new Error(error.message)
  }
  notifyChange()
}

/**
 * Returns true if `userId` is a collaborator on `listId`.
 * Soft-fails to false on any error so callers never block rendering.
 *
 * @param {string} listId
 * @param {string|null} userId
 */
export async function isCollaboratorOnList(listId, userId) {
  if (!listId || !userId) return false
  const { data, error } = await supabase
    .from('list_collaborators')
    .select('user_id')
    .eq('list_id', listId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return false
  return !!data
}

// ── List pinning ──────────────────────────────────────────────────────────────

/**
 * Returns the user's pinned lists (is_pinned = true), ordered by pinned_at DESC,
 * capped at MAX_PINNED_LISTS (5). Returns the full list shape including previewGames.
 */
export async function getPinnedListsForUser(userId) {
  if (!userId) return []
  const { data, error } = await supabase
    .from('lists')
    .select('*, is_pinned, pinned_at, list_games(igdb_game_id, game_title, game_image, position, added_at)')
    .eq('user_id', userId)
    .eq('is_pinned', true)
    .order('pinned_at', { ascending: false, nullsFirst: false })
    .limit(MAX_PINNED_LISTS)
  if (error) {
    console.error('[lists] getPinnedListsForUser failed:', error.message)
    return []
  }
  return (data || []).map(rowToList)
}

/**
 * Pin a list. Enforces the MAX_PINNED_LISTS (5) cap. Throws with
 * err.code = 'LIST_PINS_FULL' when the cap would be exceeded so callers
 * can show a specific toast.
 */
export async function pinList(listId) {
  if (!listId) throw new Error('listId is required')
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) throw new Error('Must be signed in to pin a list.')

  const { count, error: countErr } = await supabase
    .from('lists')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_pinned', true)
  if (countErr) throw new Error(countErr.message)
  if (count >= MAX_PINNED_LISTS) {
    const err = new Error(`You already have ${MAX_PINNED_LISTS} pinned lists. Unpin one first.`)
    err.code = 'LIST_PINS_FULL'
    throw err
  }

  const { error } = await supabase
    .from('lists')
    .update({ is_pinned: true, pinned_at: new Date().toISOString() })
    .eq('id', listId)
    .eq('user_id', user.id)
  if (error) {
    console.error('[lists] pinList failed:', error.message)
    throw new Error(error.message)
  }
  notifyPinChange()
}

/**
 * Unpin a list. Clears is_pinned and pinned_at.
 */
export async function unpinList(listId) {
  if (!listId) throw new Error('listId is required')
  const { error } = await supabase
    .from('lists')
    .update({ is_pinned: false, pinned_at: null })
    .eq('id', listId)
  if (error) {
    console.error('[lists] unpinList failed:', error.message)
    throw new Error(error.message)
  }
  notifyPinChange()
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

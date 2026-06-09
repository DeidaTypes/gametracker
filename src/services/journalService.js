import { supabase } from './supabase'
import { logActivity, ACTIVITY_TYPES } from './activityService'

/**
 * Journal Service — per-game dated notes a user writes as they play.
 *
 * This is distinct from the reviews system. A game can have many journal
 * entries (one per note), whereas a game has at most one review per user.
 *
 * Schema (journal_entries):
 *   id           uuid PK
 *   user_id      uuid NOT NULL
 *   igdb_game_id bigint NOT NULL
 *   body         text NOT NULL        (max 2000 chars enforced client-side)
 *   is_spoiler   boolean NOT NULL default false
 *   game_title   text                (denormalised for profile Diary)
 *   game_image   text                (denormalised for profile Diary)
 *   created_at   timestamptz NOT NULL default now()
 */

const TABLE = 'journal_entries'

/* ── Save (INSERT) ───────────────────────────────────────────────────────── */

/**
 * Insert a new journal entry for the signed-in user.
 *
 * Fires-and-forgets an activity row for the calendar / streak. The activity
 * is de-duplicated per day: if a 'journal_written' row already exists today
 * for this user (any game), no second row is inserted.
 *
 * @returns {Promise<object>} the inserted row
 */
export async function saveJournalEntry({
  igdbGameId,
  body,
  isSpoiler = false,
  gameTitle = null,
  gameImage = null,
} = {}) {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) throw new Error('Not signed in')

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      user_id: user.id,
      igdb_game_id: Number(igdbGameId),
      body: body.trim(),
      is_spoiler: !!isSpoiler,
      game_title: gameTitle || null,
      game_image: gameImage || null,
    })
    .select('*')
    .single()

  if (error) throw error

  // Activity tie-in: fire-and-forget; must never throw or roll back the save.
  // TODO: Sprint N — push journal_written into the social activity feed.
  logJournalActivityOnce({
    userId: user.id,
    igdbGameId,
    gameTitle,
    gameImage,
    entryId: data.id,
  }).catch(() => {})

  try {
    window.dispatchEvent(new Event('journalEntryAdded'))
  } catch {
    // SSR / no-window
  }

  return data
}

/* ── Read: per-game (current user) ──────────────────────────────────────── */

/**
 * Fetch the signed-in user's journal entries for one game, newest first.
 *
 * @param {string|number} igdbGameId
 * @returns {Promise<Array>}
 */
export async function getJournalEntriesForGame(igdbGameId) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', user.id)
    .eq('igdb_game_id', Number(igdbGameId))
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[journal] getJournalEntriesForGame failed:', error.message)
    return []
  }
  return data || []
}

/* ── Read: all-games (for profile Diary) ─────────────────────────────────── */

/**
 * Fetch a user's journal entries across all games, newest first.
 * Public read per RLS (Letterboxd-style diary).
 *
 * @param {string} userId
 * @param {{ limit?: number, offset?: number }} opts
 * @returns {Promise<Array>}
 */
export async function getJournalEntriesForUser(userId, { limit = 50, offset = 0 } = {}) {
  if (!userId) return []

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('[journal] getJournalEntriesForUser failed:', error.message)
    return []
  }
  return data || []
}

/* ── Delete ──────────────────────────────────────────────────────────────── */

/**
 * Delete a journal entry. RLS ensures only the owner can delete.
 * The `.eq('user_id', user.id)` guard is belt-and-suspenders.
 *
 * @param {string} entryId  UUID of the entry to delete
 */
export async function deleteJournalEntry(entryId) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('id', entryId)
    .eq('user_id', user.id)

  if (error) throw error
}

/* ── Activity tie-in (private) ───────────────────────────────────────────── */

/**
 * Insert a 'journal_written' activity row for today, but only once per day
 * (any game). This keeps the activity calendar filled without creating
 * N rows if the user writes multiple entries in one session.
 */
async function logJournalActivityOnce({ userId, igdbGameId, gameTitle, gameImage, entryId }) {
  try {
    // Build UTC day boundaries so the de-dupe window is calendar-day aligned.
    const now = new Date()
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    ).toISOString()
    const dayEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
    ).toISOString()

    const { data: existing } = await supabase
      .from('activities')
      .select('id')
      .eq('user_id', userId)
      .eq('activity_type', ACTIVITY_TYPES.JOURNAL_WRITTEN)
      .gte('created_at', dayStart)
      .lt('created_at', dayEnd)
      .limit(1)

    if (existing && existing.length > 0) return // already logged today

    await logActivity({
      activityType: ACTIVITY_TYPES.JOURNAL_WRITTEN,
      igdbGameId,
      targetId: entryId,
      metadata: { game_title: gameTitle, game_image: gameImage },
    })
  } catch (err) {
    console.error('[journal] logJournalActivityOnce failed:', err)
  }
}

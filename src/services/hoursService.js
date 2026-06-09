// Hours service — read/write hours_played and progress_override on game_trackers.
//
// Schema prerequisites (must exist before using this module):
//   game_trackers.hours_played     numeric DEFAULT 0
//   game_trackers.progress_override numeric NULLABLE
//
// All writes are optimistic: callers should update UI immediately,
// then call these functions to sync to the database.

import { supabase } from './supabase'

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Fetch the game_trackers row for the current user + game.
 * Returns { hours_played, progress_override, status, ... } or null if no row.
 *
 * The explicit FK hint prevents PostgREST from failing on ambiguous
 * foreign-key paths when multiple FK relationships exist on game_trackers.
 *
 * @param {number|string} igdbGameId
 * @returns {Promise<object|null>}
 */
export async function getTracker(igdbGameId) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('game_trackers')
    .select('id, igdb_game_id, user_id, status, hours_played, progress_override, updated_at')
    .eq('user_id', user.id)
    .eq('igdb_game_id', String(igdbGameId))
    .maybeSingle()

  if (error) {
    console.error('[hoursService] getTracker failed:', error.message)
    return null
  }
  return data
}

// ── Write helpers ─────────────────────────────────────────────────────────────

/**
 * Upsert hours_played on the user's tracker row for a game.
 * Creates the row with status 'playing' if it doesn't exist yet.
 *
 * @param {number|string} igdbGameId
 * @param {number} hours  New hours_played value (≥ 0)
 * @param {{ game_title?: string, game_image?: string }} [meta]  Persisted only on insert.
 * @returns {Promise<object|null>}  Updated/inserted row, or null on error.
 */
export async function setHoursPlayed(igdbGameId, hours, meta = {}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const clampedHours = Math.max(0, Number(hours) || 0)

  const { data, error } = await supabase
    .from('game_trackers')
    .upsert(
      {
        user_id: user.id,
        igdb_game_id: String(igdbGameId),
        hours_played: clampedHours,
        // Only set these on insert; upsert merge keeps existing values.
        ...(meta.game_title ? { game_title: meta.game_title } : {}),
        ...(meta.game_image ? { game_image: meta.game_image } : {}),
      },
      {
        onConflict: 'user_id,igdb_game_id',
        // ignoreDuplicates: false — we want to update on conflict
      }
    )
    .select('id, igdb_game_id, user_id, status, hours_played, progress_override')
    .maybeSingle()

  if (error) {
    console.error('[hoursService] setHoursPlayed failed:', error.message)
    return null
  }
  return data
}

/**
 * Set (or clear) a manual progress override on the user's tracker row.
 * Pass null to clear the override and return to computed progress.
 *
 * @param {number|string} igdbGameId
 * @param {number|null} percent  0–100, or null to clear
 * @returns {Promise<object|null>}
 */
export async function setProgressOverride(igdbGameId, percent) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const value =
    percent === null || percent === undefined
      ? null
      : Math.min(100, Math.max(0, Number(percent) || 0))

  const { data, error } = await supabase
    .from('game_trackers')
    .upsert(
      {
        user_id: user.id,
        igdb_game_id: String(igdbGameId),
        progress_override: value,
      },
      { onConflict: 'user_id,igdb_game_id' }
    )
    .select('id, igdb_game_id, user_id, status, hours_played, progress_override')
    .maybeSingle()

  if (error) {
    console.error('[hoursService] setProgressOverride failed:', error.message)
    return null
  }
  return data
}

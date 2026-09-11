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
 * Sum `hours` across already-fetched play-session rows for ONE game.
 * Game Detail's session card and Session History sheet both read this —
 * do not re-implement the reduce at either call site.
 *
 * @param {Array<{ hours?: number }>} sessions
 * @returns {number}  Total hours (≥ 0)
 */
export function getTotalHoursForGame(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return 0
  let total = 0
  for (const row of sessions) {
    total += Number(row.hours) || 0
  }
  return total
}

/**
 * Sum a user's total playtime across ALL games, regardless of whether a
 * `game_trackers` row exists for them today. Used by the Profile page to
 * surface the total-hours headline stat.
 *
 * Decoupling fix: `game_trackers.hours_played` is a rollup that
 * disappears the moment a tracker row is deleted (clearGameStatus), even
 * though the underlying `play_sessions` rows — the real record of play —
 * are untouched (no FK from play_sessions to game_trackers; see the
 * diagnosis report). So `play_sessions.hours` summed per user is now the
 * primary source, not `game_trackers.hours_played`.
 *
 * Legacy top-up: before the `trg_play_sessions_rollup` trigger existed
 * (and via the old client-side `setHoursPlayed` direct-write path, which
 * is unused by any current caller but may still be sitting in historical
 * rows), some `hours_played` values were written straight onto
 * `game_trackers` with NO backing `play_sessions` rows at all. Switching
 * to a pure play_sessions sum would silently zero those out. To avoid
 * that regression, for every current tracker row we compare
 * `hours_played` against the sum of THAT game's own `play_sessions.hours`
 * and add only the excess — hours that only ever lived on the tracker
 * row. A game whose hours_played is fully accounted for by its sessions
 * contributes 0 excess (no double-counting). A tracker that gets deleted
 * later stops contributing its excess (there's nothing else to source it
 * from — it was never real session data), but its session-backed hours
 * keep counting via the play_sessions sum above, which is exactly the
 * "survives a tracker delete" behavior this fix is for.
 *
 * @param {string} userId
 * @returns {Promise<number|null>}  Total hours (≥ 0), or null on error.
 */
export async function getTotalHoursForUser(userId) {
  if (!userId) return null

  const [sessionsResult, trackersResult] = await Promise.all([
    supabase.from('play_sessions').select('igdb_game_id, hours').eq('user_id', userId),
    supabase.from('game_trackers').select('igdb_game_id, hours_played').eq('user_id', userId),
  ])

  if (sessionsResult.error) {
    console.error('[hoursService] getTotalHoursForUser (sessions) failed:', sessionsResult.error.message)
    return null
  }
  if (trackersResult.error) {
    console.error('[hoursService] getTotalHoursForUser (trackers) failed:', trackersResult.error.message)
    return null
  }

  const sessionRows = sessionsResult.data || []
  const trackerRows = trackersResult.data || []

  // Per-game session-hours totals, plus the grand total across all games —
  // this is the new primary source and survives a tracker row's deletion.
  // Grand total uses the same per-game summer the Game Detail surfaces use.
  const sessionHoursByGame = new Map()
  const totalSessionHours = getTotalHoursForGame(sessionRows)
  for (const row of sessionRows) {
    const hrs = Number(row.hours) || 0
    const key = String(row.igdb_game_id)
    sessionHoursByGame.set(key, (sessionHoursByGame.get(key) || 0) + hrs)
  }

  // Legacy excess — see function doc above.
  let legacyExcessHours = 0
  for (const row of trackerRows) {
    const trackerHours = Number(row.hours_played) || 0
    const sessionHours = sessionHoursByGame.get(String(row.igdb_game_id)) || 0
    if (trackerHours > sessionHours) legacyExcessHours += trackerHours - sessionHours
  }

  return totalSessionHours + legacyExcessHours
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

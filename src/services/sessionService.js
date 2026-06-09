// Session Service — start/stop timed play sessions, persist to Supabase,
// increment hours_played on the tracker row, and log toward the streak.
//
// Schema:
//   play_sessions (id, user_id, igdb_game_id, started_at, ended_at, seconds, note)
//   game_journal  (id, user_id, game_id, body)
//   activities    (id, user_id, activity_type, igdb_game_id, metadata)
//   game_trackers (…, hours_played)
//
// None of these functions throw — errors are logged and surfaced as null returns
// so callers can show graceful fallbacks without a try/catch every call-site.

import { supabase } from './supabase'
import { getTracker, setHoursPlayed } from './hoursService'

// ── Start ─────────────────────────────────────────────────────────────────────

/**
 * Insert a new play session row with started_at = now().
 * Returns the inserted row or null on error.
 *
 * @param {number|string} igdbGameId
 * @param {{ gameTitle?: string, gameImage?: string }} meta
 */
export async function startSession(igdbGameId, meta = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
      .from('play_sessions')
      .insert({
        user_id: user.id,
        igdb_game_id: Number(igdbGameId),
        started_at: new Date().toISOString(),
        game_title: meta.gameTitle ?? null,
        game_image: meta.gameImage ?? null,
        note: null,
      })
      .select('*')
      .single()

    if (error) {
      console.error('[session] startSession failed:', error.message)
      return null
    }

    return data
  } catch (err) {
    console.error('[session] startSession crashed:', err)
    return null
  }
}

// ── Stop ──────────────────────────────────────────────────────────────────────

/**
 * End a play session:
 *   1. Set ended_at + seconds on the session row.
 *   2. Increment hours_played on the game_trackers row.
 *   3. Log a 'session_logged' activity so it counts toward the streak calendar.
 *   4. If note is provided, write a game_journal entry.
 *
 * Returns { sessionRow, addedHours, newHours } or null on hard failure.
 *
 * @param {string}        sessionId
 * @param {string|number} igdbGameId
 * @param {{
 *   note?: string,
 *   gameTitle?: string,
 *   gameImage?: string,
 *   startedAt: string,   ISO timestamp of session start (for elapsed calc)
 * }} opts
 */
export async function stopSession(sessionId, igdbGameId, opts = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const now = new Date()
    const startedAt = opts.startedAt ? new Date(opts.startedAt) : now
    const seconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000))

    // 1. Close the session row
    const { data: sessionRow, error: stopErr } = await supabase
      .from('play_sessions')
      .update({
        ended_at: now.toISOString(),
        seconds,
        note: opts.note || null,
      })
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .select('*')
      .single()

    if (stopErr) {
      console.error('[session] stopSession update failed:', stopErr.message)
      return null
    }

    // 2. Increment hours_played on game_trackers
    const addedHours = seconds / 3600
    let newHours = addedHours

    const currentTracker = await getTracker(igdbGameId)
    const prevHours = Number(currentTracker?.hours_played) || 0
    newHours = prevHours + addedHours

    await setHoursPlayed(
      igdbGameId,
      newHours,
      {
        game_title: opts.gameTitle,
        game_image: opts.gameImage,
      }
    )

    // 3. Log activity for streak calendar (fire-and-forget)
    supabase
      .from('activities')
      .insert({
        user_id: user.id,
        activity_type: 'session_logged',
        igdb_game_id: Number(igdbGameId),
        metadata: {
          seconds,
          game_title: opts.gameTitle ?? null,
          added_hours: addedHours,
        },
      })
      .then(({ error }) => {
        if (error) console.error('[session] activity log failed:', error.message)
        else {
          try { window.dispatchEvent(new Event('activityUpdated')) } catch {}
        }
      })

    // 4. Journal note (fire-and-forget, only if note was provided)
    if (opts.note && opts.note.trim()) {
      supabase
        .from('game_journal')
        .insert({
          user_id: user.id,
          game_id: Number(igdbGameId),
          body: opts.note.trim(),
        })
        .then(({ error }) => {
          if (error) console.error('[session] journal insert failed:', error.message)
        })
    }

    return { sessionRow, addedHours, newHours, prevHours }
  } catch (err) {
    console.error('[session] stopSession crashed:', err)
    return null
  }
}

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Find the current user's open session (ended_at IS NULL).
 * Returns the row or null if there is none.
 *
 * @returns {Promise<object|null>}
 */
export async function getActiveSession() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
      .from('play_sessions')
      .select('*')
      .eq('user_id', user.id)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[session] getActiveSession failed:', error.message)
      return null
    }

    return data
  } catch (err) {
    console.error('[session] getActiveSession crashed:', err)
    return null
  }
}

// ── Manual log ────────────────────────────────────────────────────────────────

/**
 * Log a manual play session (no live timer).
 *   1. Insert a play_sessions row with played_on + seconds (= minutes × 60).
 *      started_at and ended_at are both set to noon UTC on the played date so
 *      getActiveSession() (which filters ended_at IS NULL) ignores these rows.
 *   2. Increment game_trackers.hours_played by the logged duration.
 *   3. Ensure one 'session_logged' activity row exists for played_on so the
 *      streak calendar marks that day active. No duplicate is created if the
 *      user logs a second session on the same day.
 *
 * @param {number|string} igdbGameId
 * @param {number} minutes  Duration in whole minutes (> 0)
 * @param {string} playedOn Local date string 'YYYY-MM-DD'
 * @param {{ gameTitle?: string, gameImage?: string }} meta
 * @returns {Promise<{ sessionRow, addedHours, newHours, prevHours }|null>}
 */
export async function logManualSession(igdbGameId, minutes, playedOn, meta = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const seconds = Math.round(minutes * 60)
    // Noon UTC on the played date is within the correct calendar day for
    // virtually all timezones (UTC-11 through UTC+12).
    const noonUtc = `${playedOn}T12:00:00.000Z`

    // 1. Insert session row
    const { data: sessionRow, error } = await supabase
      .from('play_sessions')
      .insert({
        user_id: user.id,
        igdb_game_id: Number(igdbGameId),
        started_at: noonUtc,
        ended_at: noonUtc,
        seconds,
        played_on: playedOn,
        game_title: meta.gameTitle ?? null,
        game_image: meta.gameImage ?? null,
      })
      .select('*')
      .single()

    if (error) {
      console.error('[session] logManualSession insert failed:', error.message)
      return null
    }

    // 2. Increment hours_played on game_trackers
    const addedHours = minutes / 60
    const currentTracker = await getTracker(igdbGameId)
    const prevHours = Number(currentTracker?.hours_played) || 0
    const newHours = prevHours + addedHours

    await setHoursPlayed(igdbGameId, newHours, {
      game_title: meta.gameTitle,
      game_image: meta.gameImage,
    })

    // 3. Ensure one activity for this date (fire-and-forget; never throws)
    ensureActivityForDay(user.id, igdbGameId, playedOn, addedHours, meta).catch(() => {})

    return { sessionRow, addedHours, newHours, prevHours }
  } catch (err) {
    console.error('[session] logManualSession crashed:', err)
    return null
  }
}

/**
 * Insert a 'session_logged' activity for played_on ONLY when none exists yet
 * for that calendar day. Keyed by metadata.played_on so the check is
 * timezone-safe regardless of when the user logs the session.
 */
async function ensureActivityForDay(userId, igdbGameId, playedOn, addedHours, meta) {
  const { data: existing } = await supabase
    .from('activities')
    .select('id')
    .eq('user_id', userId)
    .eq('activity_type', 'session_logged')
    .filter('metadata->>played_on', 'eq', playedOn)
    .limit(1)
    .maybeSingle()

  if (existing) return

  const { error } = await supabase.from('activities').insert({
    user_id: userId,
    activity_type: 'session_logged',
    igdb_game_id: Number(igdbGameId),
    metadata: {
      played_on: playedOn,
      added_hours: addedHours,
      game_title: meta.gameTitle ?? null,
    },
    created_at: `${playedOn}T12:00:00.000Z`,
  })

  if (error) {
    console.error('[session] ensureActivityForDay failed:', error.message)
    return
  }

  try { window.dispatchEvent(new Event('activityUpdated')) } catch {}
}

// ── Fetch manual sessions for a game ─────────────────────────────────────────

/**
 * Return the current user's manually-logged sessions for a specific game,
 * ordered newest played date first. Returns [] on error or when not signed in.
 *
 * @param {number|string} igdbGameId
 * @returns {Promise<Array<{ id: string, playedOn: string, minutes: number }>>}
 */
export async function getManualSessionsForGame(igdbGameId) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
      .from('play_sessions')
      .select('id, played_on, seconds')
      .eq('user_id', user.id)
      .eq('igdb_game_id', Number(igdbGameId))
      .not('played_on', 'is', null)
      .order('played_on', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[session] getManualSessionsForGame failed:', error.message)
      return []
    }

    return (data || []).map(row => ({
      id: row.id,
      playedOn: row.played_on,
      minutes: Math.round((row.seconds || 0) / 60),
    }))
  } catch (err) {
    console.error('[session] getManualSessionsForGame crashed:', err)
    return []
  }
}

// ── Delete a manual session ───────────────────────────────────────────────────

/**
 * Delete a manually-logged session and subtract its duration from hours_played.
 *
 * @param {string}        sessionId
 * @param {number|string} igdbGameId
 * @param {number}        minutes   Duration of the session (to subtract)
 * @returns {Promise<{ removedHours: number, newHours: number }|null>}
 */
export async function deleteManualSession(sessionId, igdbGameId, minutes) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { error } = await supabase
      .from('play_sessions')
      .delete()
      .eq('id', sessionId)
      .eq('user_id', user.id)

    if (error) {
      console.error('[session] deleteManualSession failed:', error.message)
      return null
    }

    const removedHours = minutes / 60
    const currentTracker = await getTracker(igdbGameId)
    const prevHours = Number(currentTracker?.hours_played) || 0
    const newHours = Math.max(0, prevHours - removedHours)

    await setHoursPlayed(igdbGameId, newHours)

    return { removedHours, newHours }
  } catch (err) {
    console.error('[session] deleteManualSession crashed:', err)
    return null
  }
}

// ── Following sessions feed ───────────────────────────────────────────────────

/**
 * Fetch completed play sessions from users the current user follows,
 * aggregated by (user_id, igdb_game_id, calendar date) with durations summed.
 * Scans the last `limit` raw session rows (default 60) before aggregation.
 *
 * Returned items are shaped:
 *   { _type, _sortDate, userId, igdbGameId, playedOn, totalSeconds,
 *     gameTitle, gameImage, username, avatarUrl }
 *
 * @returns {Promise<Array>}
 */
export async function getSessionsFromFollowing({ limit = 60 } = {}) {
  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return []

    const { data: followRows, error: followErr } = await supabase
      .from('follows')
      .select('followee_id')
      .eq('follower_id', user.id)

    if (followErr) {
      console.error('[session] getSessionsFromFollowing follows failed:', followErr.message)
      return []
    }

    const followeeIds = (followRows || []).map(r => r.followee_id)
    if (followeeIds.length === 0) return []

    const { data, error } = await supabase
      .from('play_sessions')
      .select(
        'id, user_id, igdb_game_id, started_at, seconds, game_title, game_image, played_on,' +
        ' users!play_sessions_user_id_fkey(username, display_name, avatar_url)'
      )
      .in('user_id', followeeIds)
      .not('ended_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[session] getSessionsFromFollowing query failed:', error.message)
      return []
    }

    // Aggregate per (user_id, igdb_game_id, calendar date), summing seconds
    const map = new Map()
    for (const row of (data || [])) {
      const date = row.played_on || row.started_at?.slice(0, 10)
      if (!date) continue
      const key = `${row.user_id}::${row.igdb_game_id}::${date}`
      if (!map.has(key)) {
        map.set(key, {
          _type: 'session',
          _sortDate: date,
          userId: row.user_id,
          igdbGameId: Number(row.igdb_game_id),
          playedOn: date,
          totalSeconds: 0,
          gameTitle: row.game_title || null,
          gameImage: row.game_image || null,
          username: row.users?.username || row.users?.display_name || 'someone',
          avatarUrl: row.users?.avatar_url || null,
        })
      }
      const entry = map.get(key)
      entry.totalSeconds += Number(row.seconds) || 0
      if (!entry.gameTitle && row.game_title) entry.gameTitle = row.game_title
      if (!entry.gameImage && row.game_image) entry.gameImage = row.game_image
    }

    return Array.from(map.values()).sort((a, b) =>
      b.playedOn.localeCompare(a.playedOn)
    )
  } catch (err) {
    console.error('[session] getSessionsFromFollowing crashed:', err)
    return []
  }
}

// ── Abort (discard without saving) ────────────────────────────────────────────

/**
 * Discard an open session without logging hours. Used when the user
 * cancels a session rather than stopping it normally.
 *
 * @param {string} sessionId
 */
export async function discardSession(sessionId) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase
      .from('play_sessions')
      .delete()
      .eq('id', sessionId)
      .eq('user_id', user.id)
  } catch (err) {
    console.error('[session] discardSession crashed:', err)
  }
}

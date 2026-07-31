// Session Service — logs play sessions (timed or manual), rolls the
// duration up into the game's tracked hours, and always records a diary
// entry for the session.
//
// Schema:
//   play_sessions (id, user_id, igdb_game_id, started_at, ended_at, hours,
//                  seconds, note, played_on, game_title, game_image,
//                  created_at)
//     `hours` (numeric) is the canonical duration field — added by
//     supabase/migrations/20260723190000_play_sessions_hours_rollup_diary.sql.
//     `seconds` is kept in sync alongside it purely for legacy readers
//     (getSessionsFromFollowing, getManualSessionsForGame) that were built
//     before `hours` existed — every writer below sets both together.
//
//   journal_entries (see journalService.js) — the ONE diary/journal table
//     in this app. Every session ALWAYS writes a row here via
//     saveJournalEntry(), even when notes are blank, so "Add to Journal"
//     and session logging share a single, reusable schema. Do NOT write
//     to `game_journal` — that table is a pre-existing parallel diary this
//     refactor retires from new writers (see StopSessionSheet.jsx, which
//     now updates the session's journal_entries row instead of inserting
//     into game_journal).
//
//   game_trackers (…, hours_played) — the single source of truth for a
//     game's lifetime playtime, read by Library / Game Detail / Profile.
//     Rolled up by the `trg_play_sessions_rollup` DB trigger on
//     play_sessions (INSERT / UPDATE OF hours / DELETE) — this file NEVER
//     computes hours_played client-side. That read-then-write pattern is
//     exactly what produced double-counting/drift risk before; the
//     trigger runs inside the same transaction as the session write, so
//     concurrent logs on the same game can't race.
//
//   activities    (id, user_id, activity_type, igdb_game_id, metadata) —
//     legacy streak calendar, deduped to one 'session_logged' row per
//     calendar day.
//
//   activity_events (Pulse/F1) — one 'played' event per logged session via
//     logActivityEvent(), so sessions can surface in the follow-graph feed.
//
// None of these functions throw — errors are logged and surfaced as null
// returns so callers can show graceful fallbacks without a try/catch every
// call-site.

import { supabase } from './supabase'
import { getTracker } from './hoursService'
import { saveJournalEntry } from './journalService'
import {
  ACTIVITY_EVENT_TYPES,
  logActivityEvent,
} from './activityEventsService'
import { updateStreak } from './streakMilestoneService'
import { dispatchStreakUpdated } from '../components/MilestoneCelebration'

// ── Shared side effects ────────────────────────────────────────────────────
//
// Diary + streak-calendar + Pulse side effects shared by every session
// write path (logSession's manual/quick log, and the timer stop flow).
// Playtime rollup is deliberately NOT here — it happens transactionally
// via the trg_play_sessions_rollup DB trigger on the play_sessions write
// itself, so it can never be double-applied or skipped independently of
// whichever function below actually wrote the session row.

/**
 * @returns {Promise<object|null>} the created journal_entries row
 */
async function applySessionSideEffects({
  igdbGameId,
  hours,
  notes,
  gameTitle,
  gameImage,
  playedOn,
}) {
  // 1. Diary — ALWAYS create an entry, even with blank notes. A session
  //    with no note still records playtime + timestamp + game.
  let journalEntry = null
  try {
    journalEntry = await saveJournalEntry({
      igdbGameId,
      title: null,
      body: notes && notes.trim() ? notes.trim() : '',
      gameTitle,
      gameImage,
      hoursPlayed: hours,
    })
  } catch (err) {
    console.error('[session] journal entry write failed:', err)
  }

  // 2. Legacy streak calendar — de-duped once per day (fire-and-forget).
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    ensureActivityForDay(user.id, igdbGameId, playedOn, hours, { gameTitle }).catch(() => {})
  }

  // 3. Pulse — one 'played' activity_event per logged session so it can
  //    appear in the follow-graph feed.
  if (hours > 0) {
    logActivityEvent({
      type: ACTIVITY_EVENT_TYPES.PLAYED,
      entityId: String(igdbGameId),
      metadata: {
        seconds: Math.round(hours * 3600),
        added_hours: hours,
        played_on: playedOn,
        game_title: gameTitle ?? null,
        game_image: gameImage ?? null,
        source: 'session',
      },
    })
  }

  return journalEntry
}

/**
 * Read the tracker's current hours_played AFTER a play_sessions write has
 * already committed (and the rollup trigger has already run as part of
 * that same transaction). Used only to shape a friendly return value for
 * confirmation UIs — never to compute the rollup itself.
 */
async function readHoursAfterRollup(igdbGameId, addedHours) {
  const tracker = await getTracker(igdbGameId)
  const newHours = tracker?.hours_played != null ? Number(tracker.hours_played) : addedHours
  const prevHours = Math.max(0, newHours - addedHours)
  return { newHours, prevHours }
}

// ── logSession — THE single entry point for logging a play session ────────

/**
 * Log a play session for a game. This is the single entry point every
 * caller should use: quick-log sheets, the manual "log a session" forms
 * on Game Detail / tracker rows, and any future caller all call this
 * directly. The live timer (start/stop) flow shares the same
 * `applySessionSideEffects` helper above but must UPDATE the in-progress
 * row it already opened via `startSession()` rather than INSERT a new
 * one — see `stopSession` below.
 *
 * Writes a play_sessions row (hours_played rollup happens automatically
 * via the DB trigger — never computed here), ALWAYS creates a diary
 * entry (even with blank notes), logs the legacy streak activity, and
 * emits a Pulse 'played' activity_event.
 *
 * @param {{
 *   gameId: number|string,
 *   hours: number,
 *   notes?: string|null,
 *   gameTitle?: string|null,
 *   gameImage?: string|null,
 *   playedOn?: string,   'YYYY-MM-DD', defaults to today
 * }} args
 * @returns {Promise<{
 *   sessionRow: object,
 *   journalEntry: object|null,
 *   addedHours: number,
 *   newHours: number,
 *   prevHours: number,
 * }|null>}
 */
export async function logSession({
  gameId,
  hours,
  notes = null,
  gameTitle = null,
  gameImage = null,
  playedOn = null,
} = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const h = Math.round((Number(hours) || 0) * 100) / 100
    if (!(h > 0)) {
      console.warn('[session] logSession called with non-positive hours:', hours)
      return null
    }

    const dateStr = playedOn || new Date().toISOString().split('T')[0]
    const noonUtc = `${dateStr}T12:00:00.000Z`
    const seconds = Math.round(h * 3600)

    const { data: sessionRow, error } = await supabase
      .from('play_sessions')
      .insert({
        user_id: user.id,
        igdb_game_id: Number(gameId),
        hours: h,
        seconds,
        started_at: noonUtc,
        ended_at: noonUtc,
        played_on: dateStr,
        note: notes && notes.trim() ? notes.trim() : null,
        game_title: gameTitle,
        game_image: gameImage,
      })
      .select('*')
      .single()

    if (error) {
      console.error('[session] logSession insert failed:', error.message)
      return null
    }

    const journalEntry = await applySessionSideEffects({
      igdbGameId: gameId,
      hours: h,
      notes,
      gameTitle,
      gameImage,
      playedOn: dateStr,
    })

    const { newHours, prevHours } = await readHoursAfterRollup(gameId, h)

    try { window.dispatchEvent(new Event('libraryUpdated')) } catch {}

    return { sessionRow, journalEntry, addedHours: h, newHours, prevHours }
  } catch (err) {
    console.error('[session] logSession crashed:', err)
    return null
  }
}

// ── Start (timer) ───────────────────────────────────────────────────────────

/**
 * Insert a new play session row with started_at = now(). `hours` is left
 * null until the session is stopped (so the rollup trigger does not fire
 * on start — there's no playtime yet). Returns the inserted row or null
 * on error.
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

// ── Stop (timer) ─────────────────────────────────────────────────────────────

/**
 * End a play session started via `startSession`:
 *   1. Close the row (ended_at, seconds, hours) — the rollup trigger fires
 *      on this UPDATE OF hours and atomically increments
 *      game_trackers.hours_played. No client-side read-then-write here.
 *   2. ALWAYS create a diary entry for the session, even with a blank
 *      body — the note UI (StopSessionSheet) is shown *after* this
 *      resolves, so the note isn't known yet; the caller can fill it in
 *      afterwards via `updateJournalEntry(result.journalEntry.id, …)`.
 *   3. Log the legacy streak activity + Pulse 'played' event.
 *
 * Returns { sessionRow, journalEntry, addedHours, newHours, prevHours } or
 * null on hard failure.
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
    const hours = Math.round((seconds / 3600) * 100) / 100

    // 1. Close the session row. The trg_play_sessions_rollup trigger fires
    //    on this UPDATE (hours: null → hours) and applies the rollup.
    const { data: sessionRow, error: stopErr } = await supabase
      .from('play_sessions')
      .update({
        ended_at: now.toISOString(),
        seconds,
        hours,
        note: opts.note && opts.note.trim() ? opts.note.trim() : null,
      })
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .select('*')
      .single()

    if (stopErr) {
      console.error('[session] stopSession update failed:', stopErr.message)
      return null
    }

    const playedOn = now.toISOString().split('T')[0]

    // 2 & 3. Diary (always, even blank) + streak + Pulse.
    const journalEntry = await applySessionSideEffects({
      igdbGameId,
      hours,
      notes: opts.note,
      gameTitle: opts.gameTitle,
      gameImage: opts.gameImage,
      playedOn,
    })

    const { newHours, prevHours } = await readHoursAfterRollup(igdbGameId, hours)

    try { window.dispatchEvent(new Event('libraryUpdated')) } catch {}

    return { sessionRow, journalEntry, addedHours: hours, newHours, prevHours }
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
 * Log a manual play session (no live timer). Thin wrapper around
 * `logSession` kept for backward compatibility with existing call sites
 * (QuickLogSheet, GameDetail's log-session form, TrackerGameList's
 * LogSessionSheet) — all of them ultimately funnel through the single
 * `logSession` entry point.
 *
 * @param {number|string} igdbGameId
 * @param {number} minutes  Duration in whole minutes (> 0)
 * @param {string} playedOn Local date string 'YYYY-MM-DD'
 * @param {{ gameTitle?: string, gameImage?: string }} meta
 * @returns {Promise<{ sessionRow, journalEntry, addedHours, newHours, prevHours }|null>}
 */
export async function logManualSession(igdbGameId, minutes, playedOn, meta = {}) {
  return logSession({
    gameId: igdbGameId,
    hours: Number(minutes) / 60,
    notes: null,
    playedOn,
    gameTitle: meta.gameTitle,
    gameImage: meta.gameImage,
  })
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
  // Session logged — advance the streak and fire milestone check.
  updateStreak(userId)
    .then((row) => { if (row) dispatchStreakUpdated(row.current_streak) })
    .catch(() => {})
}

// ── Fetch manual sessions for a game ─────────────────────────────────────────

/**
 * Return the current user's manually-logged sessions for a specific game,
 * ordered newest first (played_on, then created_at to disambiguate same-day
 * entries — this is what makes `sessions[0]` a reliable "latest session").
 * Returns [] on error or when not signed in.
 *
 * `limit` defaults high enough to cover a game's full session history for
 * the per-game history sub-screen — no separate "list all" function needed
 * since a single manually-logged game realistically never approaches it.
 *
 * @param {number|string} igdbGameId
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<{ id: string, playedOn: string, minutes: number, hours: number }>>}
 */
export async function getManualSessionsForGame(igdbGameId, { limit = 200 } = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
      .from('play_sessions')
      .select('id, played_on, seconds, hours, created_at')
      .eq('user_id', user.id)
      .eq('igdb_game_id', Number(igdbGameId))
      .not('played_on', 'is', null)
      .order('played_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[session] getManualSessionsForGame failed:', error.message)
      return []
    }

    return (data || []).map(row => ({
      id: row.id,
      playedOn: row.played_on,
      minutes: Math.round((row.seconds || 0) / 60),
      hours: Number(row.hours) || 0,
    }))
  } catch (err) {
    console.error('[session] getManualSessionsForGame crashed:', err)
    return []
  }
}

// ── Update a manual session ──────────────────────────────────────────────────

/**
 * Update a manually-logged session's duration and/or date. The rollup
 * trigger fires on this UPDATE (`hours`: old → new) and atomically applies
 * the delta to game_trackers.hours_played — no client-side math here, so an
 * edit can never drift out of sync with what's actually rolled up.
 *
 * @param {string}        sessionId
 * @param {number|string} igdbGameId
 * @param {{ minutes: number, playedOn: string }} updates
 * @returns {Promise<{ id: string, playedOn: string, minutes: number, hours: number, newHours: number }|null>}
 */
export async function updateManualSession(sessionId, igdbGameId, { minutes, playedOn } = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const hours = Math.round((Number(minutes) / 60) * 100) / 100
    if (!(hours > 0) || !playedOn) {
      console.warn('[session] updateManualSession called with invalid input:', { minutes, playedOn })
      return null
    }

    const { data, error } = await supabase
      .from('play_sessions')
      .update({
        hours,
        seconds: Math.round(hours * 3600),
        played_on: playedOn,
      })
      .eq('id', sessionId)
      .eq('user_id', user.id)
      .select('id, played_on, seconds, hours')
      .single()

    if (error) {
      console.error('[session] updateManualSession failed:', error.message)
      return null
    }

    const tracker = await getTracker(igdbGameId)
    const newHours = Number(tracker?.hours_played) || 0

    try { window.dispatchEvent(new Event('libraryUpdated')) } catch {}

    return {
      id: data.id,
      playedOn: data.played_on,
      minutes: Math.round((data.seconds || 0) / 60),
      hours: Number(data.hours) || 0,
      newHours,
    }
  } catch (err) {
    console.error('[session] updateManualSession crashed:', err)
    return null
  }
}

// ── Delete a manual session ───────────────────────────────────────────────────

/**
 * Delete a manually-logged session. The rollup trigger fires on this
 * DELETE and atomically subtracts the row's `hours` from
 * game_trackers.hours_played — no client-side subtraction here, so a
 * delete can never drift out of sync with what was actually rolled up.
 *
 * @param {string}        sessionId
 * @param {number|string} igdbGameId
 * @param {number}        minutes   Duration of the session (for the
 *                                  returned `removedHours`, display only)
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

    const tracker = await getTracker(igdbGameId)
    const newHours = Number(tracker?.hours_played) || 0

    try { window.dispatchEvent(new Event('libraryUpdated')) } catch {}

    return { removedHours: Number(minutes) / 60, newHours }
  } catch (err) {
    console.error('[session] deleteManualSession crashed:', err)
    return null
  }
}

// ── Sessions for a date range (weekly rhythm card) ─────────────────────────────

/**
 * Fetch the current user's completed play sessions whose `started_at` falls
 * within [rangeStartIso, rangeEndIso) — used by the Home "This week" card
 * and its week-detail view. Only closed sessions count (`ended_at IS NOT
 * NULL`) so an in-progress timer never inflates the week's hours/session
 * count before it's actually stopped.
 *
 * Ordered newest-first. Returns [] on error, when signed out, or when the
 * week genuinely has no sessions — callers must render a neutral empty
 * state rather than fabricating rows.
 *
 * @param {string} userId
 * @param {string} rangeStartIso  ISO timestamp, inclusive
 * @param {string} rangeEndIso    ISO timestamp, exclusive
 * @returns {Promise<Array<{
 *   id: string,
 *   igdbGameId: number|null,
 *   gameTitle: string|null,
 *   gameImage: string|null,
 *   hours: number,
 *   note: string|null,
 *   startedAt: string,
 *   playedOn: string|null,   'YYYY-MM-DD', derived from played_on or started_at
 * }>>}
 */
export async function getSessionsForWeek(userId, rangeStartIso, rangeEndIso) {
  if (!userId || !rangeStartIso || !rangeEndIso) return []

  try {
    const { data, error } = await supabase
      .from('play_sessions')
      .select('id, igdb_game_id, game_title, game_image, hours, note, started_at, ended_at, played_on')
      .eq('user_id', userId)
      .not('ended_at', 'is', null)
      .gte('started_at', rangeStartIso)
      .lt('started_at', rangeEndIso)
      .order('started_at', { ascending: false })

    if (error) {
      console.error('[session] getSessionsForWeek failed:', error.message)
      return []
    }

    return (data || []).map((row) => ({
      id: row.id,
      igdbGameId: row.igdb_game_id != null ? Number(row.igdb_game_id) : null,
      gameTitle: row.game_title || null,
      gameImage: row.game_image || null,
      hours: Number(row.hours) || 0,
      note: row.note || null,
      startedAt: row.started_at,
      playedOn: row.played_on || (row.started_at ? row.started_at.slice(0, 10) : null),
    }))
  } catch (err) {
    console.error('[session] getSessionsForWeek crashed:', err)
    return []
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
 * cancels a session rather than stopping it normally. The row being
 * deleted here always has `hours IS NULL` (never closed), so the rollup
 * trigger's delta is 0 — nothing to undo.
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

import { supabase } from './supabase'
import {
  ACTIVITY_EVENT_TYPES,
  logActivityEvent,
} from './activityEventsService'

/**
 * Streak Milestone Service
 *
 * Rules:
 *
 *   Milestones: 3 / 7 / 15 / 30 / 100 consecutive active days (Spark /
 *     Ember / Kindled / Blaze / Wildfire — see streakMilestoneState.js,
 *     the single source of truth for tier names/colors/copy).
 *
 *     S16-2 — persisted SERVER-SIDE in `user_streak_milestones`
 *     (user_id, milestone_days, reached_at, celebrated_at), NOT
 *     localStorage-only, so it survives reinstall and is readable
 *     cross-device and by other users (profile flair, task 5).
 *
 *     DECISION (task 6): a milestone celebrates ONCE PER USER, EVER —
 *     not once per crossing. `reached_at` is written the first time
 *     current_streak crosses a tier and is NEVER cleared or re-written
 *     on a later reset + re-cross of that same tier (rows are inserted
 *     with ON CONFLICT DO NOTHING — see recordStreakMilestoneProgress
 *     below). A user who drops from day 8 back to day 0 and climbs
 *     back through day 7 (Ember) a second time is NOT re-congratulated:
 *     getPendingCelebrations only ever returns rows with
 *     celebrated_at IS NULL, and that row's celebrated_at was already
 *     set the first time through.
 *
 *     `users.highest_streak_milestone` is a denormalized cache of the
 *     highest tier ever reached (kept in sync here), independent of
 *     the CURRENT streak — it's what reviews/Pulse read for flair, via
 *     the same `users!..._fkey(...)` embed those surfaces already
 *     select, with no extra join per card.
 *
 *   Streak freeze: one freeze token per ISO calendar week (Mon–Sun).
 *     Stored in user_streaks as (freezes_remaining, freeze_week).
 *     `freeze_week` is the ISO week string ('YYYY-Www') when the last
 *     freeze was issued OR when it was last refreshed.
 *
 *     Weekly refresh logic (runs inside updateStreak before freeze math):
 *       If freezes_remaining === 0 AND freeze_week !== currentISOWeek,
 *       set freezes_remaining = 1 so the new week's token is available.
 *
 *     When consuming a freeze (2-day gap bridged):
 *       freezes_remaining → 0, freeze_week → currentISOWeek.
 *
 *   user_streaks columns used:
 *     user_id, current_streak, longest_streak, last_active_date,
 *     freezes_remaining, freeze_week
 */

import { STREAK_MILESTONE_DAYS } from './streakMilestoneState'

export const MILESTONES = STREAK_MILESTONE_DAYS

/* ──────────────────────────────────────────────────────────────────────
   Server-side milestone reached/celebrated state (S16-2)
   ────────────────────────────────────────────────────────────────────── */

/**
 * Idempotently records which of MILESTONES have been reached as of
 * `currentStreak`, and bumps `users.highest_streak_milestone` if this is
 * a new high for this user. Safe to call on every 'streakUpdated' event —
 * a tier already reached (even if the streak has since reset and climbed
 * back through it) is left completely untouched: `.upsert(...,
 * { ignoreDuplicates: true })` is `INSERT ... ON CONFLICT DO NOTHING`, so
 * neither `reached_at` nor `celebrated_at` are ever overwritten once set.
 *
 * Returns the milestones that are reached but NOT YET celebrated — i.e.
 * exactly what should fire the UnlockCelebration overlay next.
 */
export async function recordStreakMilestoneProgress(userId, currentStreak) {
  if (!userId || !currentStreak) return []

  const reachedTiers = MILESTONES.filter((m) => currentStreak >= m)
  if (reachedTiers.length === 0) return []

  const { error: upsertError } = await supabase
    .from('user_streak_milestones')
    .upsert(
      reachedTiers.map((m) => ({ user_id: userId, milestone_days: m })),
      { onConflict: 'user_id,milestone_days', ignoreDuplicates: true }
    )
  if (upsertError) {
    console.error('[streak] recordStreakMilestoneProgress upsert failed:', upsertError.message)
  }

  // Keep the flair cache in sync — only ever moves up, never down (a
  // reset streak must not un-flair a user who already earned a tier).
  const newHigh = Math.max(...reachedTiers)
  const { data: userRow, error: userReadError } = await supabase
    .from('users')
    .select('highest_streak_milestone')
    .eq('id', userId)
    .maybeSingle()
  if (userReadError) {
    console.error('[streak] highest_streak_milestone read failed:', userReadError.message)
  } else if (!userRow || (userRow.highest_streak_milestone ?? 0) < newHigh) {
    const { error: userUpdateError } = await supabase
      .from('users')
      .update({ highest_streak_milestone: newHigh })
      .eq('id', userId)
    if (userUpdateError) {
      console.error('[streak] highest_streak_milestone update failed:', userUpdateError.message)
    }
  }

  return getPendingCelebrations(userId, reachedTiers)
}

/**
 * Reads back which of `milestones` are reached but have celebrated_at
 * still null for this user — i.e. pending a first-ever celebration.
 */
async function getPendingCelebrations(userId, milestones) {
  if (!userId || milestones.length === 0) return []
  const { data, error } = await supabase
    .from('user_streak_milestones')
    .select('milestone_days, celebrated_at')
    .eq('user_id', userId)
    .in('milestone_days', milestones)
  if (error) {
    console.error('[streak] getPendingCelebrations failed:', error.message)
    return []
  }
  return (data || [])
    .filter((row) => !row.celebrated_at)
    .map((row) => row.milestone_days)
}

/**
 * Marks a milestone as celebrated, server-side — permanently, so it can
 * never fire again for this user (see the task-6 decision above).
 *
 * The `.is('celebrated_at', null)` guard makes this a no-op (and
 * `data` comes back empty) if it was somehow already celebrated —
 * e.g. two overlapping 'streakUpdated' handlers racing — so the Pulse
 * 'goal_hit' event below still only ever fires once.
 */
export async function markMilestoneCelebrated(userId, milestone) {
  if (!userId) return
  const { data, error } = await supabase
    .from('user_streak_milestones')
    .update({ celebrated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('milestone_days', milestone)
    .is('celebrated_at', null)
    .select()
  if (error) {
    console.error('[streak] markMilestoneCelebrated failed:', error.message)
    return
  }
  if (data && data.length > 0) {
    logActivityEvent({
      type: ACTIVITY_EVENT_TYPES.GOAL_HIT,
      entityId: String(milestone),
      metadata: { milestone, kind: 'streak' },
    })
  }
}

/* ──────────────────────────────────────────────────────────────────────
   DB helpers
   ────────────────────────────────────────────────────────────────────── */

/**
 * Load streak row for this user. Returns null if the row doesn't exist.
 */
export async function getStreakData(userId) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('user_streaks')
    .select('user_id, current_streak, longest_streak, last_active_date, freezes_remaining, freeze_week')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('[streak] getStreakData failed:', error.message)
    return null
  }
  return data
}

/**
 * Called whenever the user completes an activity (status change, review,
 * session logged, etc.).  Updates user_streaks with freeze logic:
 *
 *   today = gap of 0 days → streak += 1 (or stays 1 on first activity)
 *   yesterday = gap of 1 day → normal continuation
 *   1-day gap (missed yesterday) AND freeze available → consume freeze,
 *                                                         treat as continuation
 *   > 1-day gap → streak resets to 1 (no guilt, no message)
 *   already updated today → no-op
 *
 * Returns the updated streak row (or the existing row unchanged if no-op).
 */
export async function updateStreak(userId) {
  if (!userId) return null

  const today = localDateString(new Date())

  // Upsert pattern: fetch first, then decide.
  const existing = await getStreakData(userId)

  const thisWeek = isoWeek(new Date())

  if (!existing) {
    // First ever activity — create the row.
    const newRow = {
      user_id: userId,
      current_streak: 1,
      longest_streak: 1,
      last_active_date: today,
      freezes_remaining: 1,
      freeze_week: thisWeek,
    }
    const { data, error } = await supabase
      .from('user_streaks')
      .insert(newRow)
      .select()
      .single()
    if (error) console.error('[streak] insert failed:', error.message)
    return data || newRow
  }

  const last = existing.last_active_date // 'YYYY-MM-DD' or null
  if (last === today) return existing // already credited today — no-op

  // Weekly freeze refresh: if we're in a new ISO week and the token was
  // spent (freezes_remaining === 0), restore it before the gap math runs.
  let newFreeze = existing.freezes_remaining
  if (newFreeze === 0 && existing.freeze_week !== thisWeek) {
    newFreeze = 1
  }

  const gapDays = last ? daysBetween(last, today) : null
  let newStreak = existing.current_streak
  let newFreezeWeek = existing.freeze_week ?? thisWeek

  if (gapDays === null || gapDays === 1) {
    // Continuing streak or normal +1 day.
    newStreak = existing.current_streak + 1
  } else if (gapDays === 2 && newFreeze > 0) {
    // 1-day miss + freeze available → bridge the gap silently.
    newStreak = existing.current_streak + 1
    newFreeze = newFreeze - 1
    newFreezeWeek = thisWeek // stamp the week the freeze was consumed
  } else {
    // Reset — celebrate the return, never punish.
    newStreak = 1
  }

  const newLongest = Math.max(existing.longest_streak, newStreak)

  const { data, error } = await supabase
    .from('user_streaks')
    .update({
      current_streak: newStreak,
      longest_streak: newLongest,
      last_active_date: today,
      freezes_remaining: newFreeze,
      freeze_week: newFreezeWeek,
    })
    .eq('user_id', userId)
    .select()
    .single()

  if (error) console.error('[streak] update failed:', error.message)
  return data || {
    ...existing,
    current_streak: newStreak,
    longest_streak: newLongest,
    last_active_date: today,
    freezes_remaining: newFreeze,
    freeze_week: newFreezeWeek,
  }
}

/* ──────────────────────────────────────────────────────────────────────
   Date helpers
   ────────────────────────────────────────────────────────────────────── */

/** 'YYYY-MM-DD' in local time */
function localDateString(d) {
  const yr = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${yr}-${mo}-${da}`
}

/** Number of calendar days from ISO date string a to b (b > a → positive). */
function daysBetween(a, b) {
  const da = new Date(`${a}T00:00:00`)
  const db = new Date(`${b}T00:00:00`)
  return Math.round((db - da) / 86400000)
}

/**
 * ISO 8601 week string: 'YYYY-Www' (e.g. '2026-W26').
 * Week 1 is the week containing the first Thursday of the year
 * (ISO 8601 standard). Weeks start on Monday.
 */
function isoWeek(d) {
  // Copy to avoid mutating the original
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  // ISO weeks start on Monday; adjust day so Monday = 0
  const day = (date.getUTCDay() + 6) % 7
  // Nearest Thursday = start of the ISO week's reference day
  date.setUTCDate(date.getUTCDate() - day + 3)
  const jan4 = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const weekNum = 1 + Math.round((date - jan4) / 604800000)
  const year = date.getUTCFullYear()
  return `${year}-W${String(weekNum).padStart(2, '0')}`
}

/* ──────────────────────────────────────────────────────────────────────
   Freeze status helpers (for UI)
   ────────────────────────────────────────────────────────────────────── */

export function hasFreezeAvailable(streakData) {
  return (streakData?.freezes_remaining ?? 0) > 0
}

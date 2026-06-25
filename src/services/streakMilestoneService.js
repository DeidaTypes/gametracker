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
 *   Milestones: 7 / 30 / 100 consecutive active days.
 *     Each milestone fires ONCE per user per lifetime (persisted in
 *     localStorage so it works even while the user is offline).
 *     Key: 'gt:milestone-seen:v1:{userId}:{milestone}'
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

export const MILESTONES = [7, 30, 100]

/* ──────────────────────────────────────────────────────────────────────
   Local milestone-seen helpers
   ────────────────────────────────────────────────────────────────────── */

function milestoneKey(userId, milestone) {
  return `gt:milestone-seen:v1:${userId}:${milestone}`
}

/**
 * Returns the list of milestones (from MILESTONES) that:
 *   a) current_streak >= milestone, AND
 *   b) the user has NOT yet seen the celebration for this milestone.
 *
 * Side-effect-free — call multiple times safely.
 */
export function getPendingMilestones(userId, currentStreak) {
  if (!userId || !currentStreak) return []
  return MILESTONES.filter(
    (m) =>
      currentStreak >= m &&
      !localStorage.getItem(milestoneKey(userId, m))
  )
}

/**
 * Mark milestone as seen so it never shows again.
 *
 * Side-effect: emits a Pulse 'goal_hit' activity_event the first time
 * a given milestone is marked seen for this user. The localStorage
 * guard above (`milestoneKey`) means the celebration fires once per
 * user per milestone, and so does the Pulse event — no double-firing
 * on re-mount or repeated streakUpdated dispatches.
 */
export function markMilestoneSeen(userId, milestone) {
  if (!userId) return
  let alreadySeen = false
  try {
    alreadySeen = !!localStorage.getItem(milestoneKey(userId, milestone))
    localStorage.setItem(milestoneKey(userId, milestone), '1')
  } catch {
    // localStorage full — best effort
  }
  if (!alreadySeen) {
    logActivityEvent({
      type: ACTIVITY_EVENT_TYPES.GOAL_HIT,
      entityId: String(milestone),
      metadata: { milestone, kind: 'streak' },
    })
  }
}

/**
 * Check whether a specific milestone has been seen.
 */
export function isMilestoneSeen(userId, milestone) {
  if (!userId) return true
  return !!localStorage.getItem(milestoneKey(userId, milestone))
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

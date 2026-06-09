import { supabase } from './supabase'

/**
 * Streak Milestone Service
 *
 * Rules (matches the prompt spec):
 *
 *   Milestones: 7 / 30 / 100 consecutive active days.
 *     Each milestone fires ONCE per user per lifetime (persisted in
 *     localStorage so it works even while the user is offline).
 *     Key: 'gt:milestone-seen:v1:{userId}:{milestone}'
 *
 *   Streak freeze: the user_streaks table already has `freezes_remaining`
 *     (default 1) from the Heartbeat sprint. We reuse that field.
 *     When updateStreak() finds exactly a 1-day gap AND freezes_remaining > 0,
 *     it silently consumes the freeze (streak extends, freezes_remaining → 0).
 *     No red message is shown; the freeze is invisible until it's spent.
 *     Freezes do NOT reset — the user gets one freeze for the lifetime of
 *     their streak. If they want another, that's a Sprint 6 affordance.
 *
 *   user_streaks columns used:
 *     user_id, current_streak, longest_streak, last_active_date,
 *     freezes_remaining
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
 */
export function markMilestoneSeen(userId, milestone) {
  if (!userId) return
  try {
    localStorage.setItem(milestoneKey(userId, milestone), '1')
  } catch {
    // localStorage full — best effort
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
    .select('user_id, current_streak, longest_streak, last_active_date, freezes_remaining')
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

  if (!existing) {
    // First ever activity — create the row.
    const newRow = {
      user_id: userId,
      current_streak: 1,
      longest_streak: 1,
      last_active_date: today,
      freezes_remaining: 1,
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

  const gapDays = last ? daysBetween(last, today) : null
  let newStreak = existing.current_streak
  let newFreeze = existing.freezes_remaining

  if (gapDays === null || gapDays === 1) {
    // Continuing streak (first activity ever handled above) or normal +1 day.
    newStreak = existing.current_streak + 1
  } else if (gapDays === 2 && existing.freezes_remaining > 0) {
    // 1-day miss + freeze available → bridge the gap silently.
    newStreak = existing.current_streak + 1
    newFreeze = existing.freezes_remaining - 1
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
    })
    .eq('user_id', userId)
    .select()
    .single()

  if (error) console.error('[streak] update failed:', error.message)
  return data || { ...existing, current_streak: newStreak, longest_streak: newLongest, last_active_date: today, freezes_remaining: newFreeze }
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

/* ──────────────────────────────────────────────────────────────────────
   Freeze status helpers (for UI)
   ────────────────────────────────────────────────────────────────────── */

export function hasFreezeAvailable(streakData) {
  return (streakData?.freezes_remaining ?? 0) > 0
}

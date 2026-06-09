import { supabase } from './supabase'

/**
 * Goal Service — yearly game-count challenge.
 *
 * Schema (user_goals):
 *   user_id  uuid    PK (FK → users)
 *   year     smallint PK
 *   target   integer  (1–9999)
 *   created_at, updated_at timestamptz
 *
 * "Finished this year" is counted from the activities table:
 *   COUNT(DISTINCT igdb_game_id) WHERE activity_type = 'status_changed'
 *   AND metadata->>'to_status' = 'played'
 *   AND EXTRACT(YEAR FROM created_at) = <year>
 *
 * Only activities in Supabase are counted — never localStorage-only
 * data — so the number is always reproducible from real records.
 */

/* ──────────────────────────────────────────────────────────────────────
   getGoal
   ────────────────────────────────────────────────────────────────────── */

/**
 * Fetch the goal row for (userId, year). Returns null when not set.
 * @param {string} userId
 * @param {number} year
 * @returns {Promise<{ userId: string, year: number, target: number } | null>}
 */
export async function getGoal(userId, year) {
  if (!userId || !year) return null
  const { data, error } = await supabase
    .from('user_goals')
    .select('user_id, year, target')
    .eq('user_id', userId)
    .eq('year', year)
    .maybeSingle()

  if (error) {
    console.error('[goal] getGoal failed:', error.message)
    return null
  }
  if (!data) return null
  return { userId: data.user_id, year: data.year, target: data.target }
}

/* ──────────────────────────────────────────────────────────────────────
   setGoal
   ────────────────────────────────────────────────────────────────────── */

/**
 * Upsert the goal for (userId, year). Overwrites target if it already exists.
 * @param {string} userId
 * @param {number} year
 * @param {number} target  — must be 1–9999
 * @returns {Promise<boolean>}   true on success
 */
export async function setGoal(userId, year, target) {
  if (!userId || !year || !target) return false
  const clamped = Math.max(1, Math.min(9999, Math.round(target)))

  const { error } = await supabase.from('user_goals').upsert(
    {
      user_id: userId,
      year,
      target: clamped,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,year' }
  )
  if (error) {
    console.error('[goal] setGoal failed:', error.message)
    return false
  }
  return true
}

/* ──────────────────────────────────────────────────────────────────────
   deleteGoal
   ────────────────────────────────────────────────────────────────────── */

/**
 * Remove the goal row so the user can start fresh.
 */
export async function deleteGoal(userId, year) {
  if (!userId || !year) return false
  const { error } = await supabase
    .from('user_goals')
    .delete()
    .eq('user_id', userId)
    .eq('year', year)
  if (error) {
    console.error('[goal] deleteGoal failed:', error.message)
    return false
  }
  return true
}

/* ──────────────────────────────────────────────────────────────────────
   countFinishedThisYear
   ────────────────────────────────────────────────────────────────────── */

/**
 * Count DISTINCT games the user marked as "played" (Finished) in a
 * given calendar year, using the activities table.
 *
 * A game is counted once even if the user toggled Played → Playing →
 * Played multiple times in the same year — we only need the distinct
 * igdb_game_id set, not the event count.
 *
 * @param {string} userId
 * @param {number} year   — defaults to current calendar year
 * @returns {Promise<number>}
 */
export async function countFinishedThisYear(userId, year = new Date().getFullYear()) {
  if (!userId) return 0

  const yearStart = `${year}-01-01T00:00:00.000Z`
  const yearEnd   = `${year + 1}-01-01T00:00:00.000Z`

  const { data, error } = await supabase
    .from('activities')
    .select('igdb_game_id')
    .eq('user_id', userId)
    .eq('activity_type', 'status_changed')
    .eq('metadata->>to_status', 'played')
    .gte('created_at', yearStart)
    .lt('created_at', yearEnd)
    .not('igdb_game_id', 'is', null)

  if (error) {
    console.error('[goal] countFinishedThisYear failed:', error.message)
    return 0
  }

  // Deduplicate in JS (the query already filters to only played events but
  // a user might mark the same game played twice after un-marking it).
  const unique = new Set((data || []).map((r) => r.igdb_game_id))
  return unique.size
}

/* ──────────────────────────────────────────────────────────────────────
   getGoalProgress
   ────────────────────────────────────────────────────────────────────── */

/**
 * Convenience: fetch goal + current count in one call.
 *
 * Returns:
 *   {
 *     hasGoal:  boolean,
 *     target:   number | null,   — null when no goal is set
 *     current:  number,          — distinct Finished games this year
 *     year:     number,
 *     percent:  number,          — 0–100, capped at 100
 *   }
 */
export async function getGoalProgress(userId, year = new Date().getFullYear()) {
  if (!userId) {
    return { hasGoal: false, target: null, current: 0, year, percent: 0 }
  }

  const [goal, current] = await Promise.all([
    getGoal(userId, year),
    countFinishedThisYear(userId, year),
  ])

  if (!goal) {
    return { hasGoal: false, target: null, current, year, percent: 0 }
  }

  const percent = Math.min(100, Math.round((current / goal.target) * 100))
  return { hasGoal: true, target: goal.target, current, year, percent }
}

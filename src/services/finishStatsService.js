import { supabase } from './supabase'

/**
 * Finish Stats Service — real playthrough data for the Finish splash's
 * stat chips (CompletionCelebration).
 *
 * Every function here returns null on missing/ambiguous data rather than
 * guessing — the splash omits a chip entirely when its value is null.
 * Nothing here fabricates a number.
 *
 * Data sources (see DIAGNOSE report):
 *   - hours played:  game_trackers.hours_played        (hoursService.getTracker)
 *   - time span:      activities.created_at             (this file, below)
 *   - Nth this year:  activities via goalService.countFinishedThisYear
 */

/**
 * Find when the user first moved this game to "Playing" (local status
 * 'currently' — see libraryService.setGameStatus's `to_status` metadata
 * vocabulary), so the splash can show a real "started → finished" span.
 *
 * Returns null when no such transition was ever logged for this game —
 * e.g. the user marked it Played directly from Want to Play, or the
 * transition happened before activity logging existed. The caller must
 * omit the time-span chip in that case, never invent a start date.
 *
 * @param {string} userId
 * @param {number|string} igdbGameId
 * @returns {Promise<string|null>}  ISO timestamp, or null
 */
export async function getPlaythroughStartedAt(userId, igdbGameId) {
  if (!userId || igdbGameId == null) return null

  const { data, error } = await supabase
    .from('activities')
    .select('created_at')
    .eq('user_id', userId)
    .eq('igdb_game_id', Number(igdbGameId))
    .eq('activity_type', 'status_changed')
    .eq('metadata->>to_status', 'currently')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[finishStats] getPlaythroughStartedAt failed:', error.message)
    return null
  }
  return data?.created_at || null
}

/**
 * Format a started→finished span as a short, human string — "X months",
 * "X weeks", or "X days", whichever reads most naturally. Same-day spans
 * (< 1 day) return null: "0 days" isn't a meaningful reward beat, and it's
 * indistinguishable from "we don't actually know" to the user.
 *
 * @param {string} startedAtIso
 * @param {string} completedAtIso
 * @returns {string|null}
 */
export function formatPlaythroughSpan(startedAtIso, completedAtIso) {
  if (!startedAtIso || !completedAtIso) return null

  const start = new Date(startedAtIso).getTime()
  const end = new Date(completedAtIso).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null

  const days = Math.round((end - start) / (24 * 60 * 60 * 1000))
  if (days < 1) return null

  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`
  if (days < 60) {
    const weeks = Math.round(days / 7)
    return `${weeks} week${weeks === 1 ? '' : 's'}`
  }
  const months = Math.round(days / 30)
  return `${months} month${months === 1 ? '' : 's'}`
}

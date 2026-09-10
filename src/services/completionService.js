import { setGameStatus } from './libraryService'
import { postReview } from './reviewService'

/**
 * Completion Service — backs RatingSheet.jsx.
 *
 * WHERE THE RATING GOES (diagnosis, see the commit message / chat report
 * for the full write-up):
 *   `game_trackers.rating` exists in the schema but is never written by
 *   any call site in this app (grep confirms the only two
 *   `game_trackers` upserts — syncStatusToServer and addGameToBacklog in
 *   libraryService.js — never set `rating`). `reviews.rating` (NOT NULL,
 *   0.5–5.0) is the field the completion-adjacent surfaces actually read:
 *     - getJustFinished() in communityService.js DOES read
 *       `game_trackers.rating`, but since it's never written that read is
 *       always null in practice.
 *     - The taste engine (supabase/functions/taste-engine/index.ts) reads
 *       BOTH, but only credits `game_trackers.rating` "if not already
 *       rated" via a review — i.e. `reviews.rating` is the live signal.
 *     - profileStatsService.getBestReviews and every reviewService.js
 *       reader (Profile reviews tab/count, GameDetail's rating card +
 *       Top Reviews + Community Pulse + "From People You Follow",
 *       Home Pulse's 'reviewed'/'rated' items) read `reviews.rating`.
 *   Decision: write the rating to `reviews.rating`, via the SAME
 *   `postReview()` mutation the review composer already uses — not a new
 *   write path. A rating with no written text is not a new concept
 *   either: ReviewNew.jsx's own composer already allows `body: ''` with
 *   just a star rating (`hasInput = rating > 0 || text.trim().length > 0`),
 *   so this reuses an existing, already-live shape rather than inventing
 *   one.
 *
 *   Pulse impact: `communityService.js`'s `_fetchHomeFeedReviewRows`
 *   explicitly excludes empty-body rows (`.not('body','is',null).neq
 *   ('body','')`, plus a client-side `.filter((r) => (r.body ||
 *   '').trim())`) from the Home feed — see its doc comment: "Pulse only
 *   surfaces reviews with words. Rating-only rows (empty body) stay off
 *   this feed." So a rating written here with an empty body will NOT
 *   appear on the Pulse feed as a 'reviewed' card — confirmed by reading
 *   that filter, not inferred.
 */

/**
 * Complete a game (status → played) exactly the way `setGameStatus`
 * already does — activities row, activity_events 'completed' row,
 * game_trackers status sync, first-time-Played celebration — and
 * OPTIONALLY attach a star rating via `postReview` (body: '').
 *
 * `rating` is optional. Skip / backdrop-dismiss / swipe-dismiss all call
 * this with `rating` omitted (or 0) — the completion write is byte-for-
 * byte the same call as today's silent finish; nothing about
 * `setGameStatus` itself changes.
 *
 * The rating write is never allowed to roll back or block the
 * completion: if `postReview` throws (network/RLS), the completion has
 * already committed synchronously to localStorage before this function
 * was even called from the caller's perspective (setGameStatus writes
 * local state synchronously) — only `ratingError` comes back true so the
 * caller can toast a retry for the rating specifically.
 *
 * @param {{
 *   gameId: string|number,
 *   game: { id, title, image } ,
 *   rating?: number,       // 0–5, 0/omitted = no rating (Skip/dismiss)
 *   hoursPlayed?: number,  // real hours from game_trackers, never fabricated
 * }} args
 * @returns {Promise<{ ok: boolean, ratingError: boolean }>}
 */
export async function completeGameWithRating({ gameId, game, rating = 0, hoursPlayed = 0 }) {
  const ok = setGameStatus(gameId, 'played', game)
  if (!ok) return { ok: false, ratingError: false }

  const safeRating = Number(rating) || 0
  if (safeRating > 0) {
    try {
      await postReview({
        igdbGameId: gameId,
        body: '',
        rating: safeRating,
        gameTitle: game?.title || null,
        gameImage: game?.image || null,
        hoursPlayed: Number(hoursPlayed) || 0,
      })
    } catch (err) {
      console.error('[completion] rating write failed:', err)
      return { ok: true, ratingError: true }
    }
  }

  return { ok: true, ratingError: false }
}

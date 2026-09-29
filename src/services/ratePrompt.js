import { hasCurrentUserRatedGame } from './reviewService'

export const RATE_IT_EVENT = 'gt:rateIt'

/**
 * After a finish/celebration closes: if this user has no rating for the
 * game, ask the existing RatingSheet to open in dismissible "Rate it?"
 * mode. No-op when already rated.
 */
export async function maybeOpenRateItSheet(game) {
  if (!game?.id) return
  try {
    const rated = await hasCurrentUserRatedGame(game.id)
    if (rated) return
  } catch {
    /* check failed — still offer the sheet; user can dismiss */
  }
  window.dispatchEvent(new CustomEvent(RATE_IT_EVENT, { detail: { game } }))
}

import { getGamesFromList, getGameProgress } from './libraryService'
import { getAllReviews } from './reviewService'

/**
 * Builds a lookup from gameId -> aggregated review data (best rating, total hours).
 * A user may have multiple reviews for the same game; we take the max rating
 * and sum the hours.
 */
function buildReviewMap() {
  const reviews = getAllReviews()
  const map = {}
  for (const r of reviews) {
    const id = String(r.gameId)
    if (!map[id]) {
      map[id] = { rating: 0, hoursPlayed: 0 }
    }
    map[id].rating = Math.max(map[id].rating, r.rating || 0)
    map[id].hoursPlayed += r.hoursPlayed || 0
  }
  return map
}

function allLibraryGames() {
  return [
    ...getGamesFromList('currently-playing'),
    ...getGamesFromList('played'),
    ...getGamesFromList('want-to-play'),
  ]
}

/**
 * Most Played — every library game enriched with total hours from reviews + progress,
 * sorted descending. Only includes games with hours > 0.
 */
export function getMostPlayed(limit = 5) {
  const reviewMap = buildReviewMap()
  const games = allLibraryGames()

  return games
    .map((g) => {
      const id = String(g.id)
      const progress = getGameProgress(id)
      const reviewHours = reviewMap[id]?.hoursPlayed ?? 0
      const progressHours = progress?.hoursPlayed ?? 0
      const totalHours = Math.max(reviewHours, progressHours)
      return { ...g, hoursPlayed: totalHours }
    })
    .filter((g) => g.hoursPlayed > 0)
    .sort((a, b) => b.hoursPlayed - a.hoursPlayed)
    .slice(0, limit)
}

/**
 * Unfinished — games in "currently-playing" that haven't been completed,
 * with progress < 100 (or missing progress). Sorted by progress ascending
 * so the least-progressed games surface first.
 */
export function getUnfinished(limit = 5) {
  const currentlyPlaying = getGamesFromList('currently-playing')
  const playedIds = new Set(getGamesFromList('played').map((g) => String(g.id)))

  return currentlyPlaying
    .filter((g) => !playedIds.has(String(g.id)))
    .map((g) => {
      const progress = getGameProgress(g.id)
      return {
        ...g,
        progressPercent: progress?.progressPercent ?? 0,
      }
    })
    .filter((g) => (g.progressPercent ?? 0) < 100)
    .sort((a, b) => (a.progressPercent ?? 0) - (b.progressPercent ?? 0))
    .slice(0, limit)
}

/**
 * Top Rated — every library game that has a review rating, sorted descending.
 * Falls back to 0 for missing ratings and excludes unrated games.
 */
export function getTopRated(limit = 5) {
  const reviewMap = buildReviewMap()
  const games = allLibraryGames()

  return games
    .map((g) => {
      const id = String(g.id)
      const rating = reviewMap[id]?.rating ?? 0
      return { ...g, userRating: rating }
    })
    .filter((g) => g.userRating > 0)
    .sort((a, b) => b.userRating - a.userRating)
    .slice(0, limit)
}

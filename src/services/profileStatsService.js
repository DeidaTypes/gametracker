import { getAllReviews } from './reviewService'
import { getGamesFromList, getLibrary, initializeLibrary } from './libraryService'

const PROGRESS_STORAGE_KEY = 'gameProgress'

function getAllProgress() {
  const stored = localStorage.getItem(PROGRESS_STORAGE_KEY)
  return stored ? JSON.parse(stored) : {}
}

function getAllTrackedGames() {
  const library = getLibrary() || initializeLibrary()
  const seen = new Set()
  const games = []

  const collectFromList = (listGames) => {
    if (!listGames) return
    for (const g of listGames) {
      const key = String(g.id)
      if (!seen.has(key)) {
        seen.add(key)
        games.push(g)
      }
    }
  }

  if (library.lists) {
    Object.values(library.lists).forEach((list) => collectFromList(list.games))
  }
  if (library.customLists) {
    Object.values(library.customLists).forEach((list) => collectFromList(list.games))
  }

  return games
}

export function getProfileStats() {
  const allGames = getAllTrackedGames()
  const allProgress = getAllProgress()
  const allReviews = getAllReviews()

  const totalGames = allGames.length

  let totalHours = 0
  for (const entry of Object.values(allProgress)) {
    totalHours += parseFloat(entry.hoursPlayed) || 0
  }

  const genreCounts = {}
  const platformCounts = {}

  for (const game of allGames) {
    const genres = game.genres || (game.genre ? game.genre.split(',').map((g) => g.trim()) : [])
    for (const g of genres) {
      if (g) genreCounts[g] = (genreCounts[g] || 0) + 1
    }

    const platforms = game.platforms || []
    for (const p of platforms) {
      if (p) platformCounts[p] = (platformCounts[p] || 0) + 1
    }
  }

  const favoriteGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  const favoritePlatform =
    Object.entries(platformCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null

  return {
    totalGames,
    totalHours: Math.round(totalHours),
    reviewCount: allReviews.length,
    favoriteGenre,
    favoritePlatform,
  }
}

export function getTopFavoriteGames(limit = 5) {
  const allReviews = getAllReviews()
  if (allReviews.length === 0) return []

  const bestByGame = new Map()
  for (const review of allReviews) {
    const key = String(review.gameId)
    const existing = bestByGame.get(key)
    const rating = parseFloat(review.rating) || 0
    if (!existing || rating > existing.rating) {
      bestByGame.set(key, {
        id: review.gameId,
        title: review.gameTitle,
        image: review.gameImage,
        rating,
        reviewText: review.text,
      })
    }
  }

  return Array.from(bestByGame.values())
    .sort((a, b) => b.rating - a.rating)
    .slice(0, limit)
}

export function getRecentlyPlayedGames(limit = 6) {
  const progress = getAllProgress()
  const currentlyPlaying = getGamesFromList('currently-playing')
  const played = getGamesFromList('played')
  const allGames = [...currentlyPlaying, ...played]

  return allGames
    .map((g) => {
      const p = progress[String(g.id)] || {}
      return {
        ...g,
        lastPlayedAt: p.lastPlayedAt || g.addedAt,
        hoursPlayed: p.hoursPlayed,
        progressPercent: p.progressPercent,
      }
    })
    .sort((a, b) => new Date(b.lastPlayedAt || 0) - new Date(a.lastPlayedAt || 0))
    .slice(0, limit)
}

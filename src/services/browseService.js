import {
  getPopularGames,
  getRecentlyReleasedGames,
  getGamesByGenre,
} from './igdb'

const CATEGORY_META = [
  { key: 'top-rated',     label: 'Top Rated',      color: '#7B2D8B', pinned: true },
  { key: 'new-releases',  label: 'New Releases',   color: '#1A6B3A', pinned: true },
  { key: 'action',        label: 'Action',          color: '#C44B1B' },
  { key: 'rpg',           label: 'RPG',             color: '#8B1A1A' },
  { key: 'multiplayer',   label: 'Multiplayer',     color: '#1A5F7A' },
  { key: 'hidden-gems',   label: 'Hidden Gems',     color: '#6B3A8B' },
  { key: 'classic-hits',  label: 'Classic Hits',    color: '#1A3A6B' },
  { key: 'most-reviewed', label: 'Most Reviewed',   color: '#8B6B1A' },
  { key: 'open-world',    label: 'Open World',      color: '#2D6B1A' },
  { key: 'indie',         label: 'Indie',           color: '#8B1A4B' },
]

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null
  return arr[Math.floor(Math.random() * arr.length)]
}

function shuffleNonPinned(categories) {
  const pinned = categories.filter((c) => c.pinned)
  const rest = categories.filter((c) => !c.pinned)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return [...pinned, ...rest]
}

export function getCategoryDefinitions() {
  return CATEGORY_META
}

/**
 * Fetch all browse categories with minimal IGDB round-trips.
 *
 * Strategy: fire one `getPopularGames(30)`, one `getRecentlyReleasedGames(10)`,
 * and all unique genre fetches in a single `Promise.all`. Then derive
 * sub-categories (top-rated, classic-hits, most-reviewed, hidden-gems) from the
 * popular games result — no extra requests.
 */
export async function fetchBrowseCategories() {
  const [popularResult, recentResult, ...genreResults] = await Promise.allSettled([
    getPopularGames(30),
    getRecentlyReleasedGames(10),
    getGamesByGenre('Shooter', 10),
    getGamesByGenre('Role-playing (RPG)', 10),
    getGamesByGenre('Sport', 10),
    getGamesByGenre('Adventure', 10),
    getGamesByGenre('Indie', 20),
  ])

  const popular = popularResult.status === 'fulfilled' ? popularResult.value : []
  const recent = recentResult.status === 'fulfilled' ? recentResult.value : []
  const genreMap = {}
  const genreNames = ['Shooter', 'Role-playing (RPG)', 'Sport', 'Adventure', 'Indie']
  genreNames.forEach((name, i) => {
    genreMap[name] = genreResults[i].status === 'fulfilled' ? genreResults[i].value : []
  })

  const topRated = [...popular]
    .sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0))
    .slice(0, 10)

  const classicHits = popular.filter((g) => g.year && g.year < 2010).slice(0, 10)

  const categoryGames = {
    'top-rated':     topRated,
    'new-releases':  recent,
    'action':        genreMap['Shooter'],
    'rpg':           genreMap['Role-playing (RPG)'],
    'multiplayer':   genreMap['Sport'],
    'hidden-gems':   genreMap['Indie'].slice(0, 10),
    'classic-hits':  classicHits,
    'most-reviewed': popular.slice(0, 10),
    'open-world':    genreMap['Adventure'],
    'indie':         genreMap['Indie'].slice(0, 10),
  }

  const categories = CATEGORY_META.map((meta) => {
    const games = categoryGames[meta.key] || []
    const coverGame = pickRandom(games.slice(0, 10))
    return {
      key: meta.key,
      label: meta.label,
      color: meta.color,
      pinned: !!meta.pinned,
      coverImage: coverGame?.image || null,
      games,
    }
  })

  return shuffleNonPinned(categories)
}

export async function fetchCategoryGames(categoryKey) {
  switch (categoryKey) {
    case 'top-rated': {
      const games = await getPopularGames(20)
      return games.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0)).slice(0, 10)
    }
    case 'new-releases':
      return getRecentlyReleasedGames(10)
    case 'action':
      return getGamesByGenre('Shooter', 10)
    case 'rpg':
      return getGamesByGenre('Role-playing (RPG)', 10)
    case 'multiplayer':
      return getGamesByGenre('Sport', 10)
    case 'hidden-gems':
      return (await getGamesByGenre('Indie', 20)).slice(0, 10)
    case 'classic-hits': {
      const games = await getPopularGames(30)
      return games.filter((g) => g.year && g.year < 2010).slice(0, 10)
    }
    case 'most-reviewed':
      return getPopularGames(10)
    case 'open-world':
      return getGamesByGenre('Adventure', 10)
    case 'indie':
      return getGamesByGenre('Indie', 10)
    default:
      return []
  }
}

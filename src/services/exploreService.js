// Explore Service — curated game sections with cross-section deduplication.
// All data sourced from IGDB.
import {
  getPopularGames as getIGDBPopularGames,
  getRecentlyReleasedGames as getIGDBRecentGames,
  getGamesByGenre as getIGDBGamesByGenre,
} from './igdb'

const SECTION_DEFS = [
  { id: 'popular', label: 'Popular' },
  { id: 'top-rated', label: 'Top Rated' },
  { id: 'new-noteworthy', label: 'New & Noteworthy' },
  { id: 'popular-this-year', label: 'Popular This Year' },
  { id: 'indie-gems', label: 'Indie Gems' },
]

const MIN_SECTION_SIZE = 3

// ─── Main entry: fetch all sections with cross-section dedup ────────────────

export async function fetchExploreSections(perSection = 8) {
  const overfetch = perSection * 3

  const [popular, topRated, newNoteworthy, popularThisYear, indieGems] =
    await Promise.allSettled([
      fetchPopularGames(overfetch),
      fetchTopRated(overfetch),
      fetchNewAndNoteworthy(overfetch),
      fetchPopularThisYear(overfetch),
      fetchIndieGems(overfetch),
    ])

  const rawPools = {
    'popular': unwrap(popular),
    'top-rated': unwrap(topRated),
    'new-noteworthy': unwrap(newNoteworthy),
    'popular-this-year': unwrap(popularThisYear),
    'indie-gems': unwrap(indieGems),
  }

  return buildExploreSections(rawPools, perSection)
}

// ─── Cross-section deduplication ────────────────────────────────────────────

/**
 * Walk sections in priority order. Each game can only appear once across the
 * entire Explore page. Dedup uses both ID and normalized title to catch
 * re-releases / remasters that share a name but have different API IDs.
 * Sections with fewer than MIN_SECTION_SIZE games after dedup are omitted
 * rather than shown with a sparse, unconvincing row.
 */
function buildExploreSections(rawPools, perSection) {
  const usedIds = new Set()
  const usedTitles = new Set()
  const sections = {}

  for (const { id, label } of SECTION_DEFS) {
    const pool = rawPools[id] || []
    const unique = []

    for (const game of pool) {
      const gid = stableId(game)
      const titleKey = (game.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')

      if (usedIds.has(gid)) continue
      if (titleKey && usedTitles.has(titleKey)) continue

      usedIds.add(gid)
      if (titleKey) usedTitles.add(titleKey)
      unique.push(game)
      if (unique.length >= perSection) break
    }

    if (unique.length >= MIN_SECTION_SIZE) {
      sections[id] = { label, games: unique }
    }
  }

  return sections
}

function stableId(game) {
  return game.gameId || String(game.id ?? '')
}

function unwrap(settled) {
  return settled.status === 'fulfilled' ? (settled.value || []) : []
}

// ─── Per-category fetch: kept for backward compat (Home.jsx) ────────────────

export async function fetchGamesByCategory(categoryId, limit = 50) {
  try {
    switch (categoryId) {
      case 'popular':
        return await fetchPopularGames(limit)
      case 'popular-this-year':
        return await fetchPopularThisYear(limit)
      case 'new-noteworthy':
        return await fetchNewAndNoteworthy(limit)
      case 'indie-gems':
        return await fetchIndieGems(limit)
      case 'top-rated':
        return await fetchTopRated(limit)
      case 'all':
      default:
        console.warn(`Unknown category: ${categoryId}, using popular`)
        return await fetchPopularGames(limit)
    }
  } catch (error) {
    console.error(`Error fetching games for category ${categoryId}:`, error)
    return []
  }
}

// ─── Category fetchers ──────────────────────────────────────────────────────

async function fetchPopularGames(limit) {
  try {
    return await getIGDBPopularGames(limit)
  } catch (error) {
    console.error('Failed to fetch popular games:', error)
    return []
  }
}

/**
 * "Top Rated" — high-rated games, re-sorted by rating so the row
 * surfaces critically acclaimed titles rather than just popular ones.
 */
async function fetchTopRated(limit) {
  try {
    const games = await getIGDBPopularGames(limit * 2)
    return games
      .sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0))
      .slice(0, limit)
  } catch (error) {
    console.error('Failed to fetch top rated games:', error)
    return []
  }
}

async function fetchNewAndNoteworthy(limit) {
  try {
    return await getIGDBRecentGames(limit)
  } catch (error) {
    console.error('Failed to fetch new & noteworthy games:', error)
    return []
  }
}

async function fetchPopularThisYear(limit) {
  try {
    return await getIGDBRecentGames(limit)
  } catch (error) {
    console.error('Failed to fetch popular this year games:', error)
    return []
  }
}

async function fetchIndieGems(limit) {
  try {
    return await getIGDBGamesByGenre('Indie', limit)
  } catch (error) {
    console.error('Failed to fetch indie gems:', error)
    return []
  }
}

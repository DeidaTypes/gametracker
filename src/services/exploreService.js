// Explore Service — curated game sections with quality filtering and
// cross-section deduplication. Uses RAWG as primary source with IGDB fallback.
import { rawgRequest, formatGames } from './rawg'
import {
  getPopularGames as getIGDBPopularGames,
  getRecentlyReleasedGames as getIGDBRecentGames,
  getGamesByGenre as getIGDBGamesByGenre,
} from './igdb'

// Section definitions in display/priority order.
// Earlier sections claim games first during deduplication.
const SECTION_DEFS = [
  { id: 'popular', label: 'Popular' },
  { id: 'top-rated', label: 'Top Rated' },
  { id: 'new-noteworthy', label: 'New & Noteworthy' },
  { id: 'popular-this-year', label: 'Popular This Year' },
  { id: 'indie-gems', label: 'Indie Gems' },
]

// Per-section quality thresholds applied to raw RAWG results *before*
// formatting. Games that don't clear these gates are excluded, which is
// what makes rows feel selective instead of stuffed.
const QUALITY_GATES = {
  'popular':           { minAdded: 500 },
  'top-rated':         { minMetacritic: 82, minRatingsCount: 20 },
  'new-noteworthy':    { minRating: 3.5, minRatingsCount: 5 },
  'popular-this-year': { minAdded: 200, minRating: 3.0 },
  'indie-gems':        { minRating: 4.0, minRatingsCount: 10 },
}

const MIN_SECTION_SIZE = 3

// ─── Quality filter ─────────────────────────────────────────────────────────

function passesQualityGate(rawGame, sectionId) {
  if (!rawGame.name || !rawGame.background_image) return false

  const gate = QUALITY_GATES[sectionId]
  if (!gate) return true

  const { rating = 0, added = 0, ratings_count = 0, metacritic = 0 } = rawGame

  if (gate.minRating && rating < gate.minRating) return false
  if (gate.minAdded && added < gate.minAdded) return false
  if (gate.minRatingsCount && ratings_count < gate.minRatingsCount) return false
  if (gate.minMetacritic && metacritic < gate.minMetacritic) return false

  return true
}

// ─── Order-preserving format ────────────────────────────────────────────────

/**
 * formatGames (in rawg.js) re-sorts every batch by rating. That's fine for
 * search results but destroys intentional API ordering for sections like
 * "Popular" (-added) or "Popular This Year" (-added). This wrapper runs the
 * standard formatter then restores the original API order.
 */
function formatGamesPreserveOrder(rawGames) {
  const idOrder = rawGames.map(g => String(g.id))
  const formatted = formatGames(rawGames)
  const byId = new Map(formatted.map(g => [String(g.id), g]))
  return idOrder.map(id => byId.get(id)).filter(Boolean)
}

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

// ─── RAWG/IGDB fallback wrapper ─────────────────────────────────────────────

async function withIGDBFallback(rawgFn, igdbFn, label) {
  try {
    return await rawgFn()
  } catch (rawgErr) {
    console.warn(`RAWG failed for ${label}, trying IGDB fallback...`)
    try {
      return await igdbFn()
    } catch (igdbErr) {
      console.error(`Both APIs failed for ${label}`)
      return []
    }
  }
}

// ─── Category fetchers — each uses a DISTINCT query to avoid overlap ────────

/**
 * "Popular" — sorted by player count (-added). Quality gate requires
 * meaningful traction (added >= 500) so obscure entries don't slip in.
 * Order is preserved so the row reflects actual popularity, not re-sorted
 * by rating.
 */
async function fetchPopularGames(limit) {
  return withIGDBFallback(
    async () => {
      const data = await rawgRequest('/games', {
        ordering: '-added',
        page_size: Math.min(limit, 40),
      })
      const qualified = (data.results || []).filter(g => passesQualityGate(g, 'popular'))
      return formatGamesPreserveOrder(qualified)
    },
    () => getIGDBPopularGames(limit),
    'popular',
  )
}

/**
 * "Top Rated" — critically acclaimed games ranked by Metacritic.
 * Primary query: metacritic 85–100. Falls back to 80–100 if the
 * stricter band yields fewer than MIN_SECTION_SIZE results.
 * Quality gate: ratings_count >= 20 to exclude niche titles with
 * inflated scores from a handful of reviews.
 */
async function fetchTopRated(limit) {
  return withIGDBFallback(
    async () => {
      const data = await rawgRequest('/games', {
        ordering: '-metacritic',
        metacritic: '85,100',
        page_size: Math.min(limit, 40),
      })
      const qualified = (data.results || []).filter(g => passesQualityGate(g, 'top-rated'))

      if (qualified.length >= MIN_SECTION_SIZE) {
        return formatGamesPreserveOrder(qualified)
      }

      const fallback = await rawgRequest('/games', {
        ordering: '-metacritic',
        metacritic: '80,100',
        page_size: Math.min(limit, 40),
      })
      return formatGamesPreserveOrder(
        (fallback.results || []).filter(g => passesQualityGate(g, 'top-rated')),
      )
    },
    async () => {
      const games = await getIGDBPopularGames(limit * 2)
      return games
        .sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0))
        .slice(0, limit)
    },
    'top-rated',
  )
}

/**
 * "New & Noteworthy" — released in the last 45 days, sorted by *rating*
 * (not release date) so the row surfaces quality over pure recency.
 * Tighter date window (45 days vs. the full-year window of "Popular This
 * Year") keeps the two sections visually distinct.
 * Quality gate: rating >= 3.5 and at least 5 user ratings.
 */
async function fetchNewAndNoteworthy(limit) {
  return withIGDBFallback(
    async () => {
      const windowDays = 45
      const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
      const today = new Date()

      const data = await rawgRequest('/games', {
        dates: `${fmt(cutoff)},${fmt(today)}`,
        ordering: '-rating',
        page_size: Math.min(limit, 40),
      })

      const qualified = (data.results || []).filter(g => passesQualityGate(g, 'new-noteworthy'))
      return formatGames(qualified)
    },
    () => getIGDBRecentGames(limit),
    'new-noteworthy',
  )
}

/**
 * "Popular This Year" — released this calendar year, sorted by player count.
 * Quality gate: added >= 200 and rating >= 3.0 to exclude low-signal entries.
 * Uses -added ordering (distinct from New & Noteworthy's -rating) so the
 * two rows look and feel different.
 */
async function fetchPopularThisYear(limit) {
  return withIGDBFallback(
    async () => {
      const yearStart = `${new Date().getFullYear()}-01-01`
      const today = fmt(new Date())

      const data = await rawgRequest('/games', {
        dates: `${yearStart},${today}`,
        ordering: '-added',
        page_size: Math.min(limit, 40),
      })

      const qualified = (data.results || []).filter(g => passesQualityGate(g, 'popular-this-year'))
      return formatGamesPreserveOrder(qualified)
    },
    () => getIGDBRecentGames(limit),
    'popular-this-year',
  )
}

/**
 * "Indie Gems" — indie genre, ranked by rating. Quality gate requires
 * rating >= 4.0 with at least 10 user ratings, ensuring only
 * well-regarded indie titles surface (not just anything tagged "indie").
 */
async function fetchIndieGems(limit) {
  return withIGDBFallback(
    async () => {
      const data = await rawgRequest('/games', {
        genres: 'indie',
        ordering: '-rating',
        page_size: Math.min(limit, 40),
      })

      const qualified = (data.results || []).filter(g => passesQualityGate(g, 'indie-gems'))
      return formatGames(qualified)
    },
    () => getIGDBGamesByGenre('Indie', limit),
    'indie-gems',
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(date) {
  return date.toISOString().split('T')[0]
}

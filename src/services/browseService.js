import {
  getGamesByTheme,
  getGamesByGameMode,
  fetchBrowseBuckets,
  getBrowsePage,
  BROWSE_PAGE_SIZE,
} from './igdb'
import { getSWR } from './swrCache'

// Browse listings (popular/new-releases/genre buckets) don't change
// meaningfully within a session — cache them so switching between the
// Search page and the Explore/Home browse grid, or just re-visiting
// either, doesn't re-fire the same ~13 IGDB calls every time. TTL is
// generous (10 min) since this is discovery content, not live data.
const BROWSE_CATEGORIES_TTL_MS = 10 * 60 * 1000
const BROWSE_CATEGORIES_KEY = 'search:browse-categories'

// Tile metadata for fetchBrowseCategories (the cover-tile grids). It still
// carries the all-games list keys; the genre pages themselves are defined by
// CATEGORIES and LIST_PAGES below.
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
  // Slugs used by the Search page genre cards
  { key: 'strategy',      label: 'Strategy',        color: '#0B1E3D' },
  { key: 'adventure',     label: 'Adventure',       color: '#0D2E1A' },
  { key: 'horror',        label: 'Horror',          color: '#6B0A14' },
  { key: 'sports',        label: 'Sports',          color: '#0A2860' },
  { key: 'puzzle',        label: 'Puzzle',          color: '#2A1A6B' },
  { key: 'shooter',       label: 'Shooter',         color: '#1C2A1C' },
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

/**
 * The browse categories: real genres, themes and game modes only. Each maps to
 * one IGDB filter (ids confirmed against the genres, themes and game_modes
 * endpoints). This is also what search suggests under "Genres" while typing.
 */
export const CATEGORIES = [
  { key: 'rpg',         label: 'RPG',         filter: { field: 'genres',     ids: [12] } },
  { key: 'action',      label: 'Action',      filter: { field: 'themes',     ids: [1] } },
  { key: 'shooter',     label: 'Shooter',     filter: { field: 'genres',     ids: [5] } },
  { key: 'adventure',   label: 'Adventure',   filter: { field: 'genres',     ids: [31] } },
  // Strategy, Real Time Strategy, Turn-based strategy.
  { key: 'strategy',    label: 'Strategy',    filter: { field: 'genres',     ids: [15, 11, 16] } },
  { key: 'horror',      label: 'Horror',      filter: { field: 'themes',     ids: [19] } },
  // IGDB calls genre 8 "Platform".
  { key: 'platformer',  label: 'Platformer',  filter: { field: 'genres',     ids: [8] } },
  { key: 'puzzle',      label: 'Puzzle',      filter: { field: 'genres',     ids: [9] } },
  { key: 'racing',      label: 'Racing',      filter: { field: 'genres',     ids: [10] } },
  { key: 'fighting',    label: 'Fighting',    filter: { field: 'genres',     ids: [4] } },
  { key: 'sports',      label: 'Sports',      filter: { field: 'genres',     ids: [14] } },
  { key: 'indie',       label: 'Indie',       filter: { field: 'genres',     ids: [32] } },
  { key: 'open-world',  label: 'Open world',  filter: { field: 'themes',     ids: [38] } },
  { key: 'multiplayer', label: 'Multiplayer', filter: { field: 'game_modes', ids: [2] } },
]

// Keys the cover-tile grids (fetchBrowseCategories) still link to as
// /browse/<key>. They are not genres: each opens an all-games page on the
// view that answers the same question.
const LIST_PAGES = [
  { key: 'top-rated',     label: 'Top Rated',     view: 'top' },
  { key: 'new-releases',  label: 'New Releases',  view: 'new' },
  { key: 'hidden-gems',   label: 'Hidden Gems',   view: 'gems' },
  { key: 'classic-hits',  label: 'Classic Hits',  view: 'top' },
  { key: 'most-reviewed', label: 'Most Reviewed', view: 'popular' },
]

export function getCategoryDefinitions() {
  return CATEGORIES
}

/**
 * What a /browse/:key opens. Returns null for a key nobody knows.
 *   kind 'category'  one of CATEGORIES
 *   kind 'list'      one of LIST_PAGES (all games, opening on its own view)
 *   kind 'genre'     genre-<igdbGenreId>, from a game's genre chip; the label
 *                    is left empty for the caller to fill from the chip or IGDB
 */
export function resolveBrowseTarget(key) {
  const category = CATEGORIES.find((c) => c.key === key)
  if (category) {
    return { kind: 'category', key, label: category.label, filter: category.filter, view: 'popular' }
  }
  const list = LIST_PAGES.find((c) => c.key === key)
  if (list) {
    return { kind: 'list', key, label: list.label, filter: null, view: list.view }
  }
  const match = /^genre-(\d+)$/.exec(key || '')
  if (match) {
    const genreId = Number(match[1])
    return { kind: 'genre', key, label: '', genreId, filter: { field: 'genres', ids: [genreId] }, view: 'popular' }
  }
  return null
}

/**
 * One page of one view of a browse target (see resolveBrowseTarget).
 * `page` is 0-based. Pass back `widened` from the first page of the New view so
 * later pages keep its window. `hasMore` is false once IGDB runs out.
 * A failed request throws.
 */
export async function fetchCategoryPage(key, view, page, { widened = false } = {}) {
  const target = resolveBrowseTarget(key)
  if (!target) return { games: [], hasMore: false, widened: false }
  const result = await getBrowsePage({
    filter: target.filter,
    view,
    offset: page * BROWSE_PAGE_SIZE,
    widened,
  })
  return {
    games: result.games,
    hasMore: result.rawCount >= BROWSE_PAGE_SIZE,
    widened: result.widened,
  }
}

/**
 * Fetch all browse categories with minimal IGDB round-trips.
 *
 * Strategy: fire one `getPopularGames(30)`, one `getRecentlyReleasedGames(10)`,
 * and all unique genre fetches in a single `Promise.all`. Then derive
 * sub-categories (top-rated, classic-hits, most-reviewed, hidden-gems) from the
 * popular games result — no extra requests.
 *
 * Cached (stale-while-revalidate, 10 min) via swrCache — both the Search
 * page and the Explore/Home browse grid call this, so without a shared
 * cache each mount re-fires the full ~13-call fan-out from scratch.
 */
export async function fetchBrowseCategories() {
  return getSWR(BROWSE_CATEGORIES_KEY, fetchBrowseCategoriesUncached, {
    ttlMs: BROWSE_CATEGORIES_TTL_MS,
  })
}

const BROWSE_GENRE_SPECS = [
  { name: 'Role-playing (RPG)', limit: 10 },
  { name: 'Indie', limit: 20 },
]

async function fetchBrowseCategoriesUncached() {
  // Action and Open world are IGDB themes and Multiplayer is a game mode, so
  // they cannot ride the genre buckets. Each helper resolves to [] on failure.
  const [buckets, actionGames, openWorldGames, multiplayerGames] = await Promise.all([
    fetchBrowseBuckets(BROWSE_GENRE_SPECS),
    getGamesByTheme('Action', 10),
    getGamesByTheme('Open world', 10),
    getGamesByGameMode('Multiplayer', 10),
  ])
  const popular = buckets.popular || []
  const recent = buckets.recent || []
  const genre = (name) => buckets.byGenre?.[name] || []

  const topRated = [...popular]
    .sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0))
    .slice(0, 10)

  const classicHits = popular.filter((g) => g.year && g.year < 2010).slice(0, 10)

  const categoryGames = {
    'top-rated':     topRated,
    'new-releases':  recent,
    'action':        actionGames,
    'rpg':           genre('Role-playing (RPG)'),
    'multiplayer':   multiplayerGames,
    'hidden-gems':   genre('Indie').slice(0, 10),
    'classic-hits':  classicHits,
    'most-reviewed': popular.slice(0, 10),
    'open-world':    openWorldGames,
    'indie':         genre('Indie').slice(0, 10),
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

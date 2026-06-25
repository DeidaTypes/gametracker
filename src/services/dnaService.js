/**
 * dnaService — Taste portrait derived purely from the user's real data.
 *
 * Sources (all client-side, no fabricated values):
 *   genres   → game.genres[] | game.genre (comma string) on every library entry
 *   themes   → game.themes[] on library entries (populated by IGDB detail fetches)
 *   hours    → gameProgress[id].hoursPlayed (localStorage)
 *   era      → game.year on played/currently-playing entries
 *   ratings  → reviewService cache via getAllReviews()
 *
 * Degrades gracefully: every field is null / [] when data is absent.
 * NEVER invents values.
 */

import { getLibrary, initializeLibrary, getGamesFromList } from './libraryService'
import { getAllReviews } from './reviewService'

// ── Vibe map — top-genre → descriptor ────────────────────────────────────────
const GENRE_TO_VIBE = {
  'Role-Playing': 'Narrative Explorer',
  'RPG': 'Narrative Explorer',
  'Adventure': 'World Wanderer',
  'Action': 'Reflex Hunter',
  'Action-Adventure': 'Action Adventurer',
  'Shooter': 'Combat Tactician',
  'Strategy': 'Grand Strategist',
  'Puzzle': 'Logic Architect',
  'Sports': 'Competitive Spirit',
  'Simulation': 'Digital Builder',
  'Platform': 'Precision Jumper',
  'Platformer': 'Precision Jumper',
  'Fighting': 'Combo Master',
  'Horror': 'Tension Seeker',
  'Indie': 'Hidden Gem Collector',
  'Racing': 'Speed Chaser',
  'Music': 'Rhythm Maestro',
  'Visual Novel': 'Story Seeker',
  'Hack and slash/Beat \'em up': 'Chaos Brawler',
  'Real Time Strategy (RTS)': 'Tactical Commander',
  'Turn-based strategy (TBS)': 'Patient Strategist',
  'Point-and-click': 'Mystery Unraveller',
  'Card & Board Game': 'Card Shark',
  'Arcade': 'Score Chaser',
  'MOBA': 'Team Player',
}

// ── Era label map ─────────────────────────────────────────────────────────────
const ERA_LABELS = {
  1970: '70s',
  1980: '80s',
  1990: '90s',
  2000: 'Early 00s',
  2010: '2010s',
  2020: '2020s',
}

function getDecade(year) {
  if (!year) return null
  const y = parseInt(year, 10)
  if (isNaN(y)) return null
  return Math.floor(y / 10) * 10
}

function getAllTrackedGames() {
  const library = getLibrary() || initializeLibrary()
  const seen = new Set()
  const games = []
  const addList = (list) => {
    if (!list?.games) return
    for (const g of list.games) {
      if (!g) continue
      const key = String(g.id)
      if (!seen.has(key)) { seen.add(key); games.push(g) }
    }
  }
  Object.values(library.lists || {}).forEach(addList)
  Object.values(library.customLists || {}).forEach(addList)
  return games
}

function getAllProgress() {
  try {
    const raw = localStorage.getItem('gameProgress')
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute a taste portrait from the user's own library + review data.
 *
 * @returns {{
 *   topGenres:   Array<{ name: string, count: number, pct: number }>,  // ≤5
 *   topThemes:   Array<{ name: string, count: number }>,               // ≤3
 *   vibe:        string | null,
 *   era:         { decade: number, label: string } | null,
 *   totalGames:  number,
 *   totalHours:  number,
 *   reviewCount: number,
 *   avgRating:   number | null,    // null when < 1 review
 *   topPlatform: string | null,
 * }}
 */
export function computeDNAPortrait() {
  const allGames = getAllTrackedGames()
  const allProgress = getAllProgress()
  const allReviews = getAllReviews()

  // ── Hours ────────────────────────────────────────────────────────────────
  let totalHours = 0
  for (const entry of Object.values(allProgress)) {
    totalHours += parseFloat(entry.hoursPlayed) || 0
  }
  // Also pull hours from reviews table (hours_played col), de-dupe by gameId
  const hoursByGame = {}
  for (const rev of allReviews) {
    const h = parseFloat(rev.hoursPlayed || rev.hours_played) || 0
    const key = String(rev.gameId || rev.igdb_game_id || '')
    if (key && h > 0) {
      hoursByGame[key] = Math.max(hoursByGame[key] || 0, h)
    }
  }
  // Add review hours that weren't already in gameProgress
  for (const [gameId, h] of Object.entries(hoursByGame)) {
    const prog = allProgress[gameId] || {}
    if (!prog.hoursPlayed) totalHours += h
  }

  // ── Genres ───────────────────────────────────────────────────────────────
  const genreCounts = {}
  for (const game of allGames) {
    const genres =
      Array.isArray(game.genres) && game.genres.length > 0
        ? game.genres
        : typeof game.genre === 'string' && game.genre
        ? game.genre.split(',').map((g) => g.trim()).filter(Boolean)
        : []
    for (const g of genres) {
      if (g && g !== 'Unknown') genreCounts[g] = (genreCounts[g] || 0) + 1
    }
  }
  const genreTotal = Object.values(genreCounts).reduce((s, c) => s + c, 0) || 1
  const topGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({
      name,
      count,
      pct: Math.round((count / genreTotal) * 100),
    }))

  // ── Themes ───────────────────────────────────────────────────────────────
  const themeCounts = {}
  for (const game of allGames) {
    const themes = Array.isArray(game.themes) ? game.themes : []
    for (const t of themes) {
      if (t && t !== 'Unknown') themeCounts[t] = (themeCounts[t] || 0) + 1
    }
  }
  const topThemes = Object.entries(themeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => ({ name, count }))

  // ── Vibe ─────────────────────────────────────────────────────────────────
  let vibe = null
  for (const { name } of topGenres) {
    const match = GENRE_TO_VIBE[name]
    if (match) { vibe = match; break }
  }

  // ── Era — from played + currently-playing games ───────────────────────────
  const playedGames = [
    ...getGamesFromList('played'),
    ...getGamesFromList('currently-playing'),
  ]
  const decadeCounts = {}
  for (const game of playedGames) {
    const d = getDecade(game.year)
    if (d !== null) decadeCounts[d] = (decadeCounts[d] || 0) + 1
  }
  let era = null
  if (Object.keys(decadeCounts).length > 0) {
    const topDecade = parseInt(
      Object.entries(decadeCounts).sort((a, b) => b[1] - a[1])[0][0],
      10
    )
    era = { decade: topDecade, label: ERA_LABELS[topDecade] || `${topDecade}s` }
  }

  // ── Platforms ────────────────────────────────────────────────────────────
  const platformCounts = {}
  for (const game of allGames) {
    for (const p of game.platforms || []) {
      if (p) platformCounts[p] = (platformCounts[p] || 0) + 1
    }
  }
  const topPlatform =
    Object.entries(platformCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null

  // ── Rating avg ────────────────────────────────────────────────────────────
  let avgRating = null
  if (allReviews.length > 0) {
    const sum = allReviews.reduce((s, r) => s + (parseFloat(r.rating) || 0), 0)
    avgRating = Math.round((sum / allReviews.length) * 10) / 10
  }

  return {
    topGenres,
    topThemes,
    vibe,
    era,
    totalGames: allGames.length,
    totalHours: Math.round(totalHours),
    reviewCount: allReviews.length,
    avgRating,
    topPlatform,
  }
}

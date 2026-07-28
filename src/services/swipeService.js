// Swipe Service — persistent swipe history + taste signal for the Discover deck.
//
// Sprint 7A: "swipe that learns". Every swipe (skip / backlog / not-interested)
// is written to localStorage so the deck can bias subsequent batches and so the
// end-of-session "Tonight's match" pick has real data to score against.
//
// Storage shape (key: gt:swipes:v1)
//   {
//     version: 1,
//     swipes: {
//       [igdbId: string]: {
//         action: 'backlog' | 'skip' | 'not_interested',
//         ts:    ISO string,
//         title: string,
//         genres:   string[],         // genre names from card
//         themeIds: number[],         // IGDB theme IDs
//         themeNames: string[],       // mirrored for label lookup
//         year:  number | null,
//         rating: number | null,
//       }
//     }
//   }
//
// localStorage stays the SOURCE OF TRUTH for deck behavior: exclusion, TTLs and
// the local taste signal all read from it, so the deck keeps working offline and
// while signed out exactly as before.
//
// It is additionally MIRRORED to `user_swipe_signals` for signed-in users, because
// the taste engine runs as a scheduled server-side job with no browser. Without
// that mirror, left-swipes are structurally invisible to the taste vector and
// right-swipes only show up indirectly as a `want` tracker row, which the engine
// can't distinguish from a manual backlog add. The mirror is best-effort and
// fire-and-forget: a failed write costs a little taste signal, never a swipe.
//
// Used by:
//   - src/components/explore/SwipeDeck.jsx — recordSwipe + getTasteSignal
//   - src/components/explore/SessionEndPick.jsx — pickTonightsMatch
//   - src/services/igdb.js getDiscoveryDeck — biases the next batch
//   - supabase/functions/taste-engine — reads the mirrored table daily

import { getGamesFromList } from './libraryService'
import { supabase } from './supabase'

const STORAGE_KEY = 'gt:swipes:v1'

export const SWIPE_ACTIONS = Object.freeze({
  BACKLOG: 'backlog',
  SKIP: 'skip',
  NOT_INTERESTED: 'not_interested',
})

// How recently a "skip" must have happened to keep the card out of rotation.
// Older skips age out so the user isn't punished forever for a single bad mood.
const SKIP_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
// "Not interested" is a stronger downvote — keep it out for a year.
const NOT_INTERESTED_TTL_MS = 365 * 24 * 60 * 60 * 1000

// ────────────────────────────────────────────────────────────────────────────
// Storage helpers
// ────────────────────────────────────────────────────────────────────────────

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { version: 1, swipes: {} }
    const parsed = JSON.parse(raw)
    if (parsed && parsed.swipes && typeof parsed.swipes === 'object') {
      return parsed
    }
    return { version: 1, swipes: {} }
  } catch {
    return { version: 1, swipes: {} }
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch { /* storage full — non-fatal, swipes just won't persist */ }
}

// ────────────────────────────────────────────────────────────────────────────
// Server mirror — taste signal only (see header)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mirror one swipe into `user_swipe_signals` so the daily taste engine can see
 * it. Best-effort by design: signed-out users are skipped, and every failure is
 * swallowed. The genre/theme names ride along so the engine can bucket the
 * signal even before IGDB tag resolution has cached that game.
 */
async function mirrorSwipe(igdbGameId, action, genres, themeNames) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return

    await supabase.from('user_swipe_signals').upsert(
      {
        user_id: user.id,
        igdb_game_id: Number(igdbGameId),
        action,
        genre_names: genres,
        theme_names: themeNames,
        swiped_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,igdb_game_id' },
    )
  } catch {
    // Non-fatal: localStorage already holds the authoritative swipe.
  }
}

/**
 * Push any local swipes the server hasn't seen yet — covers swipes made while
 * signed out, on another device, or before this mirror existed.
 *
 * Only inserts what's missing; it never overwrites a server row, so a newer
 * swipe recorded elsewhere wins. Safe to call on every app start.
 */
export async function syncSwipesToServer() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.id) return 0

    const local = readStore().swipes
    const localIds = Object.keys(local)
    if (localIds.length === 0) return 0

    const { data: existing, error } = await supabase
      .from('user_swipe_signals')
      .select('igdb_game_id')
      .eq('user_id', user.id)
    if (error) return 0

    const known = new Set((existing || []).map((r) => String(r.igdb_game_id)))
    const rows = localIds
      .filter((id) => !known.has(String(id)) && /^\d+$/.test(id))
      .map((id) => {
        const row = local[id]
        return {
          user_id: user.id,
          igdb_game_id: Number(id),
          action: row.action,
          genre_names: Array.isArray(row.genres) ? row.genres : [],
          theme_names: Array.isArray(row.themeNames) ? row.themeNames : [],
          swiped_at: row.ts || new Date().toISOString(),
        }
      })
      .filter((r) => Object.values(SWIPE_ACTIONS).includes(r.action))

    if (rows.length === 0) return 0
    const { error: insErr } = await supabase.from('user_swipe_signals').insert(rows)
    return insErr ? 0 : rows.length
  } catch {
    return 0
  }
}

// Genres on a card come over as comma-joined "RPG, Adventure". Normalise once.
function splitGenreString(g) {
  if (Array.isArray(g)) return g.filter(Boolean)
  if (typeof g === 'string') {
    return g.split(',').map((s) => s.trim()).filter(Boolean)
  }
  return []
}

// Themes can arrive as either `themes` array (newer queries) or absent. Cards
// always carry .id at minimum — name is best-effort.
function extractThemes(game) {
  const raw = game.themes || game.themeIds || []
  if (!Array.isArray(raw)) return { ids: [], names: [] }
  const ids = []
  const names = []
  for (const t of raw) {
    if (t == null) continue
    if (typeof t === 'object') {
      if (t.id != null) ids.push(Number(t.id))
      if (t.name) names.push(String(t.name))
    } else if (typeof t === 'number') {
      ids.push(t)
    }
  }
  return { ids, names }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — record + read
// ────────────────────────────────────────────────────────────────────────────

/**
 * Persist one swipe decision. Idempotent: a later swipe overwrites the
 * earlier one (e.g. "skip" can be upgraded to "not_interested" or
 * "backlog" if the user changes their mind).
 *
 * Fire-and-forget — the caller never awaits this.
 */
export function recordSwipe(game, action) {
  if (!game?.id) return
  if (!Object.values(SWIPE_ACTIONS).includes(action)) return

  const store = readStore()
  const id = String(game.id)
  const { ids: themeIds, names: themeNames } = extractThemes(game)

  const genres = splitGenreString(game.genre)

  store.swipes[id] = {
    action,
    ts: new Date().toISOString(),
    title: game.title || '',
    genres,
    themeIds,
    themeNames,
    year: game.year ?? null,
    rating: game.rating != null ? parseFloat(game.rating) : null,
  }
  writeStore(store)
  // Mirror to the server for the taste engine — deliberately not awaited so the
  // deck animation never waits on a network round trip.
  void mirrorSwipe(game.id, action, genres, themeNames)
  window.dispatchEvent(new CustomEvent('gt:swipe-recorded', { detail: { id, action } }))
}

/** Return the full swipe map. */
export function getSwipes() {
  return readStore().swipes
}

/** Clear all swipes — Settings "reset discovery" affordance. Also clears the
 * server mirror, so "reset discovery" genuinely resets the taste signal instead
 * of leaving the engine reading swipes the user thinks they deleted. */
export function clearSwipes() {
  writeStore({ version: 1, swipes: {} })
  void (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.id) await supabase.from('user_swipe_signals').delete().eq('user_id', user.id)
    } catch { /* non-fatal */ }
  })()
  window.dispatchEvent(new CustomEvent('gt:swipe-cleared'))
}

/**
 * IDs that should be excluded from the next deck batch.
 *   - Every 'not_interested' (TTL = 1 year)
 *   - Recent 'skip' (TTL = 30 days)
 *   - 'backlog' is also excluded so we don't show the same game twice,
 *     but the canonical exclusion for backlog comes from the library
 *     list itself — including here is a belt-and-suspenders fallback.
 */
export function getSwipeExcludeIds() {
  const store = readStore()
  const out = new Set()
  const now = Date.now()
  for (const [id, row] of Object.entries(store.swipes)) {
    if (!row || !row.action) continue
    const ts = Date.parse(row.ts || '')
    const age = Number.isFinite(ts) ? now - ts : 0
    if (row.action === SWIPE_ACTIONS.NOT_INTERESTED && age < NOT_INTERESTED_TTL_MS) {
      out.add(id)
    } else if (row.action === SWIPE_ACTIONS.SKIP && age < SKIP_TTL_MS) {
      out.add(id)
    } else if (row.action === SWIPE_ACTIONS.BACKLOG) {
      out.add(id)
    }
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// Taste signal — distilled "what does this user love and hate?"
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a taste signal from the union of:
 *   - High-rated "played" library titles (positive, strongly weighted)
 *   - Backlogged swipes (positive, medium)
 *   - Skipped swipes (negative, light)
 *   - "Not interested" swipes (negative, heavy)
 *
 * Output shape consumed by:
 *   - getDiscoveryDeck() — to bias axis selection + annotate whyLine
 *   - pickTonightsMatch() — to score session candidates
 *
 * @returns {{
 *   seedTitles:    Array<{ id:number, title:string, rating:number|null, genres:string[] }>,
 *   likedGenres:   Record<string, number>,
 *   dislikedGenres:Record<string, number>,
 *   likedThemeIds: Record<number, number>,
 *   likedThemeNames:Record<number, string>,
 *   topGenres:     string[],
 *   topThemeIds:   number[],
 *   totalSignals:  number
 * }}
 */
export function getTasteSignal() {
  const likedGenres = Object.create(null)
  const dislikedGenres = Object.create(null)
  const likedThemeIds = Object.create(null)
  const likedThemeNames = Object.create(null)

  const bumpGenre = (map, name, weight) => {
    if (!name) return
    map[name] = (map[name] || 0) + weight
  }
  const bumpTheme = (id, name, weight) => {
    if (id == null) return
    likedThemeIds[id] = (likedThemeIds[id] || 0) + weight
    if (name) likedThemeNames[id] = name
  }

  // 1) High-rated "played" → strongest positive signal.
  let seedTitles = []
  try {
    const played = getGamesFromList('played') || []
    seedTitles = played
      .filter((g) => g.id && g.rating != null)
      .sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating))
      .slice(0, 6)
      .map((g) => ({
        id: Number(g.id),
        title: g.title || '',
        rating: parseFloat(g.rating),
        genres: splitGenreString(g.genre),
      }))
    for (const seed of seedTitles) {
      // Top-2 seeds get extra weight — these define the user.
      const weight = seed.rating >= 4.5 ? 4 : 2
      for (const gname of seed.genres) bumpGenre(likedGenres, gname, weight)
    }
  } catch { /* non-fatal */ }

  // 2) Swipe history.
  const store = readStore()
  for (const row of Object.values(store.swipes)) {
    if (!row || !row.action) continue
    const genres = Array.isArray(row.genres) ? row.genres : []
    const themeIds = Array.isArray(row.themeIds) ? row.themeIds : []
    const themeNames = Array.isArray(row.themeNames) ? row.themeNames : []

    if (row.action === SWIPE_ACTIONS.BACKLOG) {
      for (const g of genres) bumpGenre(likedGenres, g, 3)
      themeIds.forEach((id, i) => bumpTheme(id, themeNames[i] || null, 3))
    } else if (row.action === SWIPE_ACTIONS.NOT_INTERESTED) {
      for (const g of genres) bumpGenre(dislikedGenres, g, 4)
    } else if (row.action === SWIPE_ACTIONS.SKIP) {
      for (const g of genres) bumpGenre(dislikedGenres, g, 1)
    }
  }

  const topGenres = Object.entries(likedGenres)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 4)

  const topThemeIds = Object.entries(likedThemeIds)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => Number(id))
    .slice(0, 4)

  const totalSignals =
    seedTitles.length +
    Object.values(store.swipes).filter((r) => r && r.action).length

  return {
    seedTitles,
    likedGenres,
    dislikedGenres,
    likedThemeIds,
    likedThemeNames,
    topGenres,
    topThemeIds,
    totalSignals,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// "Why" line — one-line reason a card surfaced
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a one-line "why this card" reason given a candidate and the taste
 * signal. Returns null when there's no real reason — we never fake one.
 *
 * Picks the strongest template available:
 *   1) "because ${SeedTitle} wrecked you"
 *      — when the candidate shares a genre with a seed game rated ≥ 4.5
 *   2) "more ${genre} like ${SeedTitle}"
 *      — when shares a genre with any top-rated seed
 *   3) "your ${themeName} streak continues"
 *      — when shares a theme id with the taste signal
 *   4) "fits your ${genre} streak"
 *      — when shares a top liked genre but no seed game in it
 *   5) null  — let the caller fall back to nothing
 */
export function buildWhyLine(candidate, taste) {
  if (!candidate || !taste) return null
  const cardGenres = splitGenreString(candidate.genre)
  const cardThemeIds = Array.isArray(candidate.themeIds)
    ? candidate.themeIds
    : (candidate.themes || [])
        .map((t) => (typeof t === 'object' ? t.id : t))
        .filter((x) => x != null)
        .map(Number)

  // Template 1 / 2 — seed match.
  for (const seed of taste.seedTitles) {
    const sharedGenre = seed.genres.find((g) => cardGenres.includes(g))
    if (!sharedGenre) continue
    if (seed.rating >= 4.5) {
      return `because ${seed.title} wrecked you`
    }
    return `more ${sharedGenre} like ${seed.title}`
  }

  // Template 3 — theme streak.
  for (const themeId of taste.topThemeIds) {
    if (cardThemeIds.includes(themeId)) {
      const name = taste.likedThemeNames[themeId]
      if (name) return `your ${name.toLowerCase()} streak continues`
    }
  }

  // Template 4 — genre streak.
  for (const liked of taste.topGenres) {
    if (cardGenres.includes(liked)) {
      return `fits your ${liked.toLowerCase()} streak`
    }
  }

  return null
}

// ────────────────────────────────────────────────────────────────────────────
// Tonight's match — concrete end-of-session pick
// ────────────────────────────────────────────────────────────────────────────

/**
 * Pick the single best game for "Tonight's match" out of the cards the user
 * encountered in this session. Strong preference for backlogged cards
 * (they actively said yes); falls back to skipped-but-high-affinity cards
 * when the user backlogged nothing.
 *
 * Returns null if there isn't enough signal to make a meaningful pick.
 *
 * @param {Array<object>} seenPool — every card that was visible this session
 * @param {Set<string>}  sessionBacklog — ids backlogged this session
 * @param {object}       taste — output of getTasteSignal
 */
export function pickTonightsMatch(seenPool, sessionBacklog, taste) {
  if (!Array.isArray(seenPool) || seenPool.length === 0) return null

  // Score every candidate.
  const scored = seenPool
    .filter((g) => g && g.id != null)
    .map((g) => ({ game: g, score: scoreCandidate(g, sessionBacklog, taste) }))
    .sort((a, b) => b.score - a.score)

  if (!scored.length) return null
  if (scored[0].score < 1) return null
  return scored[0].game
}

function scoreCandidate(game, sessionBacklog, taste) {
  let s = 0
  const id = String(game.id)

  if (sessionBacklog && sessionBacklog.has(id)) s += 10

  const genres = splitGenreString(game.genre)
  for (const g of genres) {
    if (taste.likedGenres[g]) s += Math.min(3, taste.likedGenres[g] * 0.5)
    if (taste.dislikedGenres[g]) s -= Math.min(2, taste.dislikedGenres[g] * 0.5)
  }

  const cardThemeIds = Array.isArray(game.themeIds)
    ? game.themeIds
    : (game.themes || [])
        .map((t) => (typeof t === 'object' ? t.id : t))
        .filter((x) => x != null)
        .map(Number)
  for (const tid of cardThemeIds) {
    if (taste.likedThemeIds[tid]) s += Math.min(2, taste.likedThemeIds[tid] * 0.4)
  }

  const r = parseFloat(game.rating)
  if (Number.isFinite(r)) s += r * 0.4

  return s
}

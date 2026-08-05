// Search Service — uses IGDB for all search requests, then applies a
// deterministic client-side ranking pass so canonical titles surface first.
//
// ── Caching ──────────────────────────────────────────────────────────────────
// All caching for search results lives here and nowhere else.
// Cache is backed by localStorage (with a silent in-memory fallback when
// localStorage is unavailable). Entries are keyed by a normalised query string,
// have a 24-hour TTL, and the store is capped at 50 entries (oldest evicted).

import { searchGames as igdbSearchGames } from './igdb'

// ─── Cache configuration ──────────────────────────────────────────────────────

// v2: the v1 store is abandoned rather than reused. It was filled by the old
// `search "…"` query, which returned nothing for most partial terms — and an
// empty result set was cached like any other, so every user who typed "cyber"
// before this fix would keep getting nothing from cache for 24 hours after it.
const CACHE_KEY     = 'search_cache_v2'
const CACHE_TTL_MS  = 24 * 60 * 60 * 1000 // 24 hours — adjust here to change TTL
const CACHE_MAX     = 50                    // max entries before oldest is evicted

// In-memory fallback used when localStorage is unavailable (private browsing, etc.)
let _memoryCache = null

/** Normalise a query to a stable cache key: trim → lowercase → collapse spaces. */
function normaliseCacheKey(query) {
  return query.trim().toLowerCase().replace(/\s+/g, ' ')
}

function _loadEntries() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // localStorage unavailable → fall back to the in-memory store
    return _memoryCache ? [..._memoryCache] : []
  }
}

function _saveEntries(entries) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries))
    _memoryCache = null // localStorage is available; memory fallback not needed
  } catch {
    _memoryCache = entries // quota exceeded or unavailable → keep in memory
  }
}

/** Return cached games for key, or null if missing / expired. */
function cacheGet(key) {
  const entries = _loadEntries()
  const entry = entries.find(e => e.query === key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null
  return entry.games
}

/** Write results to the cache, evicting the oldest entry if over the limit. */
function cacheSet(key, games) {
  // Reload so concurrent tabs stay consistent
  let entries = _loadEntries()
  // Remove any stale entry for the same query
  entries = entries.filter(e => e.query !== key)
  // Prepend newest entry
  entries.unshift({ query: key, timestamp: Date.now(), games })
  // Enforce max size (oldest entries are at the end after prepend)
  if (entries.length > CACHE_MAX) {
    entries = entries.slice(0, CACHE_MAX)
  }
  _saveEntries(entries)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalize(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ') // collapse punctuation to space
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Terms that — when present as a standalone word — suggest a non-canonical entry.
// Tested as whole-word matches so e.g. "packrat" or "modular" are not penalised.
const NON_CANONICAL_TERMS = [
  'mod', 'randomizer', 'multiplayer', 'romhack', 'pack', 'dlc',
  'beta', 'demo', 'trainer', 'cheat',
]

// ─── rankGames ───────────────────────────────────────────────────────────────

/**
 * Deterministic client-side re-ranking of a Game[].
 * Apply after deduplication, before rendering.
 *
 * Match quality (best single band applies)
 * ────────────────────────────────────────
 *  +700   exact title match             (case-insensitive, normalised)
 *  +500   title startsWith query
 *  +450   query starts a word in title  ("zeld" → "The Legend of Zelda: …")
 *  +350   every query token starts a word in the title  ("zelda wild" → BOTW)
 *  +350   an alternative name contains the query        ("ff7", "botw", "gta")
 *  +250   query appears anywhere in the title as a substring
 *  +100   matched on something IGDB saw but we can't attribute
 *
 * Popularity
 * ──────────
 *  0–550  log10(1 + total_rating_count) × 150
 *  0–40   rating on the 0–5 scale × 8
 *
 * The popularity term is deliberately large enough to outweigh one match
 * band. That is the whole point of it: "hollow" should return Hollow Knight
 * (word match, 2.2k ratings) above the obscure indie literally called
 * "Hollow" (exact match, no ratings). It is log-scaled so the difference
 * between 2k and 5k ratings stays small while the difference between 0 and
 * 200 stays decisive.
 *
 * Penalties
 * ─────────
 *  −300   non-canonical term found as a whole word in title
 *         (mod / randomizer / multiplayer / romhack / pack / dlc /
 *          beta / demo / trainer / cheat)
 *
 * There is deliberately no "long title" penalty. A −100 for titles more than
 * five words longer than the query used to stand in for "this is noise", and
 * it is exactly wrong for franchises: it pushed "The Legend of Zelda: Breath
 * of the Wild" (8 words, 2,958 ratings) below "The Legend of Zelda" (4 words,
 * 730 ratings) on the query "zeld". Popularity is the honest version of that
 * signal, and it is already in the score.
 *
 * Tie-breakers (applied when scores are equal)
 * ────────────────────────────────────────────
 *  1. Earlier release year wins  — originals precede remasters / sequels
 *  2. Shorter title wins         — less noise in the title string
 *
 * @param {string}  query  Raw search term entered by the user.
 * @param {Game[]}  games  Formatted game objects; must have at least `title`.
 * @returns {Game[]}       Same games, reordered; input array is not mutated.
 */
export function rankGames(query, games) {
  if (!query || !Array.isArray(games) || games.length === 0) return games

  const q = normalize(query)
  const qWords = q.split(/\s+/).filter(w => w.length > 0)
  const startsWord = (haystack, word) =>
    new RegExp(`\\b${escapeRegex(word)}`).test(haystack)

  const scored = games.map(game => {
    const title = game.title ?? ''
    const titleNorm = normalize(title)

    let score = 0

    if (titleNorm === q) {
      score += 700
    } else if (titleNorm.startsWith(q)) {
      score += 500
    } else if (startsWord(titleNorm, q)) {
      score += 450
    } else if (qWords.length > 1 && qWords.every(w => startsWord(titleNorm, w))) {
      score += 350
    } else if (
      // Word-start, not substring: an abbreviation begins a word ("ff7" in
      // "FFVII"). A plain includes() also matches "ff" inside "Mass Effect 1",
      // which handed Mass Effect the abbreviation bonus on the query "ff" and
      // pushed Final Fantasy VII off the top.
      (game.altNames ?? []).some(name => startsWord(normalize(name), q))
    ) {
      score += 350
    } else if (titleNorm.includes(q)) {
      score += 250
    } else {
      score += 100
    }

    // Popularity — IGDB's total_rating_count, log-scaled.
    const popularity = Number(game.popularity)
    if (Number.isFinite(popularity) && popularity > 0) {
      score += Math.log10(1 + popularity) * 150
    }

    // Quality nudge: rating stored as "4.2" on a 0–5 scale → max +40
    const rating = parseFloat(game.rating)
    if (!isNaN(rating)) score += rating * 8

    // −300 — non-canonical term present as a whole word
    const hasNonCanonical = NON_CANONICAL_TERMS.some(term =>
      new RegExp(`\\b${escapeRegex(term)}\\b`, 'i').test(title)
    )
    if (hasNonCanonical) score -= 300

    return { score, game }
  })

  // Stable descending sort — JS Array.sort is stable (ES2019+)
  scored.sort((a, b) => {
    const diff = b.score - a.score
    if (diff !== 0) return diff

    // Tie-breaker 1: earlier release year wins
    const yearA = a.game.year ?? Infinity
    const yearB = b.game.year ?? Infinity
    if (yearA !== yearB) return yearA - yearB

    // Tie-breaker 2: shorter title wins
    return (a.game.title ?? '').length - (b.game.title ?? '').length
  })

  return scored.map(s => s.game)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search games using IGDB, then apply client-side rankGames() for canonical ordering.
 *
 * Caching contract (single caching point — do not cache elsewhere):
 *   - Only full searches (limit >= 20) are written to the cache so that small
 *     autocomplete calls (limit = 6) never pollute the cache with partial results.
 *   - Both full and autocomplete calls read from the cache, so once a full search
 *     has been cached the autocomplete for the same query is also served instantly.
 *   - Results are served from cache without any further ranking, preserving the
 *     deterministic ordering established on the first fetch.
 */
export async function searchGames(searchTerm, limit = 30) {
  if (!searchTerm || !searchTerm.trim()) return []

  const cacheKey = normaliseCacheKey(searchTerm)

  const cached = cacheGet(cacheKey)
  if (cached) {
    console.log('⚡ Cache hit for:', cacheKey)
    return cached.slice(0, limit)
  }

  try {
    console.log('🔍 Searching IGDB for:', searchTerm)
    // igdbSearchGames returns up to limit*2 results in IGDB's natural relevance order
    const raw = await igdbSearchGames(searchTerm.trim(), limit)
    console.log(`✅ Found ${raw.length} games — applying rankGames()`)
    const ranked = rankGames(searchTerm.trim(), raw)
    console.log('🏆 Top 5 after ranking:', ranked.slice(0, 5).map(g => `${g.title} (${g.year ?? '?'})`))
    const result = ranked.slice(0, limit)

    // Only cache full searches so that autocomplete results (limit <= 6) don't
    // silently fill the cache with truncated lists before a full search runs.
    // Empty results are never cached — "no match" is far more likely to be a
    // transient API problem than a fact worth remembering for a day.
    if (limit >= 20 && result.length > 0) {
      cacheSet(cacheKey, result)
    }

    return result
  } catch (error) {
    console.error('❌ Error in searchGames:', error)
    throw error
  }
}

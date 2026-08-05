/**
 * @fileoverview Normalization layer — converts pre-formatted game objects from
 * any API service into the canonical Game model defined in types/models.js.
 *
 * Applied at the service boundary (inside igdb.js formatGames /
 * formatGameDetails) so UI components never consume raw API shapes directly.
 *
 * Entry points:
 *   normalizeGame(raw, source)   → Game
 *   normalizeGames(raws, source) → Game[]
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Collapse internal whitespace and strip leading/trailing whitespace.
 * Does NOT alter capitalisation — game titles use intentional casing.
 *
 * @param {*} str
 * @returns {string}
 */
function normalizeTitle(str) {
  if (!str || typeof str !== 'string') return ''
  return str.trim().replace(/\s+/g, ' ')
}

/**
 * Produce a stable, URL-safe slug from a title + optional year.
 * Used as the app-level `gameId` for deduplication / future deep-linking.
 *
 * Examples:
 *   makeGameId("Elden Ring", 2022)          → "elden-ring-2022"
 *   makeGameId("The Legend of Zelda", null) → "the-legend-of-zelda"
 *
 * @param {string}      title
 * @param {number|null} year
 * @returns {string}
 */
function makeGameId(title, year) {
  const slug = normalizeTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')   // strip special chars
    .replace(/\s+/g, '-')            // spaces → hyphens
    .replace(/-{2,}/g, '-')          // collapse consecutive hyphens
    .replace(/^-|-$/g, '')           // trim leading/trailing hyphens

  return year ? `${slug}-${year}` : slug || 'unknown-game'
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalize a pre-formatted game object into a canonical Game.
 *
 * Accepts the output shape of:
 *   • igdb.js  formatGames()       (list shape)
 *   • igdb.js  formatGameDetails() (detail shape)
 *
 * Guarantees:
 *   – No undefined field access crashes (arrays default to [], strings to null)
 *   – Title whitespace is collapsed
 *   – `gameId` is stable and slug-based
 *   – `rawIds` captures the original API identifier
 *   – `source` marks which API the data came from
 *   – `releaseDate` stays a Date object so downstream sort logic still works
 *
 * @param {Object}     raw    - Pre-formatted game object from a service helper
 * @param {'igdb'|'unknown'} [source='unknown']
 * @returns {import('../types/models').Game}
 */
export function normalizeGame(raw, source = 'unknown') {
  // Guard: return a safe empty-ish object if raw is unusable
  if (!raw || typeof raw !== 'object') {
    return {
      id: '',
      gameId: 'unknown-game',
      slug: undefined,
      title: '',
      year: null,
      releaseDate: null,
      image: null,
      imageHD: null,
      coverUrl: null,
      rating: null,
      genre: '',
      genres: [],
      developer: 'Unknown',
      developers: [],
      publisher: 'Unknown',
      publishers: [],
      platforms: [],
      description: null,
      screenshots: [],
      websites: [],
      themes: [],
      playerPerspectives: [],
      gameModes: [],
      keywords: [],
      tags: [],
      tagIds: [],
      popularity: null,
      altNames: [],
      source: 'unknown',
      rawIds: {},
    }
  }

  // ── Title ──────────────────────────────────────────────────────────────────
  const title = normalizeTitle(raw.title ?? raw.name ?? '')
  const year = raw.year ?? null

  // ── Genres ────────────────────────────────────────────────────────────────
  // Detail shape provides `genres` array; list shape provides only `genre` string.
  let genres = []
  if (Array.isArray(raw.genres) && raw.genres.length > 0) {
    genres = raw.genres.filter(Boolean)
  } else if (typeof raw.genre === 'string' && raw.genre && raw.genre !== 'Unknown') {
    genres = raw.genre.split(',').map(s => s.trim()).filter(Boolean)
  }

  // ── Companies ─────────────────────────────────────────────────────────────
  let developers = []
  if (Array.isArray(raw.developers) && raw.developers.length > 0) {
    developers = raw.developers.filter(Boolean)
  } else if (raw.developer && raw.developer !== 'Unknown') {
    developers = [raw.developer]
  }

  let publishers = []
  if (Array.isArray(raw.publishers) && raw.publishers.length > 0) {
    publishers = raw.publishers.filter(Boolean)
  } else if (raw.publisher && raw.publisher !== 'Unknown') {
    publishers = [raw.publisher]
  }

  // ── Provenance ────────────────────────────────────────────────────────────
  const rawIds = { ...(raw.rawIds ?? {}) }
  if (source === 'igdb' && raw.id != null) rawIds.igdb = raw.id
  if (raw.slug) rawIds.slug = raw.slug

  // ── Release date ──────────────────────────────────────────────────────────
  // Keep as Date object so recommendationService sorting (.getTime()) still works.
  let releaseDate = null
  if (raw.releaseDate instanceof Date) {
    releaseDate = raw.releaseDate
  } else if (typeof raw.releaseDate === 'string' && raw.releaseDate) {
    const parsed = new Date(raw.releaseDate)
    releaseDate = isNaN(parsed.getTime()) ? null : parsed
  }

  // ── Assemble canonical Game ────────────────────────────────────────────────
  return {
    // Identity
    id: raw.id,
    gameId: raw.gameId ?? makeGameId(title, year),
    slug: raw.slug,

    // Display
    title,
    year,
    releaseDate,

    // Images
    image: raw.image ?? null,
    imageHD: raw.imageHD ?? null,
    coverUrl: raw.image ?? null,   // semantic alias kept in sync

    // Metadata
    rating: raw.rating ?? null,
    genre: genres.length > 0 ? genres.join(', ') : (raw.genre ?? ''),
    genres,
    developer: developers[0] ?? raw.developer ?? 'Unknown',
    developers,
    publisher: publishers[0] ?? raw.publisher ?? 'Unknown',
    publishers,
    platforms: Array.isArray(raw.platforms) ? raw.platforms.filter(Boolean) : [],
    description: raw.description ?? null,
    screenshots: Array.isArray(raw.screenshots) ? raw.screenshots.filter(Boolean) : [],
    websites: Array.isArray(raw.websites) ? raw.websites.filter(Boolean) : [],

    // Style / Similarity
    themes: Array.isArray(raw.themes) ? raw.themes.filter(Boolean) : [],
    playerPerspectives: Array.isArray(raw.playerPerspectives) ? raw.playerPerspectives.filter(Boolean) : [],
    gameModes: Array.isArray(raw.gameModes) ? raw.gameModes.filter(Boolean) : [],
    keywords: Array.isArray(raw.keywords) ? raw.keywords.filter(Boolean) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [],
    tagIds: Array.isArray(raw.tagIds) ? raw.tagIds.filter(id => id != null) : [],

    // Relevance (search only — null/[] everywhere else)
    popularity: raw.popularity ?? null,
    altNames: Array.isArray(raw.altNames) ? raw.altNames.filter(Boolean) : [],

    // Provenance
    source: source || 'unknown',
    rawIds,
  }
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/**
 * Return the longer of two nullable strings; null only if both are absent.
 *
 * @param {string|null} a
 * @param {string|null} b
 * @returns {string|null}
 */
function pickLonger(a, b) {
  if (!a) return b ?? null
  if (!b) return a
  return a.length >= b.length ? a : b
}

/**
 * Merge two normalized Game objects into one, preferring richer data.
 *
 * Rules applied field-by-field:
 *   • Identity / display (id, gameId, title, year):  always from `base`.
 *   • Nullable scalars (image, coverUrl, rating, …):  first non-null wins.
 *   • description:  the longer string wins.
 *   • Arrays (genres, platforms, developers, …):  union, preserving order.
 *   • rawIds:  merged; `base` values win on key conflicts.
 *
 * `base` is the first-seen entry, so first-seen position is stable.
 *
 * @param {import('../types/models').Game} base
 * @param {import('../types/models').Game} other
 * @returns {import('../types/models').Game}
 */
function mergeGames(base, other) {
  /** Union two arrays while preserving order and removing duplicates. */
  const mergeArr = (a, b) => [...new Set([...a, ...b])]

  const genres      = mergeArr(base.genres, other.genres)
  const developers  = mergeArr(base.developers, other.developers)
  const publishers  = mergeArr(base.publishers, other.publishers)

  return {
    // Identity — always from base (stable)
    id:      base.id,
    gameId:  base.gameId,
    slug:    base.slug ?? other.slug,

    // Display — base wins; fall back to other for missing date
    title:       base.title,
    year:        base.year,
    releaseDate: base.releaseDate ?? other.releaseDate,

    // Images — first non-null
    image:    base.image    ?? other.image,
    imageHD:  base.imageHD  ?? other.imageHD,
    coverUrl: base.coverUrl ?? other.coverUrl,

    // Metadata — scalars: first non-null; arrays: union
    rating:    base.rating ?? other.rating,
    genres,
    genre:      genres.length > 0 ? genres.join(', ') : (base.genre || other.genre || ''),
    developers,
    developer:  developers[0] ?? 'Unknown',
    publishers,
    publisher:  publishers[0] ?? 'Unknown',
    platforms:  mergeArr(base.platforms, other.platforms),
    description: pickLonger(base.description, other.description),
    screenshots: mergeArr(base.screenshots, other.screenshots),
    websites:    mergeArr(base.websites, other.websites),

    // Style / Similarity — union
    themes:             mergeArr(base.themes, other.themes),
    playerPerspectives: mergeArr(base.playerPerspectives, other.playerPerspectives),
    gameModes:          mergeArr(base.gameModes, other.gameModes),
    keywords:           mergeArr(base.keywords, other.keywords),
    tags:               mergeArr(base.tags, other.tags),
    tagIds:             [...new Set([...base.tagIds, ...other.tagIds])],

    // Relevance — search results arrive popularity-ordered, so `base` (the
    // first-seen duplicate) already carries the highest count.
    popularity: base.popularity ?? other.popularity,
    altNames:   mergeArr(base.altNames, other.altNames),

    // Provenance — merge rawIds (base wins on key conflicts); keep base source
    source:  base.source,
    rawIds:  { ...other.rawIds, ...base.rawIds },
  }
}

/**
 * De-duplicate a Game[] by `gameId`.
 *
 * When two or more entries share the same `gameId` they are merged with
 * `mergeGames` so that the "best" version of every field survives.
 * Output order follows first-seen position (stable).
 *
 * @param {import('../types/models').Game[]} games
 * @returns {import('../types/models').Game[]}
 */
export function dedupeGames(games) {
  /** gameId → merged Game */
  const seen  = new Map()
  /** first-seen insertion order */
  const order = []

  for (const game of games) {
    const key = game.gameId || 'unknown-game'
    if (seen.has(key)) {
      seen.set(key, mergeGames(seen.get(key), game))
    } else {
      seen.set(key, game)
      order.push(key)
    }
  }

  return order.map(key => seen.get(key))
}

/**
 * Normalize an array of pre-formatted game objects into Game[].
 * Skips null / nameless entries defensively, then de-duplicates by gameId.
 *
 * @param {Object[]} raws   - Array of pre-formatted game objects
 * @param {'igdb'|'unknown'} [source='unknown']
 * @returns {import('../types/models').Game[]}
 */
export function normalizeGames(raws, source = 'unknown') {
  if (!Array.isArray(raws)) return []
  const normalized = raws
    .filter(raw => raw != null && (raw.title || raw.name))
    .map(raw => normalizeGame(raw, source))
  return dedupeGames(normalized)
}

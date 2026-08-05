/**
 * @fileoverview Canonical Game model for the entire application.
 *
 * All game data flowing through the app conforms to this shape.
 * Raw API results (IGDB) are converted at the service boundary
 * via normalizeGame() in services/normalizeGame.js before reaching any UI.
 */

/**
 * @typedef {Object} RawIds
 * @property {number|string|undefined} igdb  - IGDB numeric game ID
 * @property {string|undefined}        slug  - URL slug
 */

/**
 * @typedef {'igdb'|'unknown'} GameSource
 */

/**
 * @typedef {Object} Game
 *
 * Canonical game model consumed by all UI components.
 * Every field is null-safe: arrays default to [], strings to null or ''.
 *
 * ── Identity ────────────────────────────────────────────────────────────────
 * @property {string|number}  id                 - API-native ID used for routing & API calls
 * @property {string}         gameId             - Stable slug-based app ID: "{title-slug}-{year}"
 * @property {string|undefined} slug             - URL slug (when available)
 *
 * ── Display ─────────────────────────────────────────────────────────────────
 * @property {string}         title              - Whitespace-normalised display title
 * @property {number|null}    year               - Release year, e.g. 2022
 * @property {Date|null}      releaseDate        - Full release date (Date object, preserved for sorting)
 *
 * ── Images ──────────────────────────────────────────────────────────────────
 * @property {string|null}    image              - Primary cover image URL
 * @property {string|null}    imageHD            - High-resolution cover URL
 * @property {string|null}    coverUrl           - Semantic alias for `image`
 *
 * ── Metadata ────────────────────────────────────────────────────────────────
 * @property {string|null}    rating             - Rating string on 0–5 scale, e.g. "4.2"
 * @property {string}         genre              - Comma-joined primary genres (e.g. "Action, RPG")
 * @property {string[]}       genres             - Genre names array
 * @property {string}         developer          - Primary developer display name
 * @property {string[]}       developers         - All developer names
 * @property {string}         publisher          - Primary publisher display name
 * @property {string[]}       publishers         - All publisher names
 * @property {string[]}       platforms          - Platform names
 * @property {string|null}    description        - Game summary / description
 * @property {string[]}       screenshots        - Screenshot image URLs
 * @property {string[]}       websites           - Website URLs
 *
 * ── Style / Similarity ──────────────────────────────────────────────────────
 * @property {string[]}       themes             - IGDB theme names
 * @property {string[]}       playerPerspectives - Player perspective labels
 * @property {string[]}       gameModes          - Game mode labels
 * @property {string[]}       keywords           - IGDB keyword names
 * @property {string[]}       tags               - Tag names
 * @property {number[]}       tagIds             - Tag IDs (for similarity matching)
 *
 * ── Relevance ───────────────────────────────────────────────────────────────
 * Populated only by the search path (igdb.js searchGames), consumed only by
 * searchService.rankGames(). Null / empty on games from every other source.
 * @property {number|null}    popularity         - IGDB total_rating_count (how widely rated)
 * @property {string[]}       altNames           - IGDB alternative names ("FF7", "BOTW", …)
 *
 * ── Provenance ──────────────────────────────────────────────────────────────
 * @property {GameSource}     source             - Which API this game originates from
 * @property {RawIds}         rawIds             - Original API identifiers for cross-referencing
 */

/**
 * Returns a fully-populated empty Game with safe defaults.
 * Useful for tests, safe destructuring, and as a normalizer base.
 *
 * @returns {Game}
 */
export function createEmptyGame() {
  return {
    // Identity
    id: '',
    gameId: '',
    slug: undefined,
    // Display
    title: '',
    year: null,
    releaseDate: null,
    // Images
    image: null,
    imageHD: null,
    coverUrl: null,
    // Metadata
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
    // Style / Similarity
    themes: [],
    playerPerspectives: [],
    gameModes: [],
    keywords: [],
    tags: [],
    tagIds: [],
    // Relevance
    popularity: null,
    altNames: [],
    // Provenance
    source: 'unknown',
    rawIds: {},
  }
}

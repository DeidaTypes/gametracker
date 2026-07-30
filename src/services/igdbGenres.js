/**
 * The fixed IGDB formal genre list — reference data for Your Gaming Map.
 *
 * WHY FORMAL GENRES AND NOT KEYWORDS
 * IGDB exposes both a formal `genres` field (a closed, curated set) and
 * community `keywords` ("Soulslike", "cozy", "metroidvania"). Keywords are
 * richer but sparse and inconsistently applied, so a map built on them would
 * have holes that LOOK like user behavior — "you've never played a Soulslike"
 * when really the tag is just missing. The formal genre field is populated for
 * essentially every game with metadata, which is what lets the map make a
 * claim like "you have never played a Racing game" and be right.
 *
 * WHY THIS IS HARDCODED
 * IGDB's /genres endpoint returned exactly these 23 rows (verified against the
 * live API), and the list has been stable for years. There is deliberately NO
 * job watching IGDB for new genres: a new genre changes what the map MEANS —
 * every existing user would silently gain a "not yet explored" tile they never
 * chose to leave empty. That should be a human decision. If IGDB ever adds
 * one, update this array and re-run the seed in
 * supabase/migrations/20260730130000_gaming_map.sql, which holds the same list
 * server-side.
 *
 * `name` is the exact IGDB name. That exactness is load-bearing: it is the
 * join key between a genre id and both `game_tags.genre_names` and the
 * `user_taste_vectors.genre_weights` keys that getTasteVector returns.
 */

/** @typedef {{ id: number, name: string, slug: string, sortOrder: number }} IgdbGenre */

/** All 23 formal IGDB genres, in canonical display order. @type {readonly IgdbGenre[]} */
export const IGDB_GENRES = Object.freeze([
  { id: 2,  name: 'Point-and-click',             slug: 'point-and-click',            sortOrder: 1 },
  { id: 4,  name: 'Fighting',                    slug: 'fighting',                   sortOrder: 2 },
  { id: 5,  name: 'Shooter',                     slug: 'shooter',                    sortOrder: 3 },
  { id: 7,  name: 'Music',                       slug: 'music',                      sortOrder: 4 },
  { id: 8,  name: 'Platform',                    slug: 'platform',                   sortOrder: 5 },
  { id: 9,  name: 'Puzzle',                      slug: 'puzzle',                     sortOrder: 6 },
  { id: 10, name: 'Racing',                      slug: 'racing',                     sortOrder: 7 },
  { id: 11, name: 'Real Time Strategy (RTS)',    slug: 'real-time-strategy-rts',     sortOrder: 8 },
  { id: 12, name: 'Role-playing (RPG)',          slug: 'role-playing-rpg',           sortOrder: 9 },
  { id: 13, name: 'Simulator',                   slug: 'simulator',                  sortOrder: 10 },
  { id: 14, name: 'Sport',                       slug: 'sport',                      sortOrder: 11 },
  { id: 15, name: 'Strategy',                    slug: 'strategy',                   sortOrder: 12 },
  { id: 16, name: 'Turn-based strategy (TBS)',   slug: 'turn-based-strategy-tbs',    sortOrder: 13 },
  { id: 24, name: 'Tactical',                    slug: 'tactical',                   sortOrder: 14 },
  { id: 25, name: "Hack and slash/Beat 'em up",  slug: 'hack-and-slash-beat-em-up',  sortOrder: 15 },
  { id: 26, name: 'Quiz/Trivia',                 slug: 'quiz-trivia',                sortOrder: 16 },
  { id: 30, name: 'Pinball',                     slug: 'pinball',                    sortOrder: 17 },
  { id: 31, name: 'Adventure',                   slug: 'adventure',                  sortOrder: 18 },
  { id: 32, name: 'Indie',                       slug: 'indie',                      sortOrder: 19 },
  { id: 33, name: 'Arcade',                      slug: 'arcade',                     sortOrder: 20 },
  { id: 34, name: 'Visual Novel',                slug: 'visual-novel',               sortOrder: 21 },
  { id: 35, name: 'Card & Board Game',           slug: 'card-and-board-game',        sortOrder: 22 },
  { id: 36, name: 'MOBA',                        slug: 'moba',                       sortOrder: 23 },
])

const BY_ID = new Map(IGDB_GENRES.map((g) => [g.id, g]))
const BY_NAME = new Map(IGDB_GENRES.map((g) => [g.name.toLowerCase(), g]))
const BY_SLUG = new Map(IGDB_GENRES.map((g) => [g.slug, g]))

/** @returns {IgdbGenre|null} */
export function genreById(id) {
  return BY_ID.get(Number(id)) || null
}

/**
 * Look up by IGDB name. Case-insensitive so a caller comparing against
 * taste-vector keys or game_tags.genre_names can't miss on casing alone.
 * @returns {IgdbGenre|null}
 */
export function genreByName(name) {
  if (!name) return null
  return BY_NAME.get(String(name).toLowerCase()) || null
}

/** @returns {IgdbGenre|null} */
export function genreBySlug(slug) {
  if (!slug) return null
  return BY_SLUG.get(String(slug)) || null
}

/**
 * Keep only ids that are real formal genres.
 *
 * IGDB occasionally returns a retired genre id on an old game (the id space
 * is sparse — 1, 3, 6, 17-23, 27-29 were merged away over the years). Those
 * must be dropped rather than mapped to a neighbouring tile, or a retired id
 * would quietly inflate whichever genre happened to sit next to it.
 *
 * @param {Array<number|{id:number}>} ids
 * @returns {number[]} deduped, valid genre ids
 */
export function normalizeGenreIds(ids) {
  if (!Array.isArray(ids)) return []
  const out = new Set()
  for (const raw of ids) {
    const id = Number(typeof raw === 'object' && raw !== null ? raw.id : raw)
    if (BY_ID.has(id)) out.add(id)
  }
  return Array.from(out)
}

/**
 * Map IGDB genre NAMES to ids, dropping anything unrecognized.
 * Used for game_tags.genre_names rows and taste-vector keys.
 * @param {string[]} names
 * @returns {number[]}
 */
export function genreIdsFromNames(names) {
  if (!Array.isArray(names)) return []
  const out = new Set()
  for (const name of names) {
    const g = genreByName(name)
    if (g) out.add(g.id)
  }
  return Array.from(out)
}

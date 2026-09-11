/**
 * @fileoverview Builds the "game stub" GameDetail seeds its hero from on
 * first paint, so the title/cover/year/developer the caller already has
 * on screen isn't thrown away and re-fetched from IGDB before anything
 * can render.
 *
 * Perf fix for the "skeleton flash on every game tap" issue: GameDetail
 * used to gate its entire first paint on `getGameById`, even though the
 * grid/card/row the user just tapped almost always already has the
 * title, cover, year and developer on screen. See GameDetail.jsx for how
 * this stub seeds `game` state and getGameById is left to fill in
 * everything else (description, genres, screenshots, etc.) in the
 * background.
 *
 * Callers pass whatever shape they already have in hand — a full
 * normalizeGame() Game, a raw Supabase row with `game_title`/`game_image`
 * columns, or a hand-rolled `{ id, title, image }` object — and this
 * normalizes the handful of field-name variants seen across the app.
 * Whatever a caller doesn't have is simply omitted (undefined), never
 * fabricated; `id` is intentionally left out since GameDetail always
 * receives it via the `:gameId` route param in the same navigation.
 */

/**
 * @param {object} [source] - Any game-shaped object (or activity/review row).
 * @returns {{ coverImage?: string, title?: string, year?: (number|string), developer?: string }}
 */
export function getGameNavStub(source) {
  if (!source || typeof source !== 'object') return {}

  const title =
    source.title || source.name || source.gameTitle || source.game_title || undefined

  const coverImage =
    source.coverImage ||
    source.image ||
    source.coverUrl ||
    source.cover_url ||
    source.game_image ||
    undefined

  const year = source.year || undefined

  // `developers` (array) is the richer, never-fabricated signal — an empty
  // array means genuinely unknown. The singular `developer` string
  // defaults to the sentinel 'Unknown' in normalizeGame(), so that value
  // is deliberately excluded rather than surfaced as a real developer.
  const developer =
    (Array.isArray(source.developers) && source.developers[0]) ||
    (source.developer && source.developer !== 'Unknown' ? source.developer : undefined)

  return { coverImage, title, year, developer }
}

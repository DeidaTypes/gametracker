// Image utility functions for handling cover images from IGDB

// IGDB size tokens, smallest to largest, that this app ever produces
// (see igdb.js's coverUrlFromImageId / extractCoverUrl — every cover is
// fetched at t_cover_big by default, so "downsizing" here means
// rewriting that URL's size token, not requesting a new one).
// Includes the square tokens so an incoming URL already carrying one can
// still be rewritten to a cover-shaped variant; see SIZE_BREAKPOINTS for
// why neither is ever selected as a target.
const IGDB_SIZE_TOKENS = ['t_cover_big_2x', 't_cover_big', 't_cover_small', 't_thumb', 't_micro']

// Size (px, the larger of width/height as rendered) → IGDB token.
// Anything above the largest breakpoint falls through to `t_cover_big`,
// which is the deliberate ceiling for list/grid/row cards (see below) —
// we never request `t_cover_big_2x` just because a caller passed a big
// number; only an already-2x URL (e.g. via imageHD) is preserved as-is.
// `t_thumb` is deliberately absent: it is a SQUARE 90x90 center-crop, not
// a scaled-down cover. Every caller here renders into a portrait cover
// slot, so selecting it meant the art was cropped square by IGDB and then
// cropped again by object-fit — covers read as zoomed-in details rather
// than box art. `t_cover_small` is the smallest cover-shaped variant and
// is the same 90px wide, so this costs nothing meaningful in bytes.
const SIZE_BREAKPOINTS = [
  { max: 220, token: 't_cover_small' }, // ~90x128 — feed/row thumbnails, compact list rows
]
const DEFAULT_TOKEN = 't_cover_big' // 264x374 — grid/detail cards

function sizeToToken(size) {
  if (size == null) return DEFAULT_TOKEN
  const breakpoint = SIZE_BREAKPOINTS.find((b) => size <= b.max)
  return breakpoint ? breakpoint.token : DEFAULT_TOKEN
}

/**
 * Rewrite an IGDB image URL's size token to the one that best matches
 * `size` (the largest dimension, in px, the image will actually render
 * at). Non-IGDB URLs (user-uploaded, external, etc.) pass through
 * unchanged — we only know how to resize IGDB's own token scheme.
 *
 * @param {string|null|undefined} url
 * @param {number} [size] - Target render size in px; omit for the
 *   t_cover_big default.
 * @returns {string|null}
 */
export function getSizedImageUrl(url, size) {
  if (!url) return null

  if (!(url.includes('images.igdb.com') || url.includes('igdb.com'))) {
    return url
  }

  const token = sizeToToken(size)

  try {
    for (const known of IGDB_SIZE_TOKENS) {
      if (url.includes(known)) {
        return known === token ? url : url.replace(known, token)
      }
    }
    // No recognised size token in the URL — nothing safe to rewrite.
    return url
  } catch (e) {
    console.warn('Error resizing IGDB image:', e)
    return url
  }
}

/**
 * Get the cover image URL for a game, sized to match where it will
 * actually render. Defaults to IGDB's `t_cover_big` (264x374) — the
 * right size for list/grid/row cards — but honors a smaller `size`
 * (px) for compact thumbnails (feed rows, search results, etc.) so
 * they don't download a full-size cover for a 34x46 slot.
 *
 * We deliberately avoid `t_cover_big_2x` and full-resolution sizes
 * for anything other than an explicit `imageHD` override: doubling
 * every cover's bytes is the main source of slow, inconsistent feed
 * loads.
 *
 * @param {Object} game - Game object with image properties
 * @param {number} [size] - Target render size in px (the larger of
 *   width/height). Omit for the default t_cover_big sizing.
 * @returns {string|null} - Cover image URL sized for `size`, or null
 */
export function getBestImageUrl(game, size) {
  if (!game) return null

  const raw = game.imageHD || game.image || game.coverUrl
  if (!raw) return null

  return getSizedImageUrl(raw, size)
}

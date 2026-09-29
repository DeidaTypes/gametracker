// Image utility functions for handling cover images from IGDB

import { coverSizeForDisplay, IGDB_COVER_TOKENS, rewriteCoverToken } from './igdbImage'

// Size (px, the larger of width/height as rendered) → IGDB token suffix.
// Covers use t_cover_big (<60px display) or t_cover_big_2x (everything else).
// Never select t_thumb, t_cover_small, t_720p, or t_1080p for cover art.
function sizeToToken(size) {
  if (size == null) return 'cover_big'
  return coverSizeForDisplay(size)
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
    for (const known of IGDB_COVER_TOKENS) {
      if (url.includes(known)) {
        return known === `t_${token}` ? url : rewriteCoverToken(url, token)
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
 * actually render.
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

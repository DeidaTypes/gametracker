// Canonical IGDB cover URL builder — every cover.image_id in the app
// routes through here so size tokens stay consistent.

const IGDB_IMAGE_BASE = 'https://images.igdb.com/igdb/image/upload'

/** Known IGDB size tokens, largest first, for URL rewriting. */
export const IGDB_COVER_TOKENS = [
  't_1080p',
  't_720p',
  't_cover_big_2x',
  't_cover_big',
  't_cover_small',
  't_thumb',
  't_micro',
]

/**
 * Build an IGDB cover URL from a raw image_id.
 *
 * @param {string|number|null|undefined} imageId
 * @param {string} [size='cover_big'] - token suffix without the `t_` prefix
 *   (e.g. 'cover_big', 'cover_big_2x')
 * @returns {string|null}
 */
export function coverUrl(imageId, size = 'cover_big') {
  if (!imageId) return null
  return `${IGDB_IMAGE_BASE}/t_${size}/${imageId}.jpg`
}

/** Pixel width IGDB actually serves for each portrait cover token. */
const COVER_TOKEN_WIDTH = {
  cover_big: 264,
  cover_big_2x: 528,
}

/**
 * Pick the IGDB cover token for a CSS display width (px).
 *
 * Requests 2× that width for retina, then the smallest portrait token
 * that still covers it. A 92px library cell (2× = 184) stays on
 * t_cover_big (264) instead of stepping up to t_cover_big_2x (528).
 * Never uses t_thumb, t_cover_small, t_720p, or t_1080p for cover art.
 *
 * @param {number} displayWidthPx
 * @returns {string} token suffix without `t_`
 */
export function coverSizeForDisplay(displayWidthPx) {
  const need = Math.max(0, Number(displayWidthPx) || 0) * 2
  if (need <= COVER_TOKEN_WIDTH.cover_big) return 'cover_big'
  return 'cover_big_2x'
}

/**
 * Rewrite an existing IGDB cover URL's size token.
 *
 * @param {string|null|undefined} url
 * @param {string} size - token suffix without `t_`
 * @returns {string|null}
 */
/** Extract the IGDB image_id hash from a cover URL, if present. */
export function imageIdFromCoverUrl(url) {
  if (!url || typeof url !== 'string') return null
  const match = url.match(/\/t_[^/]+\/([^./?]+)\.jpg/i)
  return match ? match[1] : null
}

export function rewriteCoverToken(url, size) {
  if (!url) return null
  if (!(url.includes('images.igdb.com') || url.includes('igdb.com'))) return url

  const token = `t_${size}`
  try {
    for (const known of IGDB_COVER_TOKENS) {
      if (url.includes(known)) {
        return known === token ? url : url.replace(known, token)
      }
    }
    return url
  } catch {
    return url
  }
}

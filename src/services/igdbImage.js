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

/**
 * Pick the IGDB cover token for a given CSS display width (px).
 * Under 60px → t_cover_big; everything else → t_cover_big_2x (retina cover).
 * Never use screenshot sizes (t_720p / t_1080p) for portrait cover art.
 *
 * @param {number} displayWidthPx
 * @returns {string} token suffix without `t_`
 */
export function coverSizeForDisplay(displayWidthPx) {
  if (displayWidthPx < 60) return 'cover_big'
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

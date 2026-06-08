// Image utility functions for handling cover images from IGDB

/**
 * Get the cover image URL for a game, normalised to IGDB's `t_cover_big`
 * size (264×374). This is the right size for list/grid/row cards — it
 * renders crisply at the sizes we display while keeping payloads small
 * and load times consistent on mobile networks. We deliberately avoid
 * `t_cover_big_2x` and full-resolution sizes in lists: doubling every
 * cover's bytes is the main source of slow, inconsistent feed loads.
 * @param {Object} game - Game object with image properties
 * @returns {string|null} - Cover image URL at t_cover_big, or null
 */
export function getBestImageUrl(game) {
  if (!game) return null

  if (game.imageHD) {
    return game.imageHD
  }

  if (!game.image) {
    return null
  }

  const imageUrl = game.image

  if (imageUrl.includes('images.igdb.com') || imageUrl.includes('igdb.com')) {
    try {
      if (imageUrl.includes('t_cover_big_2x')) {
        return imageUrl.replace('t_cover_big_2x', 't_cover_big')
      }
      if (imageUrl.includes('t_thumb')) {
        return imageUrl.replace('t_thumb', 't_cover_big')
      }
      return imageUrl
    } catch (e) {
      console.warn('Error normalising IGDB image:', e)
      return imageUrl
    }
  }

  return imageUrl
}

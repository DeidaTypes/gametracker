// Image utility functions for handling HD images from IGDB

/**
 * Get the best available HD image URL for a game.
 * @param {Object} game - Game object with image properties
 * @param {number} preferredWidth - Preferred width for HD image (default: 1920)
 * @returns {string} - Best available image URL
 */
export function getBestImageUrl(game, preferredWidth = 1920) {
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
      let enhancedUrl = imageUrl
      if (imageUrl.includes('t_thumb')) {
        enhancedUrl = imageUrl.replace('t_thumb', 't_cover_big_2x')
      } else if (imageUrl.includes('t_cover_big') && !imageUrl.includes('t_cover_big_2x')) {
        enhancedUrl = imageUrl.replace('t_cover_big', 't_cover_big_2x')
      }
      return enhancedUrl
    } catch (e) {
      console.warn('Error enhancing IGDB image:', e)
      return imageUrl
    }
  }
  
  return imageUrl
}

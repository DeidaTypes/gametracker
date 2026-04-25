// Image utility functions for handling HD images from different APIs
import { getHDImageUrl } from './rawg'

/**
 * Get the best available HD image URL for a game
 * Handles both RAWG and IGDB image formats
 * @param {Object} game - Game object with image properties
 * @param {number} preferredWidth - Preferred width for HD image (default: 1920)
 * @returns {string} - Best available image URL
 */
export function getBestImageUrl(game, preferredWidth = 1920) {
  if (!game) return null
  
  // If imageHD is already provided, use it
  if (game.imageHD) {
    console.log('Using imageHD for:', game.title)
    return game.imageHD
  }
  
  // If no image at all, return null
  if (!game.image) {
    return null
  }
  
  const imageUrl = game.image
  console.log('Enhancing image for:', game.title, 'Original URL:', imageUrl)
  
  // Check if it's a RAWG image (media.rawg.io)
  if (imageUrl.includes('media.rawg.io')) {
    try {
      const hdUrl = getHDImageUrl(imageUrl, preferredWidth)
      console.log('RAWG HD URL:', hdUrl)
      return hdUrl || imageUrl
    } catch (e) {
      console.warn('Error enhancing RAWG image:', e)
      return imageUrl
    }
  }
  
  // Check if it's an IGDB image (images.igdb.com)
  if (imageUrl.includes('images.igdb.com') || imageUrl.includes('igdb.com')) {
    try {
      // IGDB uses size parameters like t_thumb, t_cover_big, t_1080p, etc.
      // Upgrade to higher resolution if available
      let enhancedUrl = imageUrl
      if (imageUrl.includes('t_thumb')) {
        // Replace thumb with cover_big_2x for HD
        enhancedUrl = imageUrl.replace('t_thumb', 't_cover_big_2x')
        console.log('IGDB enhanced from thumb to HD:', enhancedUrl)
      } else if (imageUrl.includes('t_cover_big') && !imageUrl.includes('t_cover_big_2x')) {
        // Upgrade cover_big to cover_big_2x
        enhancedUrl = imageUrl.replace('t_cover_big', 't_cover_big_2x')
        console.log('IGDB enhanced from cover_big to HD:', enhancedUrl)
      } else if (imageUrl.includes('t_1080p') || imageUrl.includes('t_cover_big_2x')) {
        // Already HD, return as-is
        console.log('IGDB image already HD')
        return imageUrl
      } else {
        console.log('IGDB image - no size parameter found, returning as-is')
      }
      return enhancedUrl
    } catch (e) {
      console.warn('Error enhancing IGDB image:', e)
      return imageUrl
    }
  }
  
  // For any other image source, return as-is
  return imageUrl
}


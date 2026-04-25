// Recommendation Service - Re-export from recommendationService for backward compatibility
// This file now uses RAWG for better popularity/trending data, mapped to IGDB for art/info

export {
  getPersonalizedRecommendations,
  getRecommendationsFromViewed
} from './recommendationService'


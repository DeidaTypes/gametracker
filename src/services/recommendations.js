// Recommendation Service - generates personalized game recommendations

import { getGamesByGenre, getPopularGames, getRecentlyReleasedGames, searchGames } from './igdb'
import { getPreferences, getSearchHistory, getViewedGames } from './userPreferences'

// Get personalized recommendations based on user preferences
export async function getPersonalizedRecommendations() {
  const prefs = getPreferences()
  
  if (!prefs || !prefs.onboarded || prefs.favoriteGenres.length === 0) {
    // If user hasn't onboarded, return default recommendations
    return getDefaultRecommendations()
  }

  const recommendations = {}
  
  try {
    // ALWAYS FETCH POPULAR AND RECENT FIRST - these go at the top
    const [popular, recent] = await Promise.all([
      getPopularGames(8).catch(() => []),
      getRecentlyReleasedGames(8).catch(() => [])
    ])

    // Add popular and recent games FIRST (so they appear at the top)
    if (recent.length > 0) {
      recommendations['New Releases'] = recent
    }
    if (popular.length > 0) {
      recommendations['Trending Now'] = popular
    }

    // Get games for each favorite genre (up to 4 genres for more content)
    const favoriteGenres = prefs.favoriteGenres.slice(0, 4)
    
    const genrePromises = favoriteGenres.map(genre => 
      getGamesByGenre(genre, 8).catch(() => [])
    )
    
    const genreResults = await Promise.all(genrePromises)
    
    favoriteGenres.forEach((genre, index) => {
      if (genreResults[index] && genreResults[index].length > 0) {
        recommendations[`Top ${genre} Games`] = genreResults[index]
      }
    })

    // Get games based on search history
    const searchHistory = getSearchHistory()
    if (searchHistory.length > 0) {
      // Use the most recent search term
      const recentSearch = searchHistory[0]
      try {
        const searchResults = await searchGames(recentSearch, 6)
        if (searchResults.length > 0) {
          recommendations['Based on Your Searches'] = searchResults
        }
      } catch (err) {
        console.error('Error fetching search-based recommendations:', err)
      }
    }

  } catch (error) {
    console.error('Error generating recommendations:', error)
    return getDefaultRecommendations()
  }

  return recommendations
}

// Get default recommendations (when user hasn't onboarded)
async function getDefaultRecommendations() {
  try {
    const [popular, recent, rpg, indie, action, adventure, strategy] = await Promise.all([
      getPopularGames(8).catch(() => []),
      getRecentlyReleasedGames(8).catch(() => []),
      getGamesByGenre('Role-playing (RPG)', 8).catch(() => []),
      getGamesByGenre('Indie', 8).catch(() => []),
      getGamesByGenre('Action', 8).catch(() => []),
      getGamesByGenre('Adventure', 8).catch(() => []),
      getGamesByGenre('Strategy', 8).catch(() => []),
    ])

    const sections = {}
    
    // Add New Releases and Trending Now FIRST (at the top)
    if (recent.length > 0) sections['New Releases'] = recent
    if (popular.length > 0) sections['Trending Now'] = popular
    
    // Then add genre-based sections
    if (rpg.length > 0) sections['Popular RPGs'] = rpg
    if (indie.length > 0) sections['Indie Gems'] = indie
    if (action.length > 0) sections['Top Action Games'] = action
    if (adventure.length > 0) sections['Best Adventure Games'] = adventure
    if (strategy.length > 0) sections['Strategy Favorites'] = strategy

    return sections
  } catch (error) {
    console.error('Error fetching default recommendations:', error)
    return {}
  }
}

// Get recommendations based on viewed games
export async function getRecommendationsFromViewed() {
  const viewedGames = getViewedGames()
  
  if (viewedGames.length === 0) {
    return {}
  }

  // Extract genres from viewed games (simplified - would need game data)
  // For now, just return popular games
  try {
    const popular = await getPopularGames(6)
    return {
      'You Might Also Like': popular,
    }
  } catch (error) {
    console.error('Error fetching viewed-based recommendations:', error)
    return {}
  }
}


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
    // ALWAYS FETCH MOST POPULAR FIRST - this is the main focus
    // Fetch more games to ensure we have enough content
    const [popular, recent] = await Promise.all([
      getPopularGames(30).catch(() => []), // Increased to 30 for more content
      getRecentlyReleasedGames(16).catch(() => []) // Increased from 12 to 16
    ])

    // Remove duplicates and limit to 24 games for "Most Popular" section
    const uniquePopular = popular.filter((game, index, self) => 
      index === self.findIndex(g => g.id === game.id)
    ).slice(0, 24)

    // Add MOST POPULAR first (main focus of home screen)
    if (uniquePopular.length > 0) {
      recommendations['Most Popular'] = uniquePopular
    }
    
    // Add recent releases second
    if (recent.length > 0) {
      recommendations['New Releases'] = recent
    }

    // Get games for each favorite genre - create "Made for You" playlist
    const favoriteGenres = prefs.favoriteGenres.slice(0, 6) // Increased from 5 to 6
    
    const genrePromises = favoriteGenres.map(genre => 
      getGamesByGenre(genre, 16).catch(() => []) // Increased from 12 to 16
    )
    
    const genreResults = await Promise.all(genrePromises)
    
    // Create "Made for You" section with top games from user's favorite genres
    const madeForYouGames = []
    genreResults.forEach((games, index) => {
      if (games && games.length > 0) {
        // Take top 5-6 games from each genre for "Made for You" (more content)
        madeForYouGames.push(...games.slice(0, 6))
      }
    })
    
    // Remove duplicates and shuffle, then limit "Made for You" to 24 games
    const uniqueMadeForYou = madeForYouGames.filter((game, index, self) => 
      index === self.findIndex(g => g.id === game.id)
    )
    
    const shuffledMadeForYou = uniqueMadeForYou
      .sort(() => Math.random() - 0.5)
      .slice(0, 24)
    
    if (shuffledMadeForYou.length > 0) {
      recommendations['Made for You'] = shuffledMadeForYou
    }
    
    // Also add individual genre sections
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
        const searchResults = await searchGames(recentSearch, 16) // Increased from 10 to 16
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
    const [popular, recent, rpg, indie, action, adventure, strategy, puzzle, racing] = await Promise.all([
      getPopularGames(30).catch(() => []), // Increased to 30 for more content
      getRecentlyReleasedGames(16).catch(() => []), // Increased from 12 to 16
      getGamesByGenre('Role-playing (RPG)', 16).catch(() => []), // Increased from 12 to 16
      getGamesByGenre('Indie', 16).catch(() => []), // Increased from 12 to 16
      getGamesByGenre('Action', 16).catch(() => []), // Increased from 12 to 16
      getGamesByGenre('Adventure', 16).catch(() => []), // Increased from 12 to 16
      getGamesByGenre('Strategy', 16).catch(() => []), // Increased from 12 to 16
      getGamesByGenre('Puzzle', 14).catch(() => []), // Increased from 10 to 14
      getGamesByGenre('Racing', 14).catch(() => []), // Increased from 10 to 14
    ])

    const sections = {}
    
    // Remove duplicates and limit to 24 games for "Most Popular" section
    const uniquePopular = popular.filter((game, index, self) => 
      index === self.findIndex(g => g.id === game.id)
    ).slice(0, 24)
    
    // Add MOST POPULAR FIRST (main focus)
    if (uniquePopular.length > 0) sections['Most Popular'] = uniquePopular
    
    // Add New Releases second
    if (recent.length > 0) sections['New Releases'] = recent
    
    // Then add genre-based sections
    if (rpg.length > 0) sections['Popular RPGs'] = rpg
    if (indie.length > 0) sections['Indie Gems'] = indie
    if (action.length > 0) sections['Top Action Games'] = action
    if (adventure.length > 0) sections['Best Adventure Games'] = adventure
    if (strategy.length > 0) sections['Strategy Favorites'] = strategy
    if (puzzle.length > 0) sections['Puzzle Games'] = puzzle
    if (racing.length > 0) sections['Racing Games'] = racing

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
  // For now, return popular games and similar genres
  try {
    const [popular, similar] = await Promise.all([
      getPopularGames(10).catch(() => []),
      getGamesByGenre('Action', 10).catch(() => [])
    ])
    
    const sections = {}
    if (popular.length > 0) {
      sections['You Might Also Like'] = popular
    }
    if (similar.length > 0) {
      sections['Similar to What You Viewed'] = similar
    }
    
    return sections
  } catch (error) {
    console.error('Error fetching viewed-based recommendations:', error)
    return {}
  }
}


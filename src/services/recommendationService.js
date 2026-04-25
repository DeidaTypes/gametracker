// Recommendation Service - Uses IGDB for all game data
// IGDB provides excellent art, detailed info, and good recommendations

import { 
  getPopularGames,
  getRecentlyReleasedGames,
  getGamesByGenre
} from './igdb'
import { getPreferences, getSearchHistory, getViewedGames } from './userPreferences'
import { searchGames } from './searchService'

// Filter games by quality - ensure we only show well-rated, popular games
function filterQualityGames(games, minRating = 3.5) {
  if (!games || games.length === 0) {
    return []
  }
  
  return games.filter(game => {
    // Only include games with valid ratings
    const rating = parseFloat(game.rating)
    if (isNaN(rating) || rating === null) {
      return false // Exclude games without ratings to maintain quality
    }
    return rating >= minRating
  }).sort((a, b) => {
    // Sort by rating first (quality - higher is better), then by release date (newer first)
    const ratingA = parseFloat(a.rating) || 0
    const ratingB = parseFloat(b.rating) || 0
    
    if (ratingB !== ratingA) {
      return ratingB - ratingA
    }
    
    // If ratings are equal, prefer newer games
    if (a.releaseDate && b.releaseDate) {
      return b.releaseDate.getTime() - a.releaseDate.getTime()
    }
    
    // If one has a release date and the other doesn't, prefer the one with a date
    if (a.releaseDate && !b.releaseDate) return -1
    if (!a.releaseDate && b.releaseDate) return 1
    
    return 0
  })
}

// Deduplicate games array
function deduplicateGames(games) {
  return games.filter((game, index, self) => 
    index === self.findIndex(g => g.id === game.id)
  )
}

// Get personalized recommendations based on user preferences
export async function getPersonalizedRecommendations() {
  const prefs = getPreferences()
  
  if (!prefs || !prefs.onboarded || prefs.favoriteGenres.length === 0) {
    // If user hasn't onboarded, return default recommendations
    return getDefaultRecommendations()
  }

  const recommendations = {}
  
  try {
    // Fetch core game data in parallel
    const [popular, recent] = await Promise.all([
      getPopularGames(40).catch((err) => {
        console.error('Failed to fetch popular games:', err)
        return []
      }),
      getRecentlyReleasedGames(30).catch((err) => {
        console.error('Failed to fetch recent games:', err)
        return []
      })
    ])

    // CATEGORY 1: Featured - Top quality popular games
    const uniquePopular = deduplicateGames(popular)
    const featuredGames = filterQualityGames(uniquePopular, 3.5).slice(0, 30)
    if (featuredGames.length > 0) {
      recommendations['Featured'] = featuredGames
    }
    
    // CATEGORY 2: New & Trending - Recent releases with quality filter
    const qualityRecent = filterQualityGames(recent, 3.0).slice(0, 25)
    if (qualityRecent.length > 0) {
      recommendations['New & Trending'] = qualityRecent
    }

    // CATEGORY 3: Made for You - Personalized from favorite genres
    const favoriteGenres = prefs.favoriteGenres.slice(0, 4) // Limit to top 4 genres
    
    const genrePromises = favoriteGenres.map(genre => 
      getGamesByGenre(genre, 15).catch((err) => {
        console.error(`Failed to fetch ${genre} games:`, err)
        return []
      })
    )
    
    const genreResults = await Promise.all(genrePromises)
    
    // Create "Made for You" section with top quality games from user's favorite genres
    const madeForYouGames = []
    genreResults.forEach((games) => {
      if (games && games.length > 0) {
        // Take top 5 quality games from each genre
        const qualityGenreGames = filterQualityGames(games, 3.5).slice(0, 5)
        madeForYouGames.push(...qualityGenreGames)
      }
    })
    
    // Remove duplicates and limit to 25 high-quality games
    const uniqueMadeForYou = deduplicateGames(madeForYouGames)
      .slice(0, 25)
    
    if (uniqueMadeForYou.length > 0) {
      recommendations['Made for You'] = uniqueMadeForYou
    }
    
    // CATEGORY 4: Top by Genre - Show top 3 favorite genres as separate sections
    const topGenres = favoriteGenres.slice(0, 3)
    topGenres.forEach((genre, index) => {
      if (genreResults[index] && genreResults[index].length > 0) {
        const qualityGenreGames = filterQualityGames(genreResults[index], 3.5).slice(0, 18)
        if (qualityGenreGames.length > 0) {
          // Create friendly genre names
          const genreDisplayName = genre.replace('Role-playing (RPG)', 'RPG')
          recommendations[`Top ${genreDisplayName}`] = qualityGenreGames
        }
      }
    })

    // CATEGORY 5: Discover More - Based on search history
    const searchHistory = getSearchHistory()
    if (searchHistory.length > 0) {
      const recentSearch = searchHistory[0]
      try {
        const searchResults = await searchGames(recentSearch, 20)
        if (searchResults.length > 0) {
          const qualitySearchResults = filterQualityGames(searchResults, 3.0).slice(0, 18)
          if (qualitySearchResults.length > 0) {
            recommendations['Discover More'] = qualitySearchResults
          }
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
    const [popular, recent, rpg, indie, action, adventure] = await Promise.all([
      getPopularGames(35).catch((err) => {
        console.error('Failed to fetch popular games:', err)
        return []
      }),
      getRecentlyReleasedGames(25).catch((err) => {
        console.error('Failed to fetch recent games:', err)
        return []
      }),
      getGamesByGenre('Role-playing (RPG)', 18).catch((err) => {
        console.error('Failed to fetch RPG games:', err)
        return []
      }),
      getGamesByGenre('Indie', 18).catch((err) => {
        console.error('Failed to fetch Indie games:', err)
        return []
      }),
      getGamesByGenre('Action', 18).catch((err) => {
        console.error('Failed to fetch Action games:', err)
        return []
      }),
      getGamesByGenre('Adventure', 18).catch((err) => {
        console.error('Failed to fetch Adventure games:', err)
        return []
      }),
    ])

    const sections = {}
    
    // CATEGORY 1: Featured - Top quality popular games
    const uniquePopular = deduplicateGames(popular)
    const featuredGames = filterQualityGames(uniquePopular, 3.5).slice(0, 30)
    if (featuredGames.length > 0) {
      sections['Featured'] = featuredGames
    }
    
    // CATEGORY 2: New & Trending - Recent releases with quality filter
    const qualityRecent = filterQualityGames(recent, 3.0).slice(0, 25)
    if (qualityRecent.length > 0) {
      sections['New & Trending'] = qualityRecent
    }
    
    // CATEGORY 3: Top by Genre - Show curated genre sections with quality filter
    const genreSections = [
      { games: rpg, name: 'Top RPG' },
      { games: indie, name: 'Indie Gems' },
      { games: action, name: 'Top Action' },
      { games: adventure, name: 'Best Adventure' }
    ]
    
    genreSections.forEach(({ games, name }) => {
      if (games && games.length > 0) {
        const qualityGames = filterQualityGames(games, 3.5).slice(0, 18)
        if (qualityGames.length > 0) {
          sections[name] = qualityGames
        }
      }
    })

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

  // Return quality games based on viewing history
  try {
    const [popular, action, adventure, rpg] = await Promise.all([
      getPopularGames(30).catch(() => []),
      getGamesByGenre('Action', 18).catch(() => []),
      getGamesByGenre('Adventure', 18).catch(() => []),
      getGamesByGenre('Role-playing (RPG)', 18).catch(() => [])
    ])
    
    const sections = {}
    
    // CATEGORY: You Might Also Like - Quality popular games
    if (popular.length > 0) {
      const qualityPopular = filterQualityGames(popular, 3.5).slice(0, 25)
      if (qualityPopular.length > 0) {
        sections['You Might Also Like'] = qualityPopular
      }
    }
    
    // CATEGORY: Similar to What You Viewed - Combine similar genre games with quality filter
    const similar = [...action, ...adventure, ...rpg]
    const uniqueSimilar = deduplicateGames(similar)
    const qualitySimilar = filterQualityGames(uniqueSimilar, 3.5).slice(0, 20)
    
    if (qualitySimilar.length > 0) {
      sections['Similar to What You Viewed'] = qualitySimilar
    }
    
    return sections
  } catch (error) {
    console.error('Error fetching viewed-based recommendations:', error)
    return {}
  }
}


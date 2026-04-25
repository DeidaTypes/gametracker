// RAWG API Service
// Get your API key from: https://rawg.io/apidocs
// Add it to your .env file as: VITE_RAWG_API_KEY=your_api_key

import { normalizeGame, normalizeGames } from './normalizeGame'

const API_KEY = import.meta.env.VITE_RAWG_API_KEY || ''
const BASE_URL = 'https://api.rawg.io/api'

// Helper function to get HD image URL from RAWG image URL
export function getHDImageUrl(imageUrl, width = 1920) {
  if (!imageUrl) return null
  
  // RAWG uses Cloudinary for images
  // The background_image field returns URLs like: https://media.rawg.io/media/games/xxx/xxx.jpg
  // We can modify the URL to request higher resolution by inserting Cloudinary transformations
  if (imageUrl.includes('media.rawg.io')) {
    try {
      // Insert Cloudinary transformation parameters for HD quality
      // Format: /c_fill,w_1920,h_1080,q_auto,f_auto/ before the filename
      const urlParts = imageUrl.split('/')
      const filename = urlParts[urlParts.length - 1]
      const basePath = urlParts.slice(0, -1).join('/')
      
      // Use Cloudinary's auto-format and quality optimization with larger dimensions
      return `${basePath}/c_fill,w_${width},h_1080,q_auto,f_auto/${filename}`
    } catch (e) {
      console.warn('Error processing HD image URL:', e)
      return imageUrl
    }
  }
  
  // If not a RAWG URL, return as-is
  return imageUrl
}

// Debug: Log if credentials are loaded
if (!API_KEY || API_KEY === '') {
  console.warn('⚠️ RAWG API key not found! Make sure you have a .env file with VITE_RAWG_API_KEY')
} else {
  console.log('✅ RAWG API key loaded successfully')
}

// Cache for API responses (stores results for 5 minutes)
const cache = new Map()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

// Rate limiting tracking
let lastRequestTime = 0
const MIN_REQUEST_INTERVAL = 100 // Minimum 100ms between requests to avoid rate limits

// Helper function to check cache
function getCached(key) {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log(`📦 Cache hit for: ${key}`)
    return cached.data
  }
  cache.delete(key)
  return null
}

// Helper function to set cache
function setCached(key, data) {
  cache.set(key, {
    data,
    timestamp: Date.now()
  })
}

// Helper function to make API requests with rate limiting and error handling
export async function rawgRequest(endpoint, params = {}) {
  // Check credentials - re-read from env in case it was updated
  const currentApiKey = import.meta.env.VITE_RAWG_API_KEY || ''
  
  if (!currentApiKey || currentApiKey === '' || currentApiKey === 'your_rawg_api_key_here') {
    const errorMsg = 'RAWG API key not configured. Please:\n1. Add VITE_RAWG_API_KEY=your_actual_api_key to your .env file\n2. RESTART your dev server (Ctrl+C then npm run dev)\n\nGet your API key from: https://rawg.io/apidocs'
    console.error('❌', errorMsg)
    console.error('Current API_KEY value:', currentApiKey ? 'Set (but may be placeholder)' : 'Not set')
    throw new Error(errorMsg)
  }

  // Rate limiting - ensure minimum time between requests
  const timeSinceLastRequest = Date.now() - lastRequestTime
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest))
  }
  lastRequestTime = Date.now()

  // Build URL with API key (use currentApiKey from above check)
  const urlParams = new URLSearchParams({
    key: currentApiKey,
    ...params
  })
  const url = `${BASE_URL}${endpoint}?${urlParams.toString()}`
  
  console.log(`🔗 Request URL: ${BASE_URL}${endpoint} (API key: ${currentApiKey.substring(0, 8)}...)`)

  // Check cache first
  const cacheKey = `${endpoint}?${urlParams.toString()}`
  const cached = getCached(cacheKey)
  if (cached) {
    return cached
  }

  try {
    console.log(`📡 Making RAWG API request to ${endpoint}...`)
    const response = await fetch(url)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`❌ RAWG API error ${response.status}:`, errorText)
      
      if (response.status === 401) {
        throw new Error('Unauthorized. Your RAWG API key may be invalid. Please check your API key in the .env file.')
      } else if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again.')
      } else if (response.status === 404) {
        throw new Error('Game not found.')
      } else {
        throw new Error(`RAWG API error: ${response.status} - ${errorText}`)
      }
    }

    const data = await response.json()
    
    // Cache successful responses
    setCached(cacheKey, data)
    
    console.log(`✅ RAWG API request successful`)
    return data
  } catch (error) {
    console.error('❌ RAWG API request error:', error)
    // If it's already a formatted error, re-throw it
    if (error.message && (error.message.includes('Unauthorized') || error.message.includes('Rate limit') || error.message.includes('not found'))) {
      throw error
    }
    // Otherwise wrap it
    throw new Error(`RAWG API request failed: ${error.message}`)
  }
}

// Search games with enhanced relevance sorting
export async function searchGames(searchTerm, limit = 30) {
  if (!searchTerm || !searchTerm.trim()) {
    return []
  }

  try {
    console.log('🔍 Searching RAWG for:', searchTerm)
    
    const trimmedTerm = searchTerm.trim()
    
    // RAWG search - fetch more results to allow better filtering
    const data = await rawgRequest('/games', {
      search: trimmedTerm,
      page_size: Math.min(limit * 3, 60), // Fetch more for better relevance sorting
      ordering: '-rating,-added' // Initial sort by rating and popularity
    })
    
    const games = data.results || []
    console.log(`✅ RAWG search results: ${games.length} games found`)
    
    if (games.length === 0) {
      return []
    }
    
    // Filter games with images and calculate enhanced relevance scores
    const gamesWithScores = games
      .filter(game => game.background_image && game.name) // Only games with images and names
      .map(game => ({
        ...game,
        relevanceScore: calculateRelevanceScore(game.name, trimmedTerm, game.rating, game.added)
      }))
    
    // Sort by relevance score first (most relevant first), then by rating, then popularity
    const sortedGames = gamesWithScores
      .sort((a, b) => {
        // Primary: relevance score (most relevant first)
        const relevanceDiff = b.relevanceScore - a.relevanceScore
        if (relevanceDiff !== 0) return relevanceDiff
        
        // Secondary: rating (higher is better)
        if (a.rating && b.rating) {
          const ratingDiff = b.rating - a.rating
          if (ratingDiff !== 0) return ratingDiff
        }
        
        // Tertiary: added count (popularity indicator)
        if (a.added && b.added) {
          return b.added - a.added
        }
        
        // Quaternary: release date (newer first)
        if (a.released && b.released) {
          return new Date(b.released) - new Date(a.released)
        }
        
        return 0
      })
      .slice(0, limit)
    
    // Remove relevanceScore before formatting
    const gamesToFormat = sortedGames.map(({ relevanceScore, ...game }) => game)
    
    console.log(`📊 Top ${Math.min(5, sortedGames.length)} results:`, 
      sortedGames.slice(0, 5).map(g => ({ 
        name: g.name, 
        score: g.relevanceScore.toFixed(1), 
        rating: g.rating 
      }))
    )
    
    return formatGames(gamesToFormat)
  } catch (error) {
    console.error('❌ Error in searchGames:', error)
    throw error
  }
}

// Calculate enhanced relevance score for a game title against search term
function calculateRelevanceScore(gameName, searchTerm, rating = null, addedCount = null) {
  if (!gameName || !searchTerm) return 0
  
  // Normalize strings: lowercase, trim, remove special punctuation
  const normalize = (str) => str.toLowerCase().trim().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ')
  
  const gameNormalized = normalize(gameName)
  const searchNormalized = normalize(searchTerm)
  const gameLower = gameName.toLowerCase().trim()
  const searchLower = searchTerm.toLowerCase().trim()
  const searchWords = searchNormalized.split(/\s+/).filter(w => w.length > 0)
  
  let score = 0
  
  // Exact match (case-insensitive, normalized) - highest priority
  if (gameNormalized === searchNormalized) {
    score += 10000
  }
  // Exact match (case-insensitive, original) - very high priority
  else if (gameLower === searchLower) {
    score += 5000
  }
  // Starts with search term (normalized) - very high priority
  else if (gameNormalized.startsWith(searchNormalized)) {
    score += 3000
  }
  // Starts with search term (original) - high priority
  else if (gameLower.startsWith(searchLower)) {
    score += 2000
  }
  // Contains exact phrase (normalized) - high priority
  else if (gameNormalized.includes(searchNormalized)) {
    score += 1500
  }
  // Contains exact phrase (original) - medium-high priority
  else if (gameLower.includes(searchLower)) {
    score += 1000
  }
  
  // Word boundary matches - all words in order - medium-high priority
  if (searchWords.length > 1) {
    const wordBoundaryRegex = new RegExp(
      `\\b${searchWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\b.*\\b')}\\b`, 
      'i'
    )
    if (wordBoundaryRegex.test(gameName)) {
      score += 800
    }
  }
  
  // Individual word matches - medium priority
  let wordMatches = 0
  let allWordsMatch = true
  searchWords.forEach(word => {
    if (gameLower.includes(word)) {
      wordMatches++
    } else {
      allWordsMatch = false
    }
  })
  
  if (allWordsMatch && searchWords.length > 1) {
    // Bonus if all words match
    score += 500
  } else if (wordMatches > 0) {
    score += 300 * (wordMatches / searchWords.length)
  }
  
  // Partial character sequence match - low priority
  const searchChars = searchLower.replace(/\s/g, '')
  let charMatches = 0
  let gameIndex = 0
  for (let i = 0; i < searchChars.length; i++) {
    const charIndex = gameLower.indexOf(searchChars[i], gameIndex)
    if (charIndex !== -1) {
      charMatches++
      gameIndex = charIndex + 1
    }
  }
  if (charMatches > 0) {
    score += 50 * (charMatches / searchChars.length)
  }
  
  // Boost score based on game quality (rating and popularity)
  // This helps popular, well-rated games rank higher when relevance is similar
  if (rating && rating > 0) {
    score += rating * 10 // Add up to 50 points for 5-star rating
  }
  if (addedCount && addedCount > 0) {
    // Logarithmic boost for popularity (diminishing returns)
    score += Math.log10(addedCount + 1) * 5
  }
  
  return score
}

// Get popular games - sorted by rating and popularity
export async function getPopularGames(limit = 50) {
  try {
    console.log(`📊 Fetching ${limit} popular games from RAWG...`)
    const data = await rawgRequest('/games', {
      ordering: '-rating,-added', // Sort by rating first, then popularity
      page_size: Math.min(limit, 40), // RAWG max is 40 per page
      dates: `${new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]},${new Date().toISOString().split('T')[0]}` // Last 10 years
    })
    
    const games = data.results || []
    console.log(`✅ Popular games: ${games.length} raw games found from API`)
    
    if (games.length === 0) {
      console.warn('⚠️ No games returned from RAWG API')
      return []
    }
    
    const formatted = formatGames(games)
    console.log(`✅ Formatted ${formatted.length} popular games`)
    return formatted
  } catch (error) {
    console.error('❌ Error in getPopularGames:', error)
    console.error('Error details:', error.message, error.stack)
    throw error
  }
}

// Get recently released games
export async function getRecentlyReleasedGames(limit = 30) {
  try {
    console.log(`📅 Fetching ${limit} recent games from RAWG...`)
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    const today = new Date()
    
    const data = await rawgRequest('/games', {
      dates: `${oneYearAgo.toISOString().split('T')[0]},${today.toISOString().split('T')[0]}`,
      ordering: '-released,-rating', // Sort by release date (newest first), then rating
      page_size: Math.min(limit, 40)
    })
    
    const games = data.results || []
    console.log(`✅ Recent games: ${games.length} raw games found from API`)
    
    if (games.length === 0) {
      console.warn('⚠️ No recent games returned from RAWG API')
      return []
    }
    
    const formatted = formatGames(games)
    console.log(`✅ Formatted ${formatted.length} recent games`)
    return formatted
  } catch (error) {
    console.error('❌ Error in getRecentlyReleasedGames:', error)
    console.error('Error details:', error.message)
    throw error
  }
}

// Get games by genre
export async function getGamesByGenre(genreName, limit = 30) {
  try {
    // First, get the genre ID from RAWG
    const genresData = await rawgRequest('/genres', {
      search: genreName,
      page_size: 20
    })
    
    const genres = genresData.results || []
    let genreId = null
    
    // Try to find exact match first
    const exactMatch = genres.find(g => g.name.toLowerCase() === genreName.toLowerCase())
    if (exactMatch) {
      genreId = exactMatch.id
    } else if (genres.length > 0) {
      // Use first result if no exact match
      genreId = genres[0].id
    }
    
    if (!genreId) {
      console.warn(`Genre "${genreName}" not found`)
      return []
    }
    
    // Get games in this genre
    const data = await rawgRequest('/games', {
      genres: genreId.toString(),
      ordering: '-rating,-added', // Sort by rating first, then popularity
      page_size: limit,
      dates: `${new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]},${new Date().toISOString().split('T')[0]}`
    })
    
    const games = data.results || []
    console.log(`✅ Genre games (${genreName}): ${games.length} games found`)
    return formatGames(games)
  } catch (error) {
    console.error(`Error fetching games for genre ${genreName}:`, error)
    return []
  }
}

// Get game by ID (RAWG uses slugs, but we'll support both)
export async function getGameById(gameId) {
  try {
    // RAWG uses slugs, but if we have a numeric ID, we need to search
    // For now, assume gameId could be either slug or numeric ID
    const data = await rawgRequest(`/games/${gameId}`)
    
    if (!data || !data.id) {
      throw new Error('Game not found')
    }
    
    return formatGameDetails(data)
  } catch (error) {
    console.error('Error in getGameById:', error)
    throw error
  }
}

// Get similar games based on genres
export async function getSimilarGames(gameGenres, excludeGameId, limit = 20) {
  if (!gameGenres || gameGenres.length === 0) {
    // Fallback: get popular games if no genres
    try {
      const popular = await getPopularGames(limit)
      return popular.filter(game => game.id !== excludeGameId).slice(0, limit)
    } catch (err) {
      console.error('Error fetching fallback popular games:', err)
      return []
    }
  }

  try {
    // Get genre IDs from RAWG
    const genreIds = []
    for (const genreName of gameGenres.slice(0, 3)) {
      try {
        const genresData = await rawgRequest('/genres', {
          search: genreName,
          page_size: 5
        })
        const genres = genresData.results || []
        const exactMatch = genres.find(g => g.name.toLowerCase() === genreName.toLowerCase())
        if (exactMatch) {
          genreIds.push(exactMatch.id)
        } else if (genres.length > 0) {
          genreIds.push(genres[0].id)
        }
      } catch (err) {
        console.warn(`Failed to get genre ID for "${genreName}":`, err)
      }
    }

    if (genreIds.length === 0) {
      // Fallback: get popular games
      const popular = await getPopularGames(limit)
      return popular.filter(game => game.id !== excludeGameId).slice(0, limit)
    }

    // Get games that share at least one genre
    const data = await rawgRequest('/games', {
      genres: genreIds.join(','),
      ordering: '-rating,-added',
      page_size: limit * 2, // Fetch more to filter
      dates: `${new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]},${new Date().toISOString().split('T')[0]}`
    })

    const games = data.results || []
    const formattedGames = formatGames(games)
      .filter(game => game.id !== excludeGameId)
      .slice(0, limit)
    
    return formattedGames.length > 0 ? formattedGames : []
  } catch (error) {
    console.error('Error fetching similar games:', error)
    // Fallback: get popular games
    try {
      const popular = await getPopularGames(limit)
      return popular.filter(game => game.id !== excludeGameId).slice(0, limit)
    } catch (fallbackErr) {
      console.error('Fallback also failed:', fallbackErr)
      return []
    }
  }
}

// Get similar games by style (tags, genres, etc.)
export async function getSimilarGamesByStyle(gameData, excludeGameId, limit = 20) {
  if (!gameData) {
    return []
  }

  try {
    console.log('🎨 Finding similar style games for:', gameData.title)
    
    // Use tag IDs directly if available (faster and more accurate)
    let tagIds = []
    
    if (gameData.tagIds && gameData.tagIds.length > 0) {
      // Use tag IDs directly from game data (most accurate)
      tagIds = gameData.tagIds.slice(0, 5)
    } else if (gameData.tags && gameData.tags.length > 0) {
      // Fallback: search for tags by name if IDs not available
      const styleCriteria = gameData.tags.slice(0, 5)
      for (const tagName of styleCriteria) {
        try {
          const tagsData = await rawgRequest('/tags', {
            search: tagName,
            page_size: 5
          })
          const tags = tagsData.results || []
          const exactMatch = tags.find(t => t.name.toLowerCase() === tagName.toLowerCase())
          if (exactMatch) {
            tagIds.push(exactMatch.id)
          } else if (tags.length > 0) {
            tagIds.push(tags[0].id)
          }
        } catch (err) {
          console.warn(`Failed to get tag ID for "${tagName}":`, err)
        }
      }
    }
    
    if (tagIds.length === 0) {
      // Fallback to genres if no tag data available
      if (gameData.genres && gameData.genres.length > 0) {
        return getSimilarGames(gameData.genres, excludeGameId, limit)
      }
      return []
    }

    // Get games with matching tags
    const data = await rawgRequest('/games', {
      tags: tagIds.join(','),
      ordering: '-rating,-added',
      page_size: limit * 3,
      dates: `${new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]},${new Date().toISOString().split('T')[0]}`
    })

    const games = data.results || []
    
    if (games.length === 0) {
      // Fallback to genre-based
      if (gameData.genres && gameData.genres.length > 0) {
        return getSimilarGames(gameData.genres, excludeGameId, limit)
      }
      return []
    }

    // Score games by how many tags they match
    const gamesWithScores = games.map(game => {
      let styleScore = 0
      let matchCount = 0
      
      if (game.tags) {
        const gameTagIds = game.tags.map(t => t.id || t)
        const matchingTags = tagIds.filter(id => gameTagIds.includes(id)).length
        if (matchingTags > 0) {
          styleScore += matchingTags * 5
          matchCount++
        }
      }
      
      return { ...game, styleScore, matchCount }
    })
    
    // Filter and sort by style score
    const qualityMatches = gamesWithScores
      .filter(game => game.styleScore >= 5 || game.matchCount >= 1)
      .sort((a, b) => {
        const styleDiff = b.styleScore - a.styleScore
        if (styleDiff !== 0) return styleDiff
        
        if (a.rating && b.rating) {
          return b.rating - a.rating
        }
        return 0
      })
      .slice(0, limit)
    
    // Remove styleScore and matchCount before formatting
    const gamesToFormat = qualityMatches.map(({ styleScore, matchCount, ...game }) => game)
    
    if (gamesToFormat.length === 0) {
      // Fallback to genre-based
      if (gameData.genres && gameData.genres.length > 0) {
        return getSimilarGames(gameData.genres, excludeGameId, limit)
      }
      return []
    }
    
    return formatGames(gamesToFormat)
  } catch (error) {
    console.error('❌ Error fetching similar games by style:', error)
    // Fallback to genre-based
    if (gameData.genres && gameData.genres.length > 0) {
      return getSimilarGames(gameData.genres, excludeGameId, limit)
    }
    return []
  }
}

// Format detailed game data
function formatGameDetails(game) {
  const releaseDate = game.released ? new Date(game.released) : null
  const year = releaseDate ? releaseDate.getFullYear() : null

  const genres = game.genres?.map((g) => g.name) || []
  const platforms = game.platforms?.map((p) => p.platform?.name || p.name) || []
  const tags = game.tags?.map((t) => t.name) || []
  const tagIds = game.tags?.map((t) => t.id) || [] // Preserve tag IDs for similarity matching

  const developers = game.developers?.map((d) => d.name) || []
  const publishers = game.publishers?.map((p) => p.name) || []

  const screenshots = game.short_screenshots?.map((s) => s.image) || 
                      game.screenshots?.map((s) => s.image) || []

  // RAWG rating is 0-5, keep as is
  const rating = game.rating ? game.rating.toFixed(1) : null

  return normalizeGame({
    id: game.id.toString(), // Convert to string for consistency
    slug: game.slug,
    title: game.name,
    description: game.description_raw || game.description || 'No description available.',
    developer: developers[0] || 'Unknown',
    developers: developers,
    publisher: publishers[0] || 'Unknown',
    publishers: publishers,
    genre: genres.join(', ') || 'Unknown',
    genres: genres,
    rating: rating,
    year: year,
    releaseDate: releaseDate,
    image: game.background_image || null,
    platforms: platforms,
    screenshots: screenshots,
    websites: game.website ? [game.website] : [],
    tags: tags,
    tagIds: tagIds, // Include tag IDs for better similarity matching
    // Map RAWG fields to expected fields
    themes: tags.slice(0, 5), // Use tags as themes
    playerPerspectives: [], // RAWG doesn't have this
    gameModes: [], // RAWG doesn't have this
    keywords: tags.slice(5, 10), // Use more tags as keywords
  }, 'rawg')
}

// Format games data for consistent structure
export function formatGames(games) {
  if (!games || !Array.isArray(games)) {
    console.warn('⚠️ formatGames received invalid input:', games)
    return []
  }
  
  const filtered = games.filter((game) => {
    const hasName = game && game.name
    const hasImage = game && game.background_image
    if (!hasName || !hasImage) {
      console.warn('⚠️ Filtering out game (missing name or image):', game?.name || game?.id)
    }
    return hasName && hasImage
  })
  
  console.log(`📝 Formatting ${filtered.length} games (filtered from ${games.length})`)
  
  const formatted = filtered.map((game) => {
      const releaseDate = game.released ? new Date(game.released) : null
      const year = releaseDate ? releaseDate.getFullYear() : null

      const genres = game.genres?.map((g) => g.name).join(', ') || 'Unknown'
      const developer = game.developers?.[0]?.name || 'Unknown'

      // RAWG rating is 0-5, keep as is
      const rating = game.rating ? game.rating.toFixed(1) : null

      return {
        id: game.id.toString(), // Convert to string for consistency
        slug: game.slug,
        title: game.name,
        developer: developer,
        genre: genres,
        rating: rating,
        year: year,
        image: game.background_image,
        imageHD: game.background_image ? getHDImageUrl(game.background_image, 1920) : null,
        description: game.description_raw || game.description || '',
        releaseDate: releaseDate,
      }
    })
    .sort((a, b) => {
      // Sort by rating first (higher rating first)
      if (a.rating && b.rating) {
        const ratingDiff = parseFloat(b.rating) - parseFloat(a.rating)
        if (ratingDiff !== 0) return ratingDiff
      }
      // Then by release date (newer first)
      if (a.releaseDate && b.releaseDate) {
        return b.releaseDate.getTime() - a.releaseDate.getTime()
      }
      if (a.releaseDate && !b.releaseDate) return -1
      if (!a.releaseDate && b.releaseDate) return 1
      return 0
    })
  
  console.log(`✅ Formatted ${formatted.length} games successfully`)
  if (formatted.length > 0) {
    console.log(`   Sample: ${formatted[0].title} (ID: ${formatted[0].id}, Image: ${formatted[0].image ? 'Yes' : 'No'})`)
  }

  // Normalize at the API boundary — attach gameId, rawIds, source, null-safe arrays
  return normalizeGames(formatted, 'rawg')
}

// Test API connection
export async function testAPIConnection() {
  try {
    console.log('Testing RAWG API connection...')
    const data = await rawgRequest('/games', {
      page_size: 1
    })
    console.log('✅ API test successful:', data ? 'Yes' : 'No')
    return true
  } catch (error) {
    console.error('❌ API test failed:', error)
    return false
  }
}


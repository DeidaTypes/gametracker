// IGDB API Service
// You'll need to get your Client ID and Client Secret from:
// https://dev.twitch.tv/console/apps
// Then get an access token from: https://id.twitch.tv/oauth2/token

import { normalizeGame, normalizeGames } from './normalizeGame'

const CLIENT_ID = import.meta.env.VITE_IGDB_CLIENT_ID || 'YOUR_CLIENT_ID'
const CLIENT_SECRET = import.meta.env.VITE_IGDB_CLIENT_SECRET || 'YOUR_CLIENT_SECRET'

// Debug: Log if credentials are loaded (without exposing secrets)
if (CLIENT_ID === 'YOUR_CLIENT_ID' || CLIENT_SECRET === 'YOUR_CLIENT_SECRET') {
  console.warn('⚠️ IGDB API credentials not found! Make sure you have a .env file with VITE_IGDB_CLIENT_ID and VITE_IGDB_CLIENT_SECRET')
} else {
  console.log('✅ IGDB API credentials loaded successfully')
}

let accessToken = null
let tokenExpiry = null

// Get access token from Twitch OAuth
async function getAccessToken() {
  // Check if we have a valid token
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken
  }

  // Check credentials first
  if (CLIENT_ID === 'YOUR_CLIENT_ID' || CLIENT_SECRET === 'YOUR_CLIENT_SECRET') {
    const errorMsg = 'IGDB API credentials not configured. Please create a .env file in the project root with:\nVITE_IGDB_CLIENT_ID=your_client_id\nVITE_IGDB_CLIENT_SECRET=your_client_secret'
    console.error('❌', errorMsg)
    throw new Error(errorMsg)
  }

  try {
    console.log('🔑 Requesting access token from Twitch...')
    // Use proxy to avoid CORS issues
    const response = await fetch('/api/twitch/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'client_credentials',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('❌ Twitch OAuth error:', response.status, errorText)
      
      if (response.status === 400) {
        throw new Error('Invalid API credentials. Please check your CLIENT_ID and CLIENT_SECRET in the .env file.')
      } else if (response.status === 401) {
        throw new Error('Unauthorized. Your API credentials may be incorrect. Please verify them at https://dev.twitch.tv/console/apps')
      } else {
        throw new Error(`Failed to get access token: ${response.status} - ${errorText}`)
      }
    }

    const data = await response.json()
    
    if (!data.access_token) {
      console.error('❌ No access token received:', data)
      throw new Error('Failed to get access token: Invalid response from Twitch')
    }
    
    accessToken = data.access_token
    // Set expiry to 90% of token lifetime to be safe (expires_in is in seconds)
    tokenExpiry = Date.now() + (data.expires_in * 1000 * 0.9)

    console.log('✅ Access token obtained successfully')
    return accessToken
  } catch (error) {
    console.error('❌ Error getting access token:', error)
    // Re-throw with more context if it's not already a formatted error
    if (error.message && !error.message.includes('IGDB API') && !error.message.includes('Invalid') && !error.message.includes('Unauthorized')) {
      throw new Error(`Failed to connect to Twitch API: ${error.message}. Check your internet connection and API credentials.`)
    }
    throw error
  }
}

// Make IGDB API request
async function igdbRequest(endpoint, query) {
  try {
    const token = await getAccessToken()
    
    console.log(`📡 Making IGDB API request to ${endpoint}...`)

    // Use proxy to avoid CORS issues
    const response = await fetch(`/api/igdb/v4/${endpoint}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Client-ID': CLIENT_ID,
        'Authorization': `Bearer ${token}`,
      },
      body: query,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`❌ IGDB API error ${response.status}:`, errorText)
      
      if (response.status === 401) {
        throw new Error('Unauthorized. Your access token may have expired or your API credentials are invalid.')
      } else if (response.status === 400) {
        throw new Error(`Invalid API request: ${errorText}`)
      } else {
        throw new Error(`IGDB API error: ${response.status} - ${errorText}`)
      }
    }

    const data = await response.json()
    console.log(`✅ Received ${data.length} results from ${endpoint}`)
    return data
  } catch (error) {
    console.error('❌ IGDB API request error:', error)
    // If it's already a formatted error, re-throw it
    if (error.message && (error.message.includes('Unauthorized') || error.message.includes('Invalid') || error.message.includes('Failed to connect'))) {
      throw error
    }
    // Otherwise wrap it
    throw new Error(`IGDB API request failed: ${error.message}`)
  }
}

// Get popular games - top rated games with high rating counts
export async function getPopularGames(limit = 50) {
  // Get games with high ratings and rating counts, released in recent years
  // Focus on games with both high ratings AND high rating counts (more popular)
  const fiveYearsAgo = Math.floor(Date.now() / 1000) - (5 * 31536000)
  
  // Prioritize games with both high rating_count (popularity) and high rating (quality)
  let query = `fields name, cover.url, genres.name, release_dates.date, rating, rating_count, summary, involved_companies.company.name, first_release_date;
where cover != null & rating != null & rating_count != null & first_release_date >= ${fiveYearsAgo} & rating_count > 10;
sort rating_count desc;
limit ${limit};`

  try {
    const games = await igdbRequest('games', query)
    
    // If we don't have enough results, relax the rating_count requirement
    if (games.length < limit) {
      const relaxedQuery = `fields name, cover.url, genres.name, release_dates.date, rating, rating_count, summary, involved_companies.company.name, first_release_date;
where cover != null & rating != null & first_release_date >= ${fiveYearsAgo};
sort rating_count desc;
limit ${limit};`
      const relaxedGames = await igdbRequest('games', relaxedQuery)
      return formatGames(relaxedGames)
    }
    
    return formatGames(games)
  } catch (error) {
    console.error('Error in getPopularGames:', error)
    // Fallback query - try with just rating requirement
    try {
      const fallbackQuery = `fields name, cover.url, genres.name, release_dates.date, rating, rating_count, summary, involved_companies.company.name, first_release_date;
where cover != null & rating != null & first_release_date >= ${fiveYearsAgo};
sort rating desc;
limit ${limit};`
      const games = await igdbRequest('games', fallbackQuery)
      return formatGames(games)
    } catch (fallbackError) {
      console.error('Fallback query also failed:', fallbackError)
      throw error
    }
  }
}

// Get recently released games - only from the last 12 months
export async function getRecentlyReleasedGames(limit = 30) {
  // Get games released in the last 12 months, sorted by popularity
  const oneYearAgo = Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60)
  const now = Math.floor(Date.now() / 1000)

  // More lenient query - filter rating_count after fetching
  let query = `fields name, cover.url, genres.name, release_dates.date, rating, rating_count, summary, involved_companies.company.name, first_release_date;
where first_release_date >= ${oneYearAgo} & first_release_date <= ${now} & cover != null & rating != null;
sort first_release_date desc;
limit ${limit};`

  try {
    let games = await igdbRequest('games', query)
    // Don't filter too aggressively - accept all games with ratings
    // Priority is to show results over strict filtering
    return formatGames(games)
  } catch (error) {
    console.error('Error in getRecentlyReleasedGames:', error)
    throw error
  }
}

// Get top games of the week - trending games with high rating counts from the last 7 days
export async function getTopGamesOfTheWeek(limit = 20) {
  // Get games from the last 2 weeks that have high rating activity
  const twoWeeksAgo = Math.floor(Date.now() / 1000) - (14 * 24 * 60 * 60)
  const now = Math.floor(Date.now() / 1000)
  
  // Query for games with recent activity and high ratings
  const query = `fields name, cover.url, genres.name, release_dates.date, rating, rating_count, summary, involved_companies.company.name, first_release_date;
where first_release_date >= ${twoWeeksAgo} & first_release_date <= ${now} & cover != null & rating != null & rating_count != null;
sort rating_count desc;
limit ${limit * 2};`

  try {
    let games = await igdbRequest('games', query)
    
    // If not enough recent games, get popular games from last 3 months
    if (games.length < limit) {
      const threeMonthsAgo = Math.floor(Date.now() / 1000) - (90 * 24 * 60 * 60)
      const fallbackQuery = `fields name, cover.url, genres.name, release_dates.date, rating, rating_count, summary, involved_companies.company.name, first_release_date;
where first_release_date >= ${threeMonthsAgo} & first_release_date <= ${now} & cover != null & rating != null;
sort rating_count desc;
limit ${limit * 2};`
      games = await igdbRequest('games', fallbackQuery)
    }
    
    return formatGames(games)
  } catch (error) {
    console.error('Error in getTopGamesOfTheWeek:', error)
    // Fallback to popular games
    return getPopularGames(limit)
  }
}

// Get games by genre - popular games in the genre
export async function getGamesByGenre(genreName, limit = 30) {
  try {
    // First get genre ID
    const genreQuery = `fields id;
where name = "${genreName}";`
    const genres = await igdbRequest('genres', genreQuery)
    
    if (genres.length === 0) {
      console.warn(`Genre "${genreName}" not found`)
      return []
    }

    const genreId = genres[0].id
    // Get popular games in this genre - sorted by rating_count first (most popular), then rating
    // Increased timeframe to get more games, more lenient filters
    const sevenYearsAgo = Math.floor(Date.now() / 1000) - (7 * 31536000)
    
    // More lenient query - filter rating_count after fetching
    let query = `fields name, cover.url, genres.name, release_dates.date, rating, rating_count, summary, involved_companies.company.name, first_release_date;
where genres = ${genreId} & cover != null & rating != null & first_release_date >= ${sevenYearsAgo};
sort rating_count desc;
limit ${limit};`

    let games = await igdbRequest('games', query)
    // Don't filter too aggressively - accept all games with ratings
    // Priority is to show results over strict filtering
    return formatGames(games)
  } catch (error) {
    console.error(`Error fetching games for genre ${genreName}:`, error)
    return []
  }
}


// Filter out DLC, expansions, and special editions - keep only base games
function filterOutDLC(games) {
  if (!games || games.length === 0) {
    return []
  }
  
  // Patterns that indicate DLC, expansions, or special editions
  const dlcPatterns = [
    // ANY edition with a name before "Edition" (but keep "Remastered" and "Remake")
    /:\s*\w+\s+edition(?!.*remaster|.*remake)/i,  // ": Something Edition" (but not Remastered)
    /\s+edition$/i,  // "Name Edition" at end of title
    
    // DLC and expansions
    /:\s*(dlc|expansion|season pass|battle pass|content pack)/i,
    /\s+(dlc|expansion|season pass|battle pass|content pack|expansion pass)/i,
    
    // Specific DLC indicators - anything after colon that looks like subtitle DLC
    /:\s*(the\s+)?(echoes|rising|awakening|prophecy|legacy|shadow|wrath|age|dawn|dusk|fall|coming|fate|curse|valhalla)\s+(of|the)/i,
    /:\s*\w+\s+(tide|fallen|rising|darkness|light|storm)/i,
    /:\s*valhalla/i,  // God of War: Valhalla
    
    // Packs and bundles
    /\s+(pack|bundle|add-on|addon|cosmetic|skin|outfit)(?!\s+rat)/i, // "pack" but not "pack rat" game
    
    // Episode/Chapter DLC
    /:\s*episode\s+\d+/i,
    /:\s*chapter\s+\d+/i,
    
    // Specific edition markers at end of title
    /\s+-\s+.+\s+edition$/i,  // " - Something Edition" at end
    
    // Launch/Pre-order/Digital editions
    /:\s*(launch|pre-order|day one|digital|standard|physical)\s+edition/i,
  ]
  
  return games.filter(game => {
    const title = game.name || game.title || ''
    
    // Check if title matches any DLC pattern
    for (const pattern of dlcPatterns) {
      if (pattern.test(title)) {
        return false // Exclude this game
      }
    }
    
    return true // Keep this game
  })
}

// Search games — returns IGDB's natural relevance order.
// Ranking / re-ordering is handled entirely by searchService.rankGames().
export async function searchGames(searchTerm, limit = 30) {
  if (!searchTerm || !searchTerm.trim()) {
    return []
  }

  const escapedTerm = searchTerm.trim()
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')

  // Fetch extra results so cover- and DLC-filtering still leave enough candidates
  // for rankGames() to work with. Cap at 200 to stay within IGDB limits.
  const fetchLimit = Math.min(limit * 4, 200)
  const query = `fields name, cover.url, genres.name, release_dates.date, rating, rating_count, summary, involved_companies.company.name, first_release_date;
search "${escapedTerm}";
limit ${fetchLimit};`

  try {
    console.log('🔍 Searching for:', searchTerm)
    const games = await igdbRequest('games', query)

    // Require cover art — entries without covers are usually stub/incomplete records
    const gamesWithCovers = games.filter(game => game.cover && game.cover.url)
    console.log(`✅ Search: ${gamesWithCovers.length} with covers (${games.length} total)`)

    // Remove clear DLC / expansion / edition entries (conservative filter)
    const baseGames = filterOutDLC(gamesWithCovers)
    console.log(`🎮 Base games: ${baseGames.length} (filtered ${gamesWithCovers.length - baseGames.length} DLC/editions)`)

    // Format without sorting — rankGames() in searchService will handle ordering
    return formatGamesRaw(baseGames.slice(0, limit * 2))
  } catch (error) {
    console.error('❌ Error in searchGames:', error)
    throw error
  }
}

// Get similar games by style (themes, player perspectives, game modes, keywords)
export async function getSimilarGamesByStyle(gameData, excludeGameId, limit = 20) {
  if (!gameData) {
    return []
  }

  try {
    console.log('🎨 Finding similar style games for:', gameData.title)
    console.log('📊 Game style data:', {
      themes: gameData.themes,
      playerPerspectives: gameData.playerPerspectives,
      gameModes: gameData.gameModes,
      keywords: gameData.keywords,
      genres: gameData.genres
    })
    
    const styleCriteria = []
    
    // Get theme IDs - use more themes for better matching
    if (gameData.themes && gameData.themes.length > 0) {
      for (const themeName of gameData.themes.slice(0, 5)) {
        try {
          const themeQuery = `fields id;
where name = "${themeName}";`
          const themes = await igdbRequest('themes', themeQuery)
          if (themes.length > 0) {
            styleCriteria.push({ type: 'theme', id: themes[0].id, name: themeName })
          }
        } catch (err) {
          console.warn(`Failed to get theme ID for "${themeName}":`, err)
        }
      }
    }
    
    // Get player perspective IDs
    if (gameData.playerPerspectives && gameData.playerPerspectives.length > 0) {
      for (const ppName of gameData.playerPerspectives.slice(0, 3)) {
        try {
          const ppQuery = `fields id;
where name = "${ppName}";`
          const perspectives = await igdbRequest('player_perspectives', ppQuery)
          if (perspectives.length > 0) {
            styleCriteria.push({ type: 'perspective', id: perspectives[0].id, name: ppName })
          }
        } catch (err) {
          console.warn(`Failed to get perspective ID for "${ppName}":`, err)
        }
      }
    }
    
    // Get game mode IDs
    if (gameData.gameModes && gameData.gameModes.length > 0) {
      for (const gmName of gameData.gameModes.slice(0, 3)) {
        try {
          const gmQuery = `fields id;
where name = "${gmName}";`
          const modes = await igdbRequest('game_modes', gmQuery)
          if (modes.length > 0) {
            styleCriteria.push({ type: 'mode', id: modes[0].id, name: gmName })
          }
        } catch (err) {
          console.warn(`Failed to get mode ID for "${gmName}":`, err)
        }
      }
    }
    
    // Get keyword IDs - keywords are very specific to gameplay style
    if (gameData.keywords && gameData.keywords.length > 0) {
      for (const keywordName of gameData.keywords.slice(0, 5)) {
        try {
          const keywordQuery = `fields id;
where name = "${keywordName}";`
          const keywords = await igdbRequest('keywords', keywordQuery)
          if (keywords.length > 0) {
            styleCriteria.push({ type: 'keyword', id: keywords[0].id, name: keywordName })
          }
        } catch (err) {
          console.warn(`Failed to get keyword ID for "${keywordName}":`, err)
        }
      }
    }

    console.log('✅ Style criteria found:', styleCriteria.length, styleCriteria.map(c => `${c.type}:${c.name}`))

    if (styleCriteria.length === 0) {
      // Fallback to genres if no style data available
      console.log('⚠️ No style criteria found, falling back to genre-based similarity')
      if (gameData.genres && gameData.genres.length > 0) {
        return getSimilarGames(gameData.genres, excludeGameId, limit)
      }
      return []
    }

    // Build query with style criteria - prioritize games that match multiple style elements
    const sevenYearsAgo = Math.floor(Date.now() / 1000) - (7 * 31536000)
    
    // Get IDs by type
    const themeIds = styleCriteria.filter(c => c.type === 'theme').map(c => c.id)
    const perspectiveIds = styleCriteria.filter(c => c.type === 'perspective').map(c => c.id)
    const modeIds = styleCriteria.filter(c => c.type === 'mode').map(c => c.id)
    const keywordIds = styleCriteria.filter(c => c.type === 'keyword').map(c => c.id)
    
    // Build where clause - require games to match multiple style elements for better accuracy
    // Use AND logic within each category, OR between categories, but prioritize multi-match
    const whereConditions = []
    if (themeIds.length > 0) {
      whereConditions.push(`themes = [${themeIds.join(',')}]`)
    }
    if (perspectiveIds.length > 0) {
      whereConditions.push(`player_perspectives = [${perspectiveIds.join(',')}]`)
    }
    if (modeIds.length > 0) {
      whereConditions.push(`game_modes = [${modeIds.join(',')}]`)
    }
    if (keywordIds.length > 0) {
      whereConditions.push(`keywords = [${keywordIds.join(',')}]`)
    }
    
    if (whereConditions.length === 0) {
      return []
    }
    
    // Use OR logic to find games matching any style criteria, then filter by match count
    const whereClause = whereConditions.join(' | ')
    
    // Fetch more games to filter by style match quality
    const query = `fields name, cover.url, genres.name, release_dates.date, rating, rating_count, summary, involved_companies.company.name, first_release_date, themes.id, themes.name, player_perspectives.id, player_perspectives.name, game_modes.id, game_modes.name, keywords.id, keywords.name;
where (${whereClause}) & cover != null & id != ${excludeGameId};
limit ${limit * 5};` // Fetch many more to filter by quality

    const games = await igdbRequest('games', query)
    
    console.log(`📦 Found ${games.length} potential style matches`)
    
    if (games.length === 0) {
      console.log('⚠️ No style-based games found')
      return []
    }
    
    // Score games by how many style elements they match - require multiple matches
    const gamesWithStyleScores = games.map(game => {
      let styleScore = 0
      let matchCount = 0 // Count how many different style categories match
      
      // Check theme matches
      if (themeIds.length > 0 && game.themes) {
        const gameThemeIds = game.themes.map(t => {
          if (typeof t === 'object' && t.id) return t.id
          if (typeof t === 'number') return t
          return null
        }).filter(Boolean)
        const matchingThemes = themeIds.filter(id => gameThemeIds.includes(id)).length
        if (matchingThemes > 0) {
          styleScore += matchingThemes * 5 // Themes weighted much higher
          matchCount++
        }
      }
      
      // Check perspective matches
      if (perspectiveIds.length > 0 && game.player_perspectives) {
        const gamePPIds = game.player_perspectives.map(pp => {
          if (typeof pp === 'object' && pp.id) return pp.id
          if (typeof pp === 'number') return pp
          return null
        }).filter(Boolean)
        const matchingPP = perspectiveIds.filter(id => gamePPIds.includes(id)).length
        if (matchingPP > 0) {
          styleScore += matchingPP * 4 // Perspectives weighted high
          matchCount++
        }
      }
      
      // Check mode matches
      if (modeIds.length > 0 && game.game_modes) {
        const gameModeIds = game.game_modes.map(gm => {
          if (typeof gm === 'object' && gm.id) return gm.id
          if (typeof gm === 'number') return gm
          return null
        }).filter(Boolean)
        const matchingModes = modeIds.filter(id => gameModeIds.includes(id)).length
        if (matchingModes > 0) {
          styleScore += matchingModes * 3
          matchCount++
        }
      }
      
      // Check keyword matches - keywords are very specific to gameplay style
      if (keywordIds.length > 0 && game.keywords) {
        const gameKeywordIds = game.keywords.map(k => {
          if (typeof k === 'object' && k.id) return k.id
          if (typeof k === 'number') return k
          return null
        }).filter(Boolean)
        const matchingKeywords = keywordIds.filter(id => gameKeywordIds.includes(id)).length
        if (matchingKeywords > 0) {
          styleScore += matchingKeywords * 6 // Keywords weighted highest - most specific to style
          matchCount++
        }
      }
      
      // Bonus for matching multiple categories
      if (matchCount >= 2) {
        styleScore += 10 // Bonus for multi-category matches
      }
      if (matchCount >= 3) {
        styleScore += 20 // Bigger bonus for triple matches
      }
      
      return { ...game, styleScore, matchCount }
    })
    
    // Filter out games with very low style scores (require at least 2 matches or high keyword match)
    const qualityMatches = gamesWithStyleScores.filter(game => {
      return game.styleScore >= 5 || game.matchCount >= 2
    })
    
    console.log(`🎯 Quality matches: ${qualityMatches.length} games with style score >= 5 or 2+ category matches`)
    
    // Sort by style score first (highest first), then by match count, then rating
    const sortedGames = qualityMatches
      .sort((a, b) => {
        // First sort by style score
        const styleDiff = b.styleScore - a.styleScore
        if (styleDiff !== 0) return styleDiff
        
        // Then by match count (more categories matched = better)
        const matchDiff = b.matchCount - a.matchCount
        if (matchDiff !== 0) return matchDiff
        
        // Then by rating
        if (a.rating && b.rating) {
          return b.rating - a.rating
        }
        if (a.rating_count && b.rating_count) {
          return b.rating_count - a.rating_count
        }
        return 0
      })
      .slice(0, limit)
    
    console.log(`✨ Top style matches:`, sortedGames.slice(0, 5).map(g => ({ 
      name: g.name, 
      styleScore: g.styleScore, 
      matchCount: g.matchCount 
    })))
    
    // Remove styleScore and matchCount before formatting
    const gamesToFormat = sortedGames.map(({ styleScore, matchCount, ...game }) => game)
    
    if (gamesToFormat.length === 0) {
      console.log('⚠️ No quality style matches found after filtering')
      // Don't fallback to generic games - return empty rather than showing irrelevant games
      return []
    }
    
    return formatGames(gamesToFormat)
  } catch (error) {
    console.error('❌ Error fetching similar games by style:', error)
    return []
  }
}

// Get similar games based on genres (excluding the current game)
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
    // Get genre IDs for all genres
    const genreIds = []
    for (const genreName of gameGenres.slice(0, 3)) { // Use up to 3 genres
      try {
        const genreQuery = `fields id;
where name = "${genreName}";`
        const genres = await igdbRequest('genres', genreQuery)
        if (genres.length > 0) {
          genreIds.push(genres[0].id)
        }
      } catch (err) {
        console.warn(`Failed to get genre ID for "${genreName}":`, err)
      }
    }

    if (genreIds.length === 0) {
      // Fallback: get popular games
      console.log('No genre IDs found, falling back to popular games')
      const popular = await getPopularGames(limit)
      return popular.filter(game => game.id !== excludeGameId).slice(0, limit)
    }

    // Get games that share at least one genre, excluding the current game
    // More lenient - don't require first_release_date filter
    const tenYearsAgo = Math.floor(Date.now() / 1000) - (10 * 31536000)
    
    // IGDB uses array syntax for multiple values: genres = [id1, id2]
    const query = `fields name, cover.url, genres.name, release_dates.date, rating, rating_count, summary, involved_companies.company.name, first_release_date;
where genres = [${genreIds.join(',')}] & cover != null & id != ${excludeGameId};
sort rating desc;
limit ${limit * 3};` // Fetch more to ensure we have enough after filtering

    const games = await igdbRequest('games', query)
    
    if (games.length === 0) {
      // Fallback: get popular games
      console.log('No games found with genres, falling back to popular games')
      const popular = await getPopularGames(limit)
      return popular.filter(game => game.id !== excludeGameId).slice(0, limit)
    }
    
    // Format and sort by rating (highest to lowest)
    const formattedGames = formatGames(games)
      .filter(game => game.id !== excludeGameId) // Double-check exclusion
      .slice(0, limit) // Limit results
    
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

// Get game by ID with full details
export async function getGameById(gameId) {
  const query = `fields name, cover.url, genres.name, release_dates.date, rating, summary, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, platforms.name, screenshots.url, first_release_date, websites.url, videos.video_id, themes.name, player_perspectives.name, game_modes.name, keywords.name;
where id = ${gameId};`

  try {
    const games = await igdbRequest('games', query)
    if (games.length === 0) {
      throw new Error('Game not found')
    }
    return formatGameDetails(games[0])
  } catch (error) {
    console.error('Error in getGameById:', error)
    throw error
  }
}

// Format detailed game data
function formatGameDetails(game) {
  let coverUrl = null
  if (game.cover?.url) {
    coverUrl = `https:${game.cover.url.replace('t_thumb', 't_cover_big')}`
  }

  const releaseDate = game.first_release_date
    ? new Date(game.first_release_date * 1000)
    : null
  const year = releaseDate ? releaseDate.getFullYear() : null

  const genres = game.genres?.map((g) => g.name) || []
  const platforms = game.platforms?.map((p) => p.name) || []
  const themes = game.themes?.map((t) => t.name) || []
  const playerPerspectives = game.player_perspectives?.map((pp) => pp.name) || []
  const gameModes = game.game_modes?.map((gm) => gm.name) || []
  const keywords = game.keywords?.map((k) => k.name) || []

  // Get developers and publishers
  const developers = game.involved_companies
    ?.filter((ic) => ic.developer)
    .map((ic) => ic.company?.name)
    .filter(Boolean) || []
  
  const publishers = game.involved_companies
    ?.filter((ic) => ic.publisher)
    .map((ic) => ic.company?.name)
    .filter(Boolean) || []

  const screenshots = game.screenshots?.map((s) => 
    `https:${s.url.replace('t_thumb', 't_screenshot_big')}`
  ) || []

  const rating = game.rating ? (game.rating / 20).toFixed(1) : null

  return normalizeGame({
    id: game.id,
    title: game.name,
    description: game.summary || 'No description available.',
    developer: developers[0] || 'Unknown',
    developers: developers,
    publisher: publishers[0] || 'Unknown',
    publishers: publishers,
    genre: genres.join(', ') || 'Unknown',
    genres: genres,
    rating: rating,
    year: year,
    releaseDate: releaseDate,
    image: coverUrl,
    platforms: platforms,
    screenshots: screenshots,
    websites: game.websites?.map((w) => w.url) || [],
    themes: themes,
    playerPerspectives: playerPerspectives,
    gameModes: gameModes,
    keywords: keywords,
  }, 'igdb')
}

// Test API connection
export async function testAPIConnection() {
  try {
    console.log('Testing IGDB API connection...')
    const token = await getAccessToken()
    console.log('✅ Access token obtained:', token ? 'Yes' : 'No')
    
    // Try a simple query
    const testQuery = `fields name;
limit 1;`
    const result = await igdbRequest('games', testQuery)
    console.log('✅ API test successful:', result)
    return true
  } catch (error) {
    console.error('❌ API test failed:', error)
    return false
  }
}

// Format games without any sorting — preserves the caller-provided order.
// Used by searchGames() so that rankGames() in searchService has full control.
function formatGamesRaw(games) {
  return normalizeGames(
    games
      .filter(game => game.name)
      .map(game => {
        let coverUrl = null
        if (game.cover?.url) {
          coverUrl = `https:${game.cover.url.replace('t_thumb', 't_cover_big')}`
        }

        let releaseDate = null
        let year = null
        if (game.first_release_date) {
          releaseDate = new Date(game.first_release_date * 1000)
          year = releaseDate.getFullYear()
        } else if (game.release_dates?.[0]?.date) {
          releaseDate = new Date(game.release_dates[0].date * 1000)
          year = releaseDate.getFullYear()
        }

        const genres = game.genres?.map(g => g.name).join(', ') || 'Unknown'
        const developer = game.involved_companies?.[0]?.company?.name || 'Unknown'
        const rating = game.rating ? (game.rating / 20).toFixed(1) : null

        return {
          id: game.id,
          title: game.name,
          developer,
          genre: genres,
          rating,
          year,
          image: coverUrl,
          description: game.summary || '',
          releaseDate,
        }
      }),
    'igdb'
  )
}

// Format games data for consistent structure
function formatGames(games) {
  const sorted = games
    .filter((game) => game.name) // Filter out games without names
    .map((game) => {
      let coverUrl = null
      if (game.cover?.url) {
        // IGDB cover URLs need https: prefix and we want cover_big size
        coverUrl = `https:${game.cover.url.replace('t_thumb', 't_cover_big')}`
      }

      // Try to get release date from first_release_date first, then release_dates
      let releaseDate = null
      let year = null
      
      if (game.first_release_date) {
        releaseDate = new Date(game.first_release_date * 1000)
        year = releaseDate.getFullYear()
      } else if (game.release_dates?.[0]?.date) {
        releaseDate = new Date(game.release_dates[0].date * 1000)
        year = releaseDate.getFullYear()
      }

      const genres = game.genres?.map((g) => g.name).join(', ') || 'Unknown'
      const developer = game.involved_companies?.[0]?.company?.name || 'Unknown'

      // IGDB rating is 0-100, convert to 0-5 scale
      const rating = game.rating ? (game.rating / 20).toFixed(1) : null

      return {
        id: game.id,
        title: game.name,
        developer: developer,
        genre: genres,
        rating: rating,
        year: year,
        image: coverUrl,
        description: game.summary || '',
        releaseDate: releaseDate, // Store full date for sorting
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

  // Normalize at the API boundary — attach gameId, rawIds, source, null-safe arrays
  return normalizeGames(sorted, 'igdb')
}


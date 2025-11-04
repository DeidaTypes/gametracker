// IGDB API Service
// You'll need to get your Client ID and Client Secret from:
// https://dev.twitch.tv/console/apps
// Then get an access token from: https://id.twitch.tv/oauth2/token

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

  try {
    console.log('Requesting access token from Twitch...')
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
      console.error('Twitch OAuth error:', response.status, errorText)
      throw new Error(`Failed to get access token: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    
    if (!data.access_token) {
      console.error('No access token received:', data)
      throw new Error('Failed to get access token: Invalid response from Twitch')
    }
    
    accessToken = data.access_token
    // Set expiry to 90% of token lifetime to be safe (expires_in is in seconds)
    tokenExpiry = Date.now() + (data.expires_in * 1000 * 0.9)

    return accessToken
  } catch (error) {
    console.error('Error getting access token:', error)
    if (CLIENT_ID === 'YOUR_CLIENT_ID' || CLIENT_SECRET === 'YOUR_CLIENT_SECRET') {
      throw new Error('IGDB API credentials not configured. Please check your .env file.')
    }
    throw error
  }
}

// Make IGDB API request
async function igdbRequest(endpoint, query) {
  try {
    const token = await getAccessToken()
    
    console.log(`Making IGDB API request to ${endpoint}...`)

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
      console.error(`IGDB API error ${response.status}:`, errorText)
      throw new Error(`IGDB API error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    console.log(`✅ Received ${data.length} results from ${endpoint}`)
    return data
  } catch (error) {
    console.error('IGDB API request error:', error)
    throw error
  }
}

// Get popular games - top rated games with high rating counts
export async function getPopularGames(limit = 20) {
  // Get games with high ratings and rating counts, released in recent years
  const threeYearsAgo = Math.floor(Date.now() / 1000) - (3 * 31536000)
  
  const query = `fields name, cover.url, genres.name, release_dates.date, rating, rating_count, summary, involved_companies.company.name;
where cover != null & rating != null & rating_count >= 10 & first_release_date >= ${threeYearsAgo};
sort rating desc;
limit ${limit};`

  try {
    const games = await igdbRequest('games', query)
    return formatGames(games)
  } catch (error) {
    console.error('Error in getPopularGames:', error)
    throw error
  }
}

// Get recently released games - only from the last 12 months
export async function getRecentlyReleasedGames(limit = 20) {
  // Get games released in the last 12 months
  const oneYearAgo = Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60)
  const now = Math.floor(Date.now() / 1000)

  const query = `fields name, cover.url, genres.name, release_dates.date, rating, summary, involved_companies.company.name, first_release_date;
where first_release_date >= ${oneYearAgo} & first_release_date <= ${now} & cover != null & rating != null;
sort first_release_date desc;
limit ${limit};`

  try {
    const games = await igdbRequest('games', query)
    return formatGames(games)
  } catch (error) {
    console.error('Error in getRecentlyReleasedGames:', error)
    throw error
  }
}

// Get games by genre - popular games in the genre
export async function getGamesByGenre(genreName, limit = 20) {
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
    // Get popular games in this genre - high ratings with minimum rating count
    // Focus on games from the last 5 years for relevance
    const fiveYearsAgo = Math.floor(Date.now() / 1000) - (5 * 31536000)
    
    const query = `fields name, cover.url, genres.name, release_dates.date, rating, rating_count, summary, involved_companies.company.name, first_release_date;
where genres = ${genreId} & cover != null & rating != null & rating_count >= 5 & first_release_date >= ${fiveYearsAgo};
sort rating desc;
limit ${limit};`

    const games = await igdbRequest('games', query)
    return formatGames(games)
  } catch (error) {
    console.error(`Error fetching games for genre ${genreName}:`, error)
    return []
  }
}

// Search games
export async function searchGames(searchTerm, limit = 20) {
  const query = `fields name, cover.url, genres.name, release_dates.date, rating, summary, involved_companies.company.name;
search "${searchTerm}";
where cover != null;
limit ${limit};`

  try {
    const games = await igdbRequest('games', query)
    return formatGames(games)
  } catch (error) {
    console.error('Error in searchGames:', error)
    throw error
  }
}

// Get game by ID with full details
export async function getGameById(gameId) {
  const query = `fields name, cover.url, genres.name, release_dates.date, rating, summary, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, platforms.name, screenshots.url, first_release_date, websites.url, videos.video_id;
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

  return {
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
  }
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

// Format games data for consistent structure
function formatGames(games) {
  return games
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
}


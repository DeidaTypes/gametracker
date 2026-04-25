// Game Mapper Service - Maps RAWG games to IGDB for better art and info
// Uses RAWG for popularity/trending, IGDB for art/info

import { searchGames as igdbSearchGames } from './igdb'

// Cache for IGDB mapping results
const mappingCache = new Map()
const CACHE_DURATION = 10 * 60 * 1000 // 10 minutes

function getCachedMapping(gameTitle) {
  const cached = mappingCache.get(gameTitle.toLowerCase())
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data
  }
  return null
}

function setCachedMapping(gameTitle, data) {
  mappingCache.set(gameTitle.toLowerCase(), {
    data,
    timestamp: Date.now()
  })
}

// Normalize title for matching
function normalizeTitle(title) {
  if (!title) return ''
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ') // Replace special chars with space
    .replace(/\s+/g, ' ') // Normalize multiple spaces
    .trim()
}

// Map a single RAWG game to IGDB game
export async function mapRawgToIgdb(rawgGame) {
  if (!rawgGame || !rawgGame.title) {
    return rawgGame // Return as-is if invalid
  }

  // Check cache first
  const cached = getCachedMapping(rawgGame.title)
  if (cached) {
    return cached
  }

  try {
    // Search IGDB for this exact game title
    const igdbResults = await igdbSearchGames(rawgGame.title, 5)
    
    if (igdbResults && igdbResults.length > 0) {
      // Find best match by normalized title
      const rawgNorm = normalizeTitle(rawgGame.title)
      
      const exactMatch = igdbResults.find(g => 
        normalizeTitle(g.title) === rawgNorm
      )
      
      if (exactMatch) {
        setCachedMapping(rawgGame.title, exactMatch)
        return exactMatch
      }
      
      // Use first result if no exact match (likely the same game)
      setCachedMapping(rawgGame.title, igdbResults[0])
      return igdbResults[0]
    }
  } catch (err) {
    // Silently fallback to RAWG if IGDB fails
    console.warn(`⚠️ IGDB mapping failed for "${rawgGame.title}":`, err.message)
  }
  
  // Fallback to RAWG data if IGDB doesn't have it or fails
  return rawgGame
}

// Check if IGDB is configured
function isIgdbConfigured() {
  const clientId = import.meta.env.VITE_IGDB_CLIENT_ID || ''
  const clientSecret = import.meta.env.VITE_IGDB_CLIENT_SECRET || ''
  return clientId && clientId !== 'YOUR_CLIENT_ID' && clientSecret && clientSecret !== 'YOUR_CLIENT_SECRET'
}

// Map multiple RAWG games to IGDB games (with timeout and fallback)
export async function mapRawgGamesToIgdb(rawgGames) {
  if (!rawgGames || rawgGames.length === 0) {
    return []
  }

  // Quick check: if IGDB isn't configured, skip mapping entirely
  if (!isIgdbConfigured()) {
    console.log('ℹ️ IGDB not configured, using RAWG games directly')
    return rawgGames
  }

  console.log(`🔄 Mapping ${rawgGames.length} RAWG games to IGDB...`)
  
  // Quick test to see if IGDB is actually working
  try {
    await Promise.race([
      igdbSearchGames('test', 1),
      new Promise((_, reject) => setTimeout(() => reject(new Error('IGDB timeout')), 1500))
    ])
  } catch (err) {
    console.warn('⚠️ IGDB not available, using RAWG games directly:', err.message)
    return rawgGames
  }
  
  // Process games with timeout protection - limit to first 20 for speed
  const gamesToMap = rawgGames.slice(0, 20) // Only map first 20 to avoid long waits
  const maxMappingTime = 8000 // 8 seconds max for mapping
  
  const mappingPromise = Promise.all(
    gamesToMap.map(async (rawgGame, index) => {
      try {
        const mapped = await mapRawgToIgdb(rawgGame)
        // Small delay to avoid rate limiting (only for first few)
        if (index < 3) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        return mapped
      } catch (err) {
        return rawgGame // Fallback to RAWG
      }
    })
  )
  
  try {
    const results = await Promise.race([
      mappingPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Mapping timeout')), maxMappingTime)
      )
    ])
    
    // Combine mapped games with remaining RAWG games
    const remainingRawgGames = rawgGames.slice(20)
    const allResults = [...results, ...remainingRawgGames]
    
    console.log(`✅ Mapped ${results.length} games to IGDB (${remainingRawgGames.length} using RAWG)`)
    return allResults
  } catch (err) {
    console.warn('⚠️ Mapping timed out or failed, using RAWG games:', err.message)
    return rawgGames // Fallback to RAWG games
  }
}


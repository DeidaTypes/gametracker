// Game Mapper Service - Maps game data to IGDB for art and info

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

// Map a single game to its IGDB equivalent
export async function mapRawgToIgdb(rawgGame) {
  if (!rawgGame || !rawgGame.title) {
    return rawgGame
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
    console.warn(`⚠️ IGDB mapping failed for "${rawgGame.title}":`, err.message)
  }
  
  return rawgGame
}

// Check if IGDB is configured
function isIgdbConfigured() {
  const clientId = import.meta.env.VITE_IGDB_CLIENT_ID || ''
  const clientSecret = import.meta.env.VITE_IGDB_CLIENT_SECRET || ''
  return clientId && clientId !== 'YOUR_CLIENT_ID' && clientSecret && clientSecret !== 'YOUR_CLIENT_SECRET'
}

// Map multiple games to IGDB (with timeout and fallback)
export async function mapRawgGamesToIgdb(rawgGames) {
  if (!rawgGames || rawgGames.length === 0) {
    return []
  }

  if (!isIgdbConfigured()) {
    console.log('ℹ️ IGDB not configured, returning games as-is')
    return rawgGames
  }

  console.log(`🔄 Mapping ${rawgGames.length} games to IGDB...`)
  
  // Quick test to see if IGDB is actually working
  try {
    await Promise.race([
      igdbSearchGames('test', 1),
      new Promise((_, reject) => setTimeout(() => reject(new Error('IGDB timeout')), 1500))
    ])
  } catch (err) {
    console.warn('⚠️ IGDB not available, returning games as-is:', err.message)
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
        return rawgGame
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
    
    const remainingRawgGames = rawgGames.slice(20)
    const allResults = [...results, ...remainingRawgGames]
    
    console.log(`✅ Mapped ${results.length} games to IGDB (${remainingRawgGames.length} unmapped)`)
    return allResults
  } catch (err) {
    console.warn('⚠️ Mapping timed out or failed, returning games as-is:', err.message)
    return rawgGames
  }
}


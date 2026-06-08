// User Preferences Service - stores user interests, genres, and search history

const PREFERENCES_KEY = 'userPreferences'
const SEARCH_HISTORY_KEY = 'userSearchHistory'
const VIEWED_GAMES_KEY = 'viewedGames'

// Initialize user preferences
export function initializePreferences() {
  const existing = getPreferences()
  if (!existing || !existing.onboarded) {
    return {
      onboarded: false,
      favoriteGenres: [],
      interests: [],
      favoriteGames: [],
      searchHistory: [],
      viewedGames: [],
    }
  }
  return existing
}

// Get user preferences
export function getPreferences() {
  const stored = localStorage.getItem(PREFERENCES_KEY)
  if (stored) {
    return JSON.parse(stored)
  }
  return null
}

// Save user preferences
export function savePreferences(preferences) {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences))
}

// Update onboarding status
export function setOnboarded(onboarded = true) {
  const prefs = getPreferences() || initializePreferences()
  prefs.onboarded = onboarded
  savePreferences(prefs)
}

// Add favorite genres
export function addFavoriteGenres(genres) {
  const prefs = getPreferences() || initializePreferences()
  prefs.favoriteGenres = [...new Set([...prefs.favoriteGenres, ...genres])]
  savePreferences(prefs)
}

// Set favorite genres
export function setFavoriteGenres(genres) {
  const prefs = getPreferences() || initializePreferences()
  prefs.favoriteGenres = genres
  savePreferences(prefs)
}

// Add to search history
export function addToSearchHistory(searchTerm) {
  if (!searchTerm || searchTerm.trim().length === 0) return
  
  const history = getSearchHistory()
  // Remove duplicates and add to front
  const filtered = history.filter(term => term.toLowerCase() !== searchTerm.toLowerCase())
  const updated = [searchTerm, ...filtered].slice(0, 20) // Keep last 20 searches
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated))
  
  // Also update preferences
  const prefs = getPreferences() || initializePreferences()
  prefs.searchHistory = updated
  savePreferences(prefs)
}

// Get search history
export function getSearchHistory() {
  const stored = localStorage.getItem(SEARCH_HISTORY_KEY)
  return stored ? JSON.parse(stored) : []
}

// Add viewed game
export function addViewedGame(gameId, gameTitle, gameImage = null) {
  const viewed = getViewedGames()
  // Remove if exists and add to front. Preserve a previously-stored image
  // if this call doesn't carry one, so re-views never blank out the cover.
  const prev = viewed.find(g => g.id === gameId)
  const filtered = viewed.filter(g => g.id !== gameId)
  const updated = [
    {
      id: gameId,
      title: gameTitle,
      image: gameImage || prev?.image || null,
      date: new Date().toISOString(),
    },
    ...filtered,
  ].slice(0, 50)
  localStorage.setItem(VIEWED_GAMES_KEY, JSON.stringify(updated))
  
  // Also update preferences
  const prefs = getPreferences() || initializePreferences()
  prefs.viewedGames = updated
  savePreferences(prefs)
}

// Get viewed games
export function getViewedGames() {
  const stored = localStorage.getItem(VIEWED_GAMES_KEY)
  return stored ? JSON.parse(stored) : []
}

// Add favorite game
export function addFavoriteGame(gameId, gameTitle) {
  const prefs = getPreferences() || initializePreferences()
  if (!prefs.favoriteGames.find(g => g.id === gameId)) {
    prefs.favoriteGames.push({ id: gameId, title: gameTitle })
    savePreferences(prefs)
  }
}

// Get favorite games
export function getFavoriteGames() {
  const prefs = getPreferences() || initializePreferences()
  return prefs.favoriteGames || []
}

// Get recommended genres based on user activity
export function getRecommendedGenres() {
  const prefs = getPreferences() || initializePreferences()
  const genres = prefs.favoriteGenres || []
  
  // Also infer from search history and viewed games
  // This is a simple implementation - could be enhanced with ML
  return genres
}


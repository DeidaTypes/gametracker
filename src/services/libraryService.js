// Library Service - manages game lists and trackers

const LIBRARY_STORAGE_KEY = 'gameLibrary'
const PROGRESS_STORAGE_KEY = 'gameProgress'

const DEFAULT_LISTS = {
  'currently-playing': { name: 'Currently Playing', games: [] },
  'played': { name: 'Played', games: [] },
  'want-to-play': { name: 'Want to Play', games: [] },
  'dropped': { name: 'Dropped', games: [] },
}

const STATUS_LIST_MAP = {
  want: 'want-to-play',
  currently: 'currently-playing',
  played: 'played',
  dropped: 'dropped',
}

const LIST_STATUS_MAP = {
  'want-to-play': 'want',
  'currently-playing': 'currently',
  'played': 'played',
  'dropped': 'dropped',
}

// Initialize library with default lists
export function initializeLibrary() {
  const existing = getLibrary()
  if (!existing || !existing.lists) {
    const library = {
      lists: { ...DEFAULT_LISTS },
      customLists: {},
    }
    saveLibrary(library)
    return library
  }
  return existing
}

// Get entire library
export function getLibrary() {
  const stored = localStorage.getItem(LIBRARY_STORAGE_KEY)
  if (stored) {
    return JSON.parse(stored)
  }
  return null
}

// Save library
export function saveLibrary(library) {
  localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library))
}

// Get games from a specific list
export function getGamesFromList(listId) {
  const library = getLibrary() || initializeLibrary()
  
  if (library.lists[listId]) {
    return library.lists[listId].games || []
  }
  
  if (library.customLists[listId]) {
    return library.customLists[listId].games || []
  }
  
  return []
}

// Add game to a list
export function addGameToList(listId, game) {
  const library = getLibrary() || initializeLibrary()
  
  // Check if game already exists in the list
  const existingGame = getGamesFromList(listId).find(g => g.id === game.id)
  if (existingGame) {
    return false // Game already in list
  }
  
  if (library.lists[listId]) {
    if (!library.lists[listId].games) {
      library.lists[listId].games = []
    }
    library.lists[listId].games.push({
      ...game,
      addedAt: new Date().toISOString(),
    })
  } else if (library.customLists[listId]) {
    if (!library.customLists[listId].games) {
      library.customLists[listId].games = []
    }
    library.customLists[listId].games.push({
      ...game,
      addedAt: new Date().toISOString(),
    })
  } else {
    return false // List doesn't exist
  }
  
  saveLibrary(library)
  return true
}

// Remove game from a list
export function removeGameFromList(listId, gameId) {
  const library = getLibrary() || initializeLibrary()
  
  if (library.lists[listId]) {
    library.lists[listId].games = (library.lists[listId].games || []).filter(
      g => g.id !== gameId
    )
  } else if (library.customLists[listId]) {
    library.customLists[listId].games = (library.customLists[listId].games || []).filter(
      g => g.id !== gameId
    )
  }
  
  saveLibrary(library)
}

// Create a custom list
export function createCustomList(listName, description = '', initialGames = []) {
  const library = getLibrary() || initializeLibrary()
  
  // Generate a unique ID
  const listId = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  
  if (!library.customLists) {
    library.customLists = {}
  }
  
  library.customLists[listId] = {
    name: listName,
    description: description,
    games: initialGames.map(game => ({
      ...game,
      addedAt: new Date().toISOString(),
    })),
    createdAt: new Date().toISOString(),
  }
  
  saveLibrary(library)
  return listId
}

// Delete a custom list
export function deleteCustomList(listId) {
  const library = getLibrary() || initializeLibrary()
  
  if (library.customLists[listId]) {
    delete library.customLists[listId]
    saveLibrary(library)
    return true
  }
  
  return false
}

// Rename a custom list
export function renameCustomList(listId, newName) {
  const library = getLibrary() || initializeLibrary()
  
  if (library.customLists[listId]) {
    library.customLists[listId].name = newName
    saveLibrary(library)
    return true
  }
  
  return false
}

// Get all lists (default + custom)
export function getAllLists() {
  const library = getLibrary() || initializeLibrary()
  
  const allLists = {
    ...library.lists,
    ...library.customLists,
  }
  
  return allLists
}

// Check if game is in a list
export function isGameInList(listId, gameId) {
  const games = getGamesFromList(listId)
  return games.some(g => g.id === gameId)
}

// Get list info
export function getListInfo(listId) {
  const library = getLibrary() || initializeLibrary()
  
  if (library.lists[listId]) {
    return {
      id: listId,
      name: library.lists[listId].name,
      isCustom: false,
    }
  }
  
  if (library.customLists[listId]) {
    return {
      id: listId,
      name: library.customLists[listId].name,
      description: library.customLists[listId].description || '',
      isCustom: true,
      createdAt: library.customLists[listId].createdAt,
    }
  }
  
  return null
}

// ─── Progress Tracking ──────────────────────────────────────────

function getAllProgress() {
  const stored = localStorage.getItem(PROGRESS_STORAGE_KEY)
  return stored ? JSON.parse(stored) : {}
}

function saveAllProgress(progress) {
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress))
}

/**
 * Returns the status list a game belongs to ('want' | 'currently' | 'played' | null)
 */
export function getGameStatus(gameId) {
  const id = String(gameId)
  for (const [listId, status] of Object.entries(LIST_STATUS_MAP)) {
    const games = getGamesFromList(listId)
    if (games.some(g => String(g.id) === id)) return status
  }
  return null
}

/**
 * Moves a game between status lists. If the game isn't in any list yet,
 * `game` object must be passed so it can be added.
 */
export function setGameStatus(gameId, newStatus, game = null) {
  const id = String(gameId)
  const targetList = STATUS_LIST_MAP[newStatus]
  if (!targetList) return false

  const currentStatus = getGameStatus(id)
  if (currentStatus === newStatus) return true

  const library = getLibrary() || initializeLibrary()

  // Remove from any existing status list
  let gameObj = game
  for (const listId of Object.keys(LIST_STATUS_MAP)) {
    const list = library.lists[listId]
    if (!list || !list.games) continue
    const idx = list.games.findIndex(g => String(g.id) === id)
    if (idx !== -1) {
      gameObj = list.games[idx]
      list.games.splice(idx, 1)
    }
  }

  if (!gameObj) return false

  if (!library.lists[targetList].games) {
    library.lists[targetList].games = []
  }
  library.lists[targetList].games.push({
    ...gameObj,
    addedAt: gameObj.addedAt || new Date().toISOString(),
  })

  saveLibrary(library)

  // Touch lastPlayedAt when moving to "currently"
  if (newStatus === 'currently') {
    updateGameProgress(id, { lastPlayedAt: new Date().toISOString() })
  }

  window.dispatchEvent(new Event('libraryUpdated'))
  return true
}

/**
 * Removes a game from whichever status list it belongs to.
 */
export function clearGameStatus(gameId) {
  const id = String(gameId)
  const library = getLibrary() || initializeLibrary()

  for (const listId of Object.keys(LIST_STATUS_MAP)) {
    const list = library.lists[listId]
    if (!list || !list.games) continue
    const idx = list.games.findIndex(g => String(g.id) === id)
    if (idx !== -1) {
      list.games.splice(idx, 1)
      break
    }
  }

  saveLibrary(library)
  window.dispatchEvent(new Event('libraryUpdated'))
}

/**
 * Get progress data for a game: { progressPercent, lastPlayedAt, hoursPlayed }
 */
export function getGameProgress(gameId) {
  const all = getAllProgress()
  return all[String(gameId)] || { progressPercent: null, lastPlayedAt: null, hoursPlayed: null }
}

/**
 * Merge-update progress fields for a game.
 */
export function updateGameProgress(gameId, data) {
  const all = getAllProgress()
  const id = String(gameId)
  const existing = all[id] || {}
  all[id] = {
    progressPercent: data.progressPercent !== undefined ? data.progressPercent : (existing.progressPercent ?? null),
    lastPlayedAt: data.lastPlayedAt !== undefined ? data.lastPlayedAt : (existing.lastPlayedAt ?? null),
    hoursPlayed: data.hoursPlayed !== undefined ? data.hoursPlayed : (existing.hoursPlayed ?? null),
  }
  saveAllProgress(all)
  window.dispatchEvent(new Event('libraryUpdated'))
}

/**
 * Returns currently-playing games enriched with progress data, sorted by lastPlayedAt.
 */
export function getContinuePlayingGames(limit = 5) {
  const games = getGamesFromList('currently-playing')
  return games
    .map(g => {
      const progress = getGameProgress(g.id)
      return { ...g, ...progress }
    })
    .sort((a, b) => {
      const da = new Date(a.lastPlayedAt || a.addedAt || 0)
      const db = new Date(b.lastPlayedAt || b.addedAt || 0)
      return db - da
    })
    .slice(0, limit)
}


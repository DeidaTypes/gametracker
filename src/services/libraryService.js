// Library Service - manages game lists and trackers

const LIBRARY_STORAGE_KEY = 'gameLibrary'
const DEFAULT_LISTS = {
  'currently-playing': { name: 'Currently Playing', games: [] },
  'played': { name: 'Played', games: [] },
  'want-to-play': { name: 'Want to Play', games: [] },
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
export function createCustomList(listName) {
  const library = getLibrary() || initializeLibrary()
  
  // Generate a unique ID
  const listId = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  
  if (!library.customLists) {
    library.customLists = {}
  }
  
  library.customLists[listId] = {
    name: listName,
    games: [],
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
      isCustom: true,
      createdAt: library.customLists[listId].createdAt,
    }
  }
  
  return null
}


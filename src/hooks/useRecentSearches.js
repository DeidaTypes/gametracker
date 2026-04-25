import { useState, useCallback } from 'react'

const STORAGE_KEY = 'userSearchHistory'
const MAX_ITEMS = 20

function readFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeToStorage(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // quota exceeded — silently fail
  }
}

export function useRecentSearches() {
  const [searches, setSearches] = useState(readFromStorage)

  const add = useCallback((term) => {
    if (!term || !term.trim()) return
    const trimmed = term.trim()
    setSearches((prev) => {
      const filtered = prev.filter(
        (s) => s.toLowerCase() !== trimmed.toLowerCase()
      )
      const next = [trimmed, ...filtered].slice(0, MAX_ITEMS)
      writeToStorage(next)
      return next
    })
  }, [])

  const remove = useCallback((term) => {
    setSearches((prev) => {
      const next = prev.filter(
        (s) => s.toLowerCase() !== term.toLowerCase()
      )
      writeToStorage(next)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    writeToStorage([])
    setSearches([])
  }, [])

  return { searches, add, remove, clear }
}

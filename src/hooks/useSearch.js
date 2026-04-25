import { useState, useEffect, useRef } from 'react'
import { searchGames } from '../services/searchService'
import { getCategoryDefinitions } from '../services/browseService'

const DEBOUNCE_MS = 200

/**
 * Searches the real IGDB catalog via searchService and categorises results.
 * Also matches the query against the real browse-category taxonomy for genres,
 * and extracts unique developer names from returned game objects.
 *
 * @param {string} query — raw user input (trimming handled internally)
 * @returns {{ results: { games: Array, genres: Array, developers: Array }, isLoading: boolean, error: string|null }}
 */
export function useSearch(query) {
  const [results, setResults] = useState({ games: [], genres: [], developers: [] })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const timerRef = useRef(null)
  const abortRef = useRef(0)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    const trimmed = (query || '').trim()
    if (!trimmed) {
      setResults({ games: [], genres: [], developers: [] })
      setIsLoading(false)
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)

    const callId = ++abortRef.current

    timerRef.current = setTimeout(async () => {
      try {
        const games = await searchGames(trimmed, 30)
        if (callId !== abortRef.current) return

        const lowerQuery = trimmed.toLowerCase()

        const matchingGenres = getCategoryDefinitions()
          .filter((cat) => cat.label.toLowerCase().includes(lowerQuery))
          .slice(0, 3)
          .map((cat) => ({ key: cat.key, label: cat.label }))

        const devMap = new Map()
        for (const game of games) {
          const devName = game.developer
          if (devName && devName.trim()) {
            const key = devName.toLowerCase()
            if (!devMap.has(key)) {
              devMap.set(key, { name: devName, count: 0 })
            }
            devMap.get(key).count++
          }
        }
        const developers = Array.from(devMap.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 3)

        setResults({
          games: games.slice(0, 5),
          genres: matchingGenres,
          developers,
        })
      } catch (err) {
        if (callId !== abortRef.current) return
        setError(err.message || 'Search failed')
        setResults({ games: [], genres: [], developers: [] })
      } finally {
        if (callId === abortRef.current) setIsLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query])

  return { results, isLoading, error }
}

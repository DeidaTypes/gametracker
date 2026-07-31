import { useState, useEffect, useRef } from 'react'
import { searchGames } from '../services/searchService'
import { searchGamesWithFilters, fetchShortGameIds } from '../services/igdb'
import { getCategoryDefinitions } from '../services/browseService'
import { parseNaturalQuery } from '../utils/parseNaturalQuery'
import { APP_RESUMED_EVENT } from './useAppResume'

const DEBOUNCE_MS = 250

/**
 * Searches the real IGDB catalog via searchService and categorises results.
 * Also matches the query against the real browse-category taxonomy for genres,
 * and extracts unique developer names from returned game objects.
 *
 * Natural-language queries like "short co-op games" are parsed into IGDB
 * filter clauses before the API call.  If the structured search fails the
 * hook falls back to a plain full-text search automatically.
 *
 * Shared by the Search page's Games, Devs, and All tabs — all three read
 * from this single hook/query so typing once never fires three separate
 * IGDB requests. `results.games` also carries the developer used for the
 * game-row subline, so the Devs tab (and the Devs section of All) both
 * come "for free" from the underlying searchGames() call and its cache.
 *
 * @param {string} query — raw user input (trimming handled internally)
 * @returns {{
 *   results:    { games: Array, genres: Array, developers: Array },
 *   isLoading:  boolean,
 *   error:      string|null,
 *   parsedFilters: string[]   human-readable labels of active filters ([] when none)
 * }}
 */
export function useSearch(query) {
  const [results, setResults] = useState({ games: [], genres: [], developers: [] })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [parsedFilters, setParsedFilters] = useState([])
  const timerRef = useRef(null)
  const abortRef = useRef(0)

  // Re-runs the search below on resume. A search that was in flight when the
  // app was suspended is dead — its IGDB request went out over a socket the OS
  // tore down — so without this the user comes back to a spinner that never
  // resolves, or to results for a query they've since changed.
  const [resumeKey, setResumeKey] = useState(0)
  useEffect(() => {
    const onResume = () => setResumeKey((k) => k + 1)
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    const trimmed = (query || '').trim()
    if (!trimmed) {
      setResults({ games: [], genres: [], developers: [] })
      setIsLoading(false)
      setError(null)
      setParsedFilters([])
      return
    }

    setIsLoading(true)
    setError(null)

    const callId = ++abortRef.current

    timerRef.current = setTimeout(async () => {
      try {
        const parsed = parseNaturalQuery(trimmed)
        let games

        if (parsed.hasFilters) {
          let { whereFragments, remainder, hasTtb } = parsed

          // TTB ("short"/"quick") → fetch short-game IDs and add as where fragment
          if (hasTtb) {
            const shortIds = await fetchShortGameIds(2700, 200)
            if (callId !== abortRef.current) return
            if (shortIds.length >= 5) {
              whereFragments = [`id = (${shortIds.slice(0, 150).join(',')})`, ...whereFragments]
            }
            // If TTB lookup returned < 5 results, fall back to Puzzle genre as proxy
            else {
              whereFragments = ['genres = (9)', ...whereFragments]
            }
          }

          games = await searchGamesWithFilters(remainder, whereFragments, 30)
          if (callId !== abortRef.current) return

          // If structured search returned nothing, fall back to plain search with
          // the original query so the user always sees something useful.
          if (games.length === 0 && remainder) {
            games = await searchGames(trimmed, 30)
            if (callId !== abortRef.current) return
          }
        } else {
          games = await searchGames(trimmed, 30)
          if (callId !== abortRef.current) return
        }

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
        // Sliced to 12 — enough to fill the dedicated Devs tab; the All tab
        // and the (legacy) Games-tab dev extraction just take the first few.
        const developers = Array.from(devMap.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 12)

        setResults({
          games: games.slice(0, 20),
          genres: matchingGenres,
          developers,
        })
        setParsedFilters(parsed.hasFilters ? parsed.labels : [])
      } catch (err) {
        if (callId !== abortRef.current) return
        setError(err.message || 'Search failed')
        setResults({ games: [], genres: [], developers: [] })
        setParsedFilters([])
      } finally {
        if (callId === abortRef.current) setIsLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query, resumeKey])

  return { results, isLoading, error, parsedFilters }
}

import { useState, useEffect, useRef } from 'react'
import { searchGames } from '../services/searchService'
import { searchGamesWithFilters, fetchShortGameIds } from '../services/igdb'
import { getCategoryDefinitions } from '../services/browseService'
import { parseNaturalQuery } from '../utils/parseNaturalQuery'
import { APP_RESUMED_EVENT, isLongAbsence } from './useAppResume'

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
  // Set by the resume listener, read once by the search effect below.
  const resumeQuietRef = useRef(false)
  const isLoadingRef = useRef(false)
  isLoadingRef.current = isLoading
  useEffect(() => {
    const onResume = (e) => {
      // A search still in flight when the OS tore the socket down would
      // otherwise spin forever. Retry that one even on a short return, but
      // never raise a fresh skeleton over results already on screen.
      if (!isLongAbsence(e) && !isLoadingRef.current) return
      resumeQuietRef.current = true
      setResumeKey((k) => k + 1)
    }
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [])

  useEffect(() => {
    const quiet = resumeQuietRef.current
    resumeQuietRef.current = false

    if (timerRef.current) clearTimeout(timerRef.current)

    const trimmed = (query || '').trim()
    if (!trimmed) {
      // Invalidate any in-flight request so a late response cannot
      // repopulate results after the user has cleared the field.
      abortRef.current += 1
      setResults({ games: [], genres: [], developers: [] })
      setIsLoading(false)
      setError(null)
      setParsedFilters([])
      return
    }

    if (!quiet) setIsLoading(true)
    setError(null)

    const callId = ++abortRef.current

    timerRef.current = setTimeout(async () => {
      try {
        const parsed = parseNaturalQuery(trimmed)
        let games
        let filtersApplied = false

        if (parsed.hasFilters) {
          // Natural-language parsing strips keywords like "short", "adventure",
          // "horror" out of the query text — but those same words are just as
          // likely to be part of a real title ("A Short Hike", "Adventure
          // Time") as they are to be a mood/genre filter. Stripping them
          // unconditionally turned "A Short Hike" into a search for "A Hike"
          // and "Adventure Time" into a search for "Time" plus a genre filter,
          // and neither game surfaced.
          //
          // Fix: try the plain, unmodified query first. Only fall back to the
          // structured, keyword-stripped query when the plain search finds
          // nothing — that absence is the actual signal that the words were
          // meant as filters rather than title text.
          games = await searchGames(trimmed, 30)
          if (callId !== abortRef.current) return

          if (games.length === 0) {
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
            filtersApplied = true

            // If the structured search also came up empty, fall back to the
            // plain query one more time so the user still sees something.
            if (games.length === 0 && remainder) {
              games = await searchGames(trimmed, 30)
              if (callId !== abortRef.current) return
              filtersApplied = false
            }
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
        setParsedFilters(filtersApplied ? parsed.labels : [])
      } catch (err) {
        if (callId !== abortRef.current) return
        setError(err.message || 'Search failed')
        if (!quiet) {
          setResults({ games: [], genres: [], developers: [] })
          setParsedFilters([])
        }
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

// useBacklogShelves — categorises a Want-to-Play game array into mood shelves
// using real IGDB attributes (themes.id, game_modes.id, genres.id) and TTB data.
//
// Shelf definitions mirror the MOOD_CHIPS in igdb.js so the same IGDB entity
// IDs power both the swipe-deck mood filter and the backlog shelf view.
//
// IGDB entity IDs:
//   themes:     19 = Horror, 31 = Drama, 33 = Sandbox, 38 = Open world
//   game_modes:  3 = Co-operative
//   genres:      9 = Puzzle
//   time_to_beat: normallySeconds ≤ 28 800 s (8 h) → Quick Win
//
// Metadata is cached in localStorage (gt:backlogMeta:v1, 12 h TTL) so re-opens
// of the Home screen never re-fetch the same game twice.

import { useState, useEffect, useRef } from 'react'
import { batchFetchGameMeta } from '../services/igdb'
import { getTimeToBeat } from '../services/timeToBeatService'

const QUICK_WIN_MAX_SECS = 8 * 60 * 60 // 8 hours

const SHELF_DEFS = [
  {
    id: 'quick',
    label: 'Quick Wins',
    emoji: '⚡',
    // A game qualifies when IGDB has TTB data and the "normally" play is ≤ 8 h.
    test: (_meta, ttb) =>
      ttb !== null &&
      typeof ttb.normallySeconds === 'number' &&
      ttb.normallySeconds <= QUICK_WIN_MAX_SECS,
  },
  {
    id: 'emotional',
    label: 'I want to cry',
    emoji: '😢',
    test: (meta) => meta?.themeIds?.includes(31), // Drama
  },
  {
    id: 'coop',
    label: 'Co-op Night',
    emoji: '🤝',
    test: (meta) => meta?.gameModeIds?.includes(3), // Co-operative
  },
  {
    id: 'spooky',
    label: 'Spooky',
    emoji: '👻',
    test: (meta) => meta?.themeIds?.includes(19), // Horror
  },
  {
    id: 'vibes',
    label: 'Just Vibes',
    emoji: '🌅',
    test: (meta) => meta?.themeIds?.some((id) => id === 33 || id === 38), // Sandbox / Open world
  },
  {
    id: 'puzzle',
    label: 'Puzzle Brain',
    emoji: '🧩',
    test: (meta) => meta?.genreIds?.includes(9), // Puzzle
  },
]

const LS_KEY = 'gt:backlogMeta:v1'
const LS_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

function readMetaCache() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeMetaCache(store) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store))
  } catch {
    // Quota exceeded — continue without persisting.
  }
}

const EMPTY_META = { themeIds: [], gameModeIds: [], genreIds: [] }

/**
 * Categorises a backlog game array into mood/length shelves backed by real
 * IGDB attributes. Metadata is fetched once and cached; TTB uses its own
 * dual-layer cache in timeToBeatService.
 *
 * @param {Array} games — backlog entries from getGamesFromList('want-to-play')
 * @returns {{ shelves: Array<{id,label,emoji,games}>, loading: boolean }}
 *   `shelves` contains only non-empty shelves. `loading` is true while the
 *   first batch of IGDB metadata is in-flight.
 */
export function useBacklogShelves(games) {
  const [shelves, setShelves] = useState([])
  const [loading, setLoading] = useState(false)
  const abortRef = useRef(false)

  useEffect(() => {
    if (games.length === 0) {
      setShelves([])
      setLoading(false)
      return
    }

    abortRef.current = false
    setLoading(true)

    async function run() {
      const cache = readMetaCache()
      const now = Date.now()

      // Identify games whose metadata is missing or stale.
      const needFetch = games.filter((g) => {
        const entry = cache[String(g.id)]
        return !entry || now > entry.expiresAt
      })

      if (needFetch.length > 0) {
        const numericIds = needFetch.map((g) => Number(g.id)).filter(Boolean)
        // Process in chunks of 50 (batchFetchGameMeta limit).
        for (let i = 0; i < numericIds.length; i += 50) {
          if (abortRef.current) return
          const chunk = numericIds.slice(i, i + 50)
          const metaMap = await batchFetchGameMeta(chunk)
          for (const [id, meta] of metaMap) {
            cache[id] = { meta, expiresAt: now + LS_TTL_MS }
          }
          // Games IGDB returned nothing for — cache as empty so we don't retry.
          for (const id of chunk) {
            if (!cache[String(id)]) {
              cache[String(id)] = { meta: EMPTY_META, expiresAt: now + LS_TTL_MS }
            }
          }
        }
        writeMetaCache(cache)
      }

      if (abortRef.current) return

      // Fetch TTB for all games concurrently (timeToBeatService has its own cache).
      const ttbMap = new Map()
      await Promise.all(
        games.map(async (g) => {
          const ttb = await getTimeToBeat(g.id)
          ttbMap.set(String(g.id), ttb)
        })
      )

      if (abortRef.current) return

      // Categorise each game and build the shelf list.
      const result = SHELF_DEFS.map((def) => ({
        id: def.id,
        label: def.label,
        emoji: def.emoji,
        games: games.filter((g) => {
          const meta = cache[String(g.id)]?.meta ?? EMPTY_META
          const ttb = ttbMap.get(String(g.id)) ?? null
          return def.test(meta, ttb)
        }),
      })).filter((s) => s.games.length > 0)

      setShelves(result)
      setLoading(false)
    }

    run().catch((err) => {
      console.error('[useBacklogShelves] unexpected error:', err)
      setLoading(false)
    })

    return () => {
      abortRef.current = true
    }
  }, [games])

  return { shelves, loading }
}

import { useState, useEffect } from 'react'
import { getGamesByGenre, getGamesByTheme } from '../services/igdb'
import { getEventWeekLeaderboard } from '../services/communityService'

/**
 * Current themed event week.
 *
 * To swap in a new week: update id, title, subtitle, emoji, startDate,
 * endDate, and filters. The rest of the system reacts automatically.
 *
 * `filters` drives real IGDB queries — no hardcoded game IDs.
 * Each filter: { type: 'genre'|'theme', name: string, limit: number }
 */
export const EVENT_WEEK_CONFIG = {
  id: 'soulslike-week-2026-06',
  title: 'Soulslike Week',
  subtitle: 'Dark, punishing, deeply satisfying',
  emoji: '💀',
  startDate: '2026-06-22',
  endDate: '2026-06-28',
  // Real IGDB genre + theme filters — deduped and merged at load time.
  filters: [
    { type: 'genre', name: 'Role-playing (RPG)', limit: 12 },
    { type: 'theme', name: 'Survival', limit: 8 },
  ],
}

function isActive(config) {
  const now = new Date()
  const start = new Date(config.startDate + 'T00:00:00')
  const end = new Date(config.endDate + 'T23:59:59')
  return now >= start && now <= end
}

/**
 * Fetches the themed event week's game set (via real IGDB filters) and the
 * community leaderboard (from activity_events within the past 7 days).
 *
 * Returns `eventWeek: null` when no event is currently active so the
 * section in Explore.jsx renders nothing — no orphan shell left behind.
 *
 * @returns {{
 *   eventWeek: {
 *     config: typeof EVENT_WEEK_CONFIG,
 *     games: Array<{ id: number, title: string, image: string|null, rating: string|null }>,
 *     leaderboard: Array<{
 *       userId: string,
 *       username: string|null,
 *       displayName: string,
 *       avatarUrl: string|null,
 *       eventCount: number,
 *     }>,
 *   } | null,
 *   loading: boolean,
 * }}
 */
export default function useEventWeek() {
  const [state, setState] = useState({ eventWeek: null, loading: true })

  useEffect(() => {
    const config = EVENT_WEEK_CONFIG
    if (!isActive(config)) {
      setState({ eventWeek: null, loading: false })
      return
    }

    let cancelled = false

    async function load() {
      try {
        // Fetch each IGDB filter concurrently (real genre + theme queries).
        const fetches = config.filters.map(({ type, name, limit }) =>
          type === 'theme' ? getGamesByTheme(name, limit) : getGamesByGenre(name, limit)
        )
        const results = await Promise.allSettled(fetches)

        // Merge results, dedup by IGDB id, require a cover image.
        const seen = new Set()
        const games = []
        for (const res of results) {
          if (res.status !== 'fulfilled') continue
          for (const g of res.value) {
            if (!g?.id || seen.has(g.id)) continue
            if (!g.image) continue
            seen.add(g.id)
            games.push(g)
          }
        }

        // Sort by rating descending and cap to 12 covers.
        games.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0))
        const topGames = games.slice(0, 12)

        // Leaderboard: who's been playing these games this week?
        const igdbIds = topGames.map((g) => g.id)
        const leaderboard = igdbIds.length > 0
          ? await getEventWeekLeaderboard(igdbIds, 5)
          : []

        if (cancelled) return
        setState({ eventWeek: { config, games: topGames, leaderboard }, loading: false })
      } catch (err) {
        console.error('[eventWeek] load failed:', err)
        if (!cancelled) setState({ eventWeek: null, loading: false })
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

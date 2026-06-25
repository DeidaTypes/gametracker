// useCollectionStats — collection-level stats for the Library page.
//
// Fetches from two Supabase tables:
//   game_trackers  → total hours logged, progress per game
//   activity_events → recent 'played' events for "on a roll" signal (F1)
//
// Also reads localStorage via profileStatsService for the favorite genre
// (genre counts are derived from IGDB data stored on each game object).
//
// Returns a stable object. Re-runs whenever `userId` changes.

import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { getProfileStats } from '../services/profileStatsService'
import { getGamesFromList } from '../services/libraryService'
import { getTimeToBeat } from '../services/timeToBeatService'

/** Number of calendar days that count as "on a roll" via F1 activity feed. */
const ON_A_ROLL_DAYS = 7

/**
 * @typedef {Object} CollectionStats
 * @property {boolean}        loading
 * @property {string|null}    favoriteGenre
 * @property {number}         totalHours       - sum of all hours_played rows
 * @property {{ title: string, hours: number, image?: string }|null} longestBeaten
 * @property {Object}         trackerRows      - keyed by igdb_game_id string
 *   Each value: { hours: number, progressOverride: number|null }
 * @property {Set<string>}    onARollIds       - game IDs with F1 'played' event in last 7 days
 * @property {Object}         cpProgress       - keyed by igdb_game_id string
 *   Each value: { hours: number, percent: number|null }
 */

/**
 * @param {string|null|undefined} userId
 * @returns {CollectionStats}
 */
export function useCollectionStats(userId) {
  const [state, setState] = useState({
    loading: true,
    favoriteGenre: null,
    totalHours: 0,
    longestBeaten: null,
    trackerRows: {},
    onARollIds: new Set(),
    cpProgress: {},
  })

  useEffect(() => {
    // Always read local stats (no auth needed, instant)
    const localStats = getProfileStats()

    if (!userId) {
      setState({
        loading: false,
        favoriteGenre: localStats.favoriteGenre,
        totalHours: localStats.totalHours || 0,
        longestBeaten: null,
        trackerRows: {},
        onARollIds: new Set(),
        cpProgress: {},
      })
      return
    }

    let cancelled = false

    async function load() {
      // ── 1. All game_trackers rows for this user ─────────────────────────
      const { data: trackerData } = await supabase
        .from('game_trackers')
        .select('igdb_game_id, hours_played, progress_override, game_title, game_image')
        .eq('user_id', userId)

      if (cancelled) return

      const rows = trackerData || []
      const trackerRows = {}
      let totalHours = 0

      for (const row of rows) {
        const key = String(row.igdb_game_id)
        const h = Number(row.hours_played) || 0
        trackerRows[key] = {
          hours: Math.round(h * 10) / 10,
          progressOverride:
            row.progress_override != null ? Number(row.progress_override) : null,
          title: row.game_title || null,
          image: row.game_image || null,
        }
        totalHours += h
      }

      // ── 2. Longest beaten — highest hours from the "played" localStorage list
      const playedGames = getGamesFromList('played')
      let longestBeaten = null
      for (const g of playedGames) {
        const r = trackerRows[String(g.id)]
        if (!r || r.hours === 0) continue
        if (!longestBeaten || r.hours > longestBeaten.hours) {
          longestBeaten = {
            title: g.title || r.title || 'Unknown',
            image: g.image || r.image || null,
            hours: r.hours,
          }
        }
      }

      // ── 3. "On a roll" — F1 activity_events 'played' in last N days ────
      const cutoff = new Date(
        Date.now() - ON_A_ROLL_DAYS * 86400_000
      ).toISOString()

      const { data: recentEvents } = await supabase
        .from('activity_events')
        .select('entity_id')
        .eq('actor_user_id', userId)
        .eq('type', 'played')
        .gte('created_at', cutoff)

      if (cancelled) return

      const onARollIds = new Set(
        (recentEvents || [])
          .map((e) => String(e.entity_id))
          .filter(Boolean)
      )

      // ── 4. CP progress — hours + percent for each currently-playing game
      const cpGames = getGamesFromList('currently-playing')
      const cpProgress = {}

      await Promise.all(
        cpGames.map(async (g) => {
          if (!g?.id) return
          const key = String(g.id)
          const row = trackerRows[key]
          const hours = row?.hours ?? 0

          // Use manual progress_override when set; otherwise derive from TTB.
          let percent = row?.progressOverride ?? null

          if (percent === null && hours > 0) {
            try {
              const ttb = await getTimeToBeat(g.id)
              if (ttb?.normallySeconds > 0) {
                const ttbHours = ttb.normallySeconds / 3600
                percent = Math.min(100, Math.round((hours / ttbHours) * 100))
              }
            } catch {
              // TTB unavailable — percent stays null, show hours only
            }
          }

          cpProgress[key] = { hours, percent }
        })
      )

      if (cancelled) return

      setState({
        loading: false,
        favoriteGenre: localStats.favoriteGenre,
        totalHours: Math.round(totalHours),
        longestBeaten,
        trackerRows,
        onARollIds,
        cpProgress,
      })
    }

    load().catch((err) => {
      console.error('[useCollectionStats]', err)
      if (!cancelled) setState((s) => ({ ...s, loading: false }))
    })

    return () => {
      cancelled = true
    }
  }, [userId])

  return state
}

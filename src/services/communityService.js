import { supabase } from './supabase'
import { applyBlockFilter } from './blockService'
import { getRecentCommunityReviews } from './reviewService'

/**
 * Community Service — REAL cross-user activity for the Explore/Discover page.
 *
 * This replaces the old `communityMockService`, which synthesized ~30 fake
 * users, fake logs and fake reviews. Per the app's hard rule, NOTHING here
 * is fabricated: every section reads real rows from Supabase (`reviews`,
 * `game_trackers`). When a real source is empty the calling section shows a
 * proper empty state rather than dummy content.
 *
 * Every function fails soft (returns [] on error) so a failed/timed-out
 * fetch can never pin a loading spinner — the section just renders empty.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
// Window for "trending" aggregation. Reviews are the dominant real signal in
// a small community, so a slightly wider window keeps the section meaningful.
const TRENDING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const FINISHED_STATUSES = ['played', 'completed', 'finished']

function reviewerFromJoin(row) {
  const u = row.users || {}
  return {
    id: row.user_id || null,
    username: u.username || u.display_name || null,
    displayName: u.display_name || u.username || null,
    avatarUrl: u.avatar_url || null,
  }
}

/**
 * "Trending this week" — games with the most distinct people active on them
 * (real reviews + real tracker updates) in the recent window. Returns:
 *   [{ game: { id, title, image }, peopleCount, mostCommonStatus }]
 *
 * No fabricated counts: `peopleCount` is the number of DISTINCT real user ids
 * that reviewed or tracked the game in the window.
 */
export async function getTrendingThisWeek(limit = 10) {
  const _t0 = Date.now()
  try {
    const sinceIso = new Date(Date.now() - TRENDING_WINDOW_MS).toISOString()

    const [reviewsRes, trackersRes] = await Promise.all([
      (async () => {
        let q = supabase
          .from('reviews')
          .select('igdb_game_id, user_id, game_title, game_image, created_at')
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(100)
        q = await applyBlockFilter(q, 'user_id')
        return q
      })(),
      (async () => {
        let q = supabase
          .from('game_trackers')
          .select('igdb_game_id, user_id, status, game_title, game_image, updated_at')
          .gte('updated_at', sinceIso)
          .order('updated_at', { ascending: false })
          .limit(100)
        q = await applyBlockFilter(q, 'user_id')
        return q
      })(),
    ])

    if (import.meta.env.DEV) console.log(`[⏱ explore] getTrendingThisWeek Promise.all (reviews+trackers): ${Date.now() - _t0}ms`)
    const reviewRows = reviewsRes.error ? [] : reviewsRes.data || []
    const trackerRows = trackersRes.error ? [] : trackersRes.data || []

    const byGame = new Map()
    const bump = (gid, ref, userId, status) => {
      if (gid == null || !ref.image) return
      const key = String(gid)
      let entry = byGame.get(key)
      if (!entry) {
        entry = { game: ref, users: new Set(), statusCounts: {} }
        byGame.set(key, entry)
      }
      if (userId) entry.users.add(userId)
      entry.statusCounts[status] = (entry.statusCounts[status] || 0) + 1
    }

    for (const r of reviewRows) {
      bump(
        r.igdb_game_id,
        { id: r.igdb_game_id, title: r.game_title || '', image: r.game_image || null },
        r.user_id,
        'reviewed'
      )
    }
    for (const t of trackerRows) {
      bump(
        t.igdb_game_id,
        { id: t.igdb_game_id, title: t.game_title || '', image: t.game_image || null },
        t.user_id,
        t.status || 'tracked'
      )
    }

    const result = Array.from(byGame.values())
      .map((e) => ({
        game: e.game,
        peopleCount: e.users.size,
        mostCommonStatus: dominantStatus(e.statusCounts),
      }))
      .filter((e) => e.peopleCount > 0)
      .sort((a, b) => b.peopleCount - a.peopleCount)
      .slice(0, limit)
    if (import.meta.env.DEV) console.log(`[⏱ explore] getTrendingThisWeek TOTAL: ${Date.now() - _t0}ms (${result.length} items)`)
    return result
  } catch (err) {
    console.error('[community] getTrendingThisWeek failed:', err)
    return []
  }
}

function dominantStatus(counts) {
  let best = 'reviewed'
  let max = -1
  for (const [s, c] of Object.entries(counts)) {
    if (c > max) {
      max = c
      best = s
    }
  }
  return best
}

/**
 * "Just finished" — games people recently marked Played/Completed in the
 * `game_trackers` table, newest first, with the tracker's rating when set.
 * Returns: [{ id, game: { id, title, image }, reviewer, rating, timestamp }]
 *
 * Real source only. Empty result → the section renders its empty state.
 */
export async function getJustFinished(limit = 20) {
  const _t0 = Date.now()
  try {
    let q = supabase
      .from('game_trackers')
      .select(
        '*, users!game_trackers_user_id_fkey(username, display_name, avatar_url)'
      )
      .in('status', FINISHED_STATUSES)
      .order('updated_at', { ascending: false })
      .limit(limit * 2)
    q = await applyBlockFilter(q, 'user_id')
    const { data, error } = await q
    if (import.meta.env.DEV) console.log(`[⏱ explore] getJustFinished query: ${Date.now() - _t0}ms`)
    if (error) {
      console.error('[community] getJustFinished failed:', error.message)
      return []
    }

    const result = (data || [])
      .filter((row) => row.game_image && row.igdb_game_id != null)
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        game: {
          id: row.igdb_game_id,
          title: row.game_title || '',
          image: row.game_image || null,
        },
        reviewer: reviewerFromJoin(row),
        rating: row.rating != null ? Number(row.rating) : null,
        timestamp: row.updated_at ? new Date(row.updated_at).getTime() : 0,
      }))
    if (import.meta.env.DEV) console.log(`[⏱ explore] getJustFinished TOTAL: ${Date.now() - _t0}ms (${result.length} items)`)
    return result
  } catch (err) {
    console.error('[community] getJustFinished crashed:', err)
    return []
  }
}

/**
 * Recent community reviews — thin re-export of the canonical reviewService
 * query so the Explore hook has a single import surface.
 */
export async function getCommunityReviews(limit = 20) {
  return getRecentCommunityReviews(limit)
}

export { WEEK_MS }

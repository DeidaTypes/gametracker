import { supabase } from './supabase'
import { applyBlockFilter } from './blockService'
import { getRecentCommunityReviews } from './reviewService'
import { getGamesByIds, getGamesByGenre } from './igdb'
import { getCircleActivityEvents, getRecentGlobalActivityEvents } from './activityEventsService'
import { getTasteMatch } from './tasteEngineService'
import { getLikeCountsForReviews } from './likeService'
import { getCommentCountsForReviews, getCommentCountsForEvents } from './commentService'
import { getFlaggedContentIds } from './reportService'

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

const FINISHED_STATUSES = ['played', 'completed', 'finished']

// ─── Followee cache ──────────────────────────────────────────────────────────
// One TTL-bounded read of the `follows` table so every trending variant can
// compute social proof without issuing N separate queries.

let _followeeCache = null
let _followeeCacheUid = null
let _followeeCacheTime = 0
const FOLLOWEE_CACHE_TTL = 60_000

async function _getCurrentUserFollowees() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []
    const now = Date.now()
    if (
      _followeeCache &&
      _followeeCacheUid === user.id &&
      now - _followeeCacheTime < FOLLOWEE_CACHE_TTL
    ) {
      return _followeeCache
    }
    const { data } = await supabase
      .from('follows')
      .select('followee_id')
      .eq('follower_id', user.id)
    _followeeCache = (data || []).map((r) => r.followee_id)
    _followeeCacheUid = user.id
    _followeeCacheTime = now
    return _followeeCache
  } catch {
    return []
  }
}

// ─── Internal query helpers ──────────────────────────────────────────────────

/**
 * Fetch reviews + tracker rows in a time window, optionally filtered to a
 * specific set of IGDB game IDs.
 * `untilIso` is exclusive (< untilIso) — pass null for "up to now".
 */
async function _runTrendingQuery(sinceIso, untilIso = null, { gameIdFilter = null } = {}) {
  const [reviewsRes, trackersRes] = await Promise.all([
    (async () => {
      let q = supabase
        .from('reviews')
        .select('igdb_game_id, user_id, game_title, game_image, created_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(100)
      if (untilIso) q = q.lt('created_at', untilIso)
      if (gameIdFilter && gameIdFilter.length) q = q.in('igdb_game_id', gameIdFilter)
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
      if (untilIso) q = q.lt('updated_at', untilIso)
      if (gameIdFilter && gameIdFilter.length) q = q.in('igdb_game_id', gameIdFilter)
      q = await applyBlockFilter(q, 'user_id')
      return q
    })(),
  ])
  return {
    reviewRows:  reviewsRes.error  ? [] : (reviewsRes.data  || []),
    trackerRows: trackersRes.error ? [] : (trackersRes.data || []),
  }
}

/** Aggregate review + tracker rows into a Map keyed by igdb_game_id string. */
function _aggregateToMap(reviewRows, trackerRows) {
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
      'reviewed',
    )
  }
  for (const t of trackerRows) {
    bump(
      t.igdb_game_id,
      { id: t.igdb_game_id, title: t.game_title || '', image: t.game_image || null },
      t.user_id,
      t.status || 'tracked',
    )
  }
  return byGame
}

/**
 * For each game ID, count how many of the given followees logged an
 * activity_events row in the current window.
 * Returns Map<gameIdString, distinctFriendCount>.
 */
async function _computeFollowFriendCounts(followeeIds, gameIds, sinceIso) {
  if (!followeeIds.length || !gameIds.length) return new Map()
  try {
    const entityIds = gameIds.map((id) => String(id))
    let q = supabase
      .from('activity_events')
      .select('actor_user_id, entity_id')
      .in('actor_user_id', followeeIds)
      .in('entity_id', entityIds)
      .in('type', ['played', 'reviewed', 'started', 'completed', 'dropped', 'favorited'])
      .gte('created_at', sinceIso)
      .limit(300)
    q = await applyBlockFilter(q, 'actor_user_id')
    const { data, error } = await q
    if (error || !data) return new Map()
    const actorsByGame = new Map()
    for (const row of data) {
      const key = row.entity_id
      if (!actorsByGame.has(key)) actorsByGame.set(key, new Set())
      actorsByGame.get(key).add(row.actor_user_id)
    }
    return new Map(Array.from(actorsByGame.entries()).map(([k, s]) => [k, s.size]))
  } catch {
    return new Map()
  }
}

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
 * "Trending this week" — global scope.
 *
 * Computes distinct-user activity on each game over the CURRENT 7-day window
 * and the PRIOR 7-day window, then annotates each result with:
 *   - `trend`: 'rising' | 'stable' | 'falling'  (week-over-week delta)
 *   - `followFriendCount`: how many people the viewer follows were active
 *
 * Returns: [{ game, peopleCount, mostCommonStatus, trend, followFriendCount }]
 */
export async function getTrendingThisWeek(limit = 10) {
  const _t0 = Date.now()
  try {
    const now = Date.now()
    const currentSinceIso = new Date(now - WEEK_MS).toISOString()
    const prevSinceIso    = new Date(now - 2 * WEEK_MS).toISOString()

    const [cur, prev, followeeIds] = await Promise.all([
      _runTrendingQuery(currentSinceIso),
      _runTrendingQuery(prevSinceIso, currentSinceIso),
      _getCurrentUserFollowees(),
    ])

    if (import.meta.env.DEV) console.log(`[⏱ explore] getTrendingThisWeek queries: ${Date.now() - _t0}ms`)

    const currentMap = _aggregateToMap(cur.reviewRows, cur.trackerRows)
    const prevMap    = _aggregateToMap(prev.reviewRows, prev.trackerRows)
    const gameIds    = Array.from(currentMap.keys())

    const friendMap = await _computeFollowFriendCounts(followeeIds, gameIds, currentSinceIso)

    const result = Array.from(currentMap.values())
      .map((e) => {
        const curCount  = e.users.size
        const prevEntry = prevMap.get(String(e.game.id))
        const prevCount = prevEntry ? prevEntry.users.size : 0
        const delta     = curCount - prevCount
        const trend     = delta >= 2 ? 'rising' : delta <= -2 ? 'falling' : 'stable'
        return {
          game: e.game,
          peopleCount: curCount,
          mostCommonStatus: dominantStatus(e.statusCounts),
          trend,
          followFriendCount: friendMap.get(String(e.game.id)) || 0,
        }
      })
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

/**
 * "Trending in your circle" — activity_events scope.
 *
 * Uses the `activity_events` table filtered to people the viewer follows,
 * so every entry has a `followFriendCount >= 1`. WoW delta still applies.
 * Returns the same shape as `getTrendingThisWeek` so `TrendingCard` is reused.
 */
export async function getTrendingCircle(limit = 10) {
  const _t0 = Date.now()
  try {
    const followeeIds = await _getCurrentUserFollowees()
    if (followeeIds.length === 0) return []

    const now = Date.now()
    const currentSinceIso = new Date(now - WEEK_MS).toISOString()
    const prevSinceIso    = new Date(now - 2 * WEEK_MS).toISOString()

    const fetchCircleRows = async (since, until) => {
      try {
        let q = supabase
          .from('activity_events')
          .select('actor_user_id, entity_id, type, metadata')
          .in('actor_user_id', followeeIds)
          .in('type', ['played', 'reviewed', 'started', 'completed', 'dropped', 'favorited'])
          .gte('created_at', since)
          .limit(200)
        if (until) q = q.lt('created_at', until)
        q = await applyBlockFilter(q, 'actor_user_id')
        const { data, error } = await q
        return error ? [] : (data || [])
      } catch {
        return []
      }
    }

    const [curRows, prevRows] = await Promise.all([
      fetchCircleRows(currentSinceIso, null),
      fetchCircleRows(prevSinceIso, currentSinceIso),
    ])

    if (import.meta.env.DEV) console.log(`[⏱ explore] getTrendingCircle queries: ${Date.now() - _t0}ms`)

    const aggregateCircle = (rows) => {
      const byGame = new Map()
      for (const row of rows) {
        const gid  = row.entity_id
        const meta = row.metadata || {}
        if (!gid || !meta.game_image) continue
        if (!byGame.has(gid)) {
          byGame.set(gid, {
            game: { id: gid, title: meta.game_title || '', image: meta.game_image },
            users: new Set(),
            statusCounts: {},
          })
        }
        const entry = byGame.get(gid)
        entry.users.add(row.actor_user_id)
        entry.statusCounts[row.type] = (entry.statusCounts[row.type] || 0) + 1
      }
      return byGame
    }

    const currentMap = aggregateCircle(curRows)
    const prevMap    = aggregateCircle(prevRows)

    const result = Array.from(currentMap.values())
      .map((e) => {
        const curCount  = e.users.size
        const prevEntry = prevMap.get(e.game.id)
        const prevCount = prevEntry ? prevEntry.users.size : 0
        const delta     = curCount - prevCount
        const trend     = delta >= 1 ? 'rising' : delta <= -1 ? 'falling' : 'stable'
        return {
          game: e.game,
          peopleCount: curCount,
          mostCommonStatus: dominantStatus(e.statusCounts),
          trend,
          followFriendCount: curCount, // every entry in circle mode is a friend
        }
      })
      .filter((e) => e.followFriendCount >= 1)
      .sort((a, b) => b.followFriendCount - a.followFriendCount)
      .slice(0, limit)

    if (import.meta.env.DEV) console.log(`[⏱ explore] getTrendingCircle TOTAL: ${Date.now() - _t0}ms (${result.length} items)`)
    return result
  } catch (err) {
    console.error('[community] getTrendingCircle failed:', err)
    return []
  }
}

/**
 * "Trending in your genre" — filters the global trending query to games
 * in the user's top-played IGDB genre (derived from game_trackers + IGDB).
 * Falls back to `getTrendingThisWeek` when genre cannot be determined or
 * the filtered set is empty (so the section is never blank unnecessarily).
 *
 * Each result includes `genreLabel` (the genre name) so the UI can annotate
 * the scope toggle label ("Genre → RPG") once the first load completes.
 */
export async function getTrendingByGenre(limit = 10) {
  const _t0 = Date.now()
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return getTrendingThisWeek(limit)

    // 1. User's most-played game IDs
    const { data: trackerRows } = await supabase
      .from('game_trackers')
      .select('igdb_game_id, hours_played')
      .eq('user_id', user.id)
      .order('hours_played', { ascending: false })
      .limit(10)

    const userGameIds = (trackerRows || []).map((r) => r.igdb_game_id).filter(Boolean)
    if (!userGameIds.length) return getTrendingThisWeek(limit)

    // 2. Derive top genre from IGDB (cached after first call)
    const igdbGames = await getGamesByIds(userGameIds.slice(0, 10))
    if (!igdbGames.length) return getTrendingThisWeek(limit)

    const genreFreq = {}
    for (const g of igdbGames) {
      for (const name of (g.genre || '').split(',').map((s) => s.trim()).filter(Boolean)) {
        genreFreq[name] = (genreFreq[name] || 0) + 1
      }
    }
    const topGenre = Object.entries(genreFreq).sort((a, b) => b[1] - a[1])[0]?.[0]
    if (!topGenre) return getTrendingThisWeek(limit)

    // 3. Fetch all games in that genre from IGDB (cached)
    const genreGames  = await getGamesByGenre(topGenre, 50)
    const genreGameIds = genreGames.map((g) => g.id).filter(Boolean)
    if (!genreGameIds.length) return getTrendingThisWeek(limit)

    if (import.meta.env.DEV) console.log(`[⏱ explore] getTrendingByGenre genre="${topGenre}" ids=${genreGameIds.length}: ${Date.now() - _t0}ms`)

    // 4. Run trending with genre filter + WoW delta + social proof
    const now = Date.now()
    const currentSinceIso = new Date(now - WEEK_MS).toISOString()
    const prevSinceIso    = new Date(now - 2 * WEEK_MS).toISOString()

    const [cur, prev, followeeIds] = await Promise.all([
      _runTrendingQuery(currentSinceIso, null, { gameIdFilter: genreGameIds }),
      _runTrendingQuery(prevSinceIso, currentSinceIso, { gameIdFilter: genreGameIds }),
      _getCurrentUserFollowees(),
    ])

    const currentMap = _aggregateToMap(cur.reviewRows, cur.trackerRows)
    const prevMap    = _aggregateToMap(prev.reviewRows, prev.trackerRows)
    const gameIds    = Array.from(currentMap.keys())
    const friendMap  = await _computeFollowFriendCounts(followeeIds, gameIds, currentSinceIso)

    const result = Array.from(currentMap.values())
      .map((e) => {
        const curCount  = e.users.size
        const prevEntry = prevMap.get(String(e.game.id))
        const prevCount = prevEntry ? prevEntry.users.size : 0
        const delta     = curCount - prevCount
        const trend     = delta >= 2 ? 'rising' : delta <= -2 ? 'falling' : 'stable'
        return {
          game: e.game,
          peopleCount: curCount,
          mostCommonStatus: dominantStatus(e.statusCounts),
          trend,
          followFriendCount: friendMap.get(String(e.game.id)) || 0,
          genreLabel: topGenre,
        }
      })
      .filter((e) => e.peopleCount > 0)
      .sort((a, b) => b.peopleCount - a.peopleCount)
      .slice(0, limit)

    if (import.meta.env.DEV) console.log(`[⏱ explore] getTrendingByGenre TOTAL: ${Date.now() - _t0}ms (${result.length} items)`)
    if (result.length === 0) return getTrendingThisWeek(limit)
    return result
  } catch (err) {
    console.error('[community] getTrendingByGenre failed:', err)
    return getTrendingThisWeek(limit)
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

/**
 * "Most played this week" — top games by total community session hours
 * in the last 7 days, ranked by summed seconds desc.
 *
 * Calls the `get_most_played_this_week` SECURITY DEFINER RPC which
 * aggregates across ALL users' play_sessions while bypassing RLS, but
 * only returns pre-aggregated data (no personal identifiers).
 *
 * Returns: [{ igdb_game_id, game_title, game_image, total_minutes, player_count }]
 * Returns [] when no sessions fall in the window (correct empty state).
 */
export async function getMostPlayedThisWeek(limit = 5) {
  const _t0 = Date.now()
  try {
    const { data, error } = await supabase.rpc('get_most_played_this_week', { top_n: limit })
    if (import.meta.env.DEV) console.log(`[⏱ explore] getMostPlayedThisWeek: ${Date.now() - _t0}ms`)
    if (error) {
      console.error('[community] getMostPlayedThisWeek RPC error:', error.message)
      return []
    }
    return (data || []).map((row) => ({
      igdb_game_id:  row.igdb_game_id,
      game_title:    row.game_title   || 'Unknown Game',
      game_image:    row.game_image   || null,
      total_minutes: Number(row.total_minutes) || 0,
      player_count:  Number(row.player_count)  || 0,
    }))
  } catch (err) {
    console.error('[community] getMostPlayedThisWeek crashed:', err)
    return []
  }
}

/**
 * Event week leaderboard — the users most active on a specific set of IGDB
 * games in the last 7 days, sourced from `activity_events`.
 *
 * @param {Array<string|number>} igdbGameIds  IGDB game IDs to filter on.
 * @param {number} limit  Maximum rows to return (default 5).
 * @returns {Promise<Array<{
 *   userId: string,
 *   username: string|null,
 *   displayName: string,
 *   avatarUrl: string|null,
 *   eventCount: number,
 * }>>}
 *
 * Returns [] when no qualifying activity exists — the caller hides the section.
 */
export async function getEventWeekLeaderboard(igdbGameIds, limit = 5) {
  if (!igdbGameIds || igdbGameIds.length === 0) return []
  try {
    const sinceIso = new Date(Date.now() - WEEK_MS).toISOString()
    const entityIds = igdbGameIds.map((id) => String(id))

    let q = supabase
      .from('activity_events')
      .select('actor_user_id')
      .in('entity_id', entityIds)
      .in('type', ['played', 'started', 'completed', 'reviewed', 'rated'])
      .gte('created_at', sinceIso)
      .limit(500)
    q = await applyBlockFilter(q, 'actor_user_id')
    const { data, error } = await q
    if (error) {
      console.error('[community] getEventWeekLeaderboard query failed:', error.message)
      return []
    }

    const rows = data || []
    if (rows.length === 0) return []

    // Aggregate event count per user in JS to avoid needing an RPC.
    const countByUser = new Map()
    for (const row of rows) {
      countByUser.set(row.actor_user_id, (countByUser.get(row.actor_user_id) || 0) + 1)
    }

    const topActors = Array.from(countByUser.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([userId, count]) => ({ userId, count }))

    if (topActors.length === 0) return []

    const actorIds = topActors.map((a) => a.userId)
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, username, display_name, avatar_url')
      .in('id', actorIds)
    if (usersErr) {
      console.error('[community] getEventWeekLeaderboard users query failed:', usersErr.message)
      return []
    }

    const userMap = new Map((users || []).map((u) => [u.id, u]))
    return topActors
      .map(({ userId, count }) => {
        const u = userMap.get(userId)
        if (!u) return null
        return {
          userId,
          username: u.username || null,
          displayName: u.display_name || u.username || 'Player',
          avatarUrl: u.avatar_url || null,
          eventCount: count,
        }
      })
      .filter(Boolean)
  } catch (err) {
    console.error('[community] getEventWeekLeaderboard crashed:', err)
    return []
  }
}

/**
 * "Most played in your circle" — top games by distinct-friend activity in
 * `activity_events` over the last 7 days, restricted to people the viewer
 * follows. Includes week-over-week rank movement so the UI can show ↑/↓/NEW.
 *
 * @param {number} limit  Maximum rows to return (default 10).
 * @returns {Promise<Array<{
 *   igdb_game_id: string,
 *   game_title: string,
 *   game_image: string|null,
 *   friend_count: number,
 *   rank: number,
 *   movement: 'up'|'down'|'same'|'new',
 *   movement_delta: number,
 * }>>}
 *
 * Returns [] when the viewer has no follows or the circle had no activity.
 */
export async function getMostPlayedInCircle(limit = 10) {
  const _t0 = Date.now()
  try {
    const followeeIds = await _getCurrentUserFollowees()
    if (followeeIds.length === 0) return []

    const now = Date.now()
    const currentSince = new Date(now - WEEK_MS).toISOString()
    const prevSince    = new Date(now - 2 * WEEK_MS).toISOString()

    const fetchRows = async (since, until = null) => {
      try {
        let q = supabase
          .from('activity_events')
          .select('actor_user_id, entity_id, type, metadata')
          .in('actor_user_id', followeeIds)
          .in('type', ['played', 'reviewed', 'started', 'completed', 'dropped', 'favorited'])
          .gte('created_at', since)
          .limit(500)
        if (until) q = q.lt('created_at', until)
        q = await applyBlockFilter(q, 'actor_user_id')
        const { data, error } = await q
        return error ? [] : (data || [])
      } catch {
        return []
      }
    }

    const [curRows, prevRows] = await Promise.all([
      fetchRows(currentSince),
      fetchRows(prevSince, currentSince),
    ])

    if (import.meta.env.DEV) console.log(`[⏱ explore] getMostPlayedInCircle queries: ${Date.now() - _t0}ms`)

    // Aggregate rows into { igdb_game_id, users, game_title, game_image }
    const aggregate = (rows) => {
      const byGame = new Map()
      for (const row of rows) {
        const gid  = row.entity_id
        const meta = row.metadata || {}
        if (!gid || !meta.game_image) continue
        if (!byGame.has(gid)) {
          byGame.set(gid, {
            igdb_game_id: gid,
            game_title: meta.game_title || 'Unknown Game',
            game_image: meta.game_image,
            users: new Set(),
          })
        }
        byGame.get(gid).users.add(row.actor_user_id)
      }
      return byGame
    }

    const curMap  = aggregate(curRows)
    const prevMap = aggregate(prevRows)

    // Build a rank map for the prior week (position → 1-based int)
    const prevRankMap = new Map(
      Array.from(prevMap.values())
        .sort((a, b) => b.users.size - a.users.size)
        .map((e, i) => [e.igdb_game_id, i + 1])
    )

    // Rank current week and annotate with movement
    const result = Array.from(curMap.values())
      .sort((a, b) => b.users.size - a.users.size)
      .slice(0, limit)
      .map((e, idx) => {
        const curRank  = idx + 1
        const prevRank = prevRankMap.get(e.igdb_game_id)
        let movement = 'new'
        let movement_delta = 0
        if (prevRank != null) {
          const delta = prevRank - curRank  // positive = moved up
          movement       = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same'
          movement_delta = Math.abs(delta)
        }
        return {
          igdb_game_id:   e.igdb_game_id,
          game_title:     e.game_title,
          game_image:     e.game_image,
          friend_count:   e.users.size,
          rank:           curRank,
          movement,
          movement_delta,
        }
      })

    if (import.meta.env.DEV) console.log(`[⏱ explore] getMostPlayedInCircle TOTAL: ${Date.now() - _t0}ms (${result.length} items)`)
    return result
  } catch (err) {
    console.error('[community] getMostPlayedInCircle failed:', err)
    return []
  }
}

const RATING_REVIEW_EVENT_TYPES = ['reviewed', 'rated']

/**
 * Map one `activity_events` row into a Discover "Recently" activity card.
 * Returns null for rows missing the minimum fields a card needs to render
 * (no fabricated placeholders for a missing game title/id).
 */
function _activityCardFromEvent(event) {
  const meta = event.metadata || {}
  const gameId = event.entity_id
  if (gameId == null || !meta.game_title) return null
  const actor = event.actor || {}
  return {
    id: event.id,
    type: event.type, // 'reviewed' | 'rated'
    actor: {
      id: actor.id || event.actor_user_id || null,
      username: actor.username || null,
      displayName: actor.display_name || actor.username || 'Someone',
      avatarUrl: actor.avatar_url || null,
    },
    game: {
      id: gameId,
      title: meta.game_title,
      image: meta.game_image || null,
    },
    rating: meta.rating != null ? Number(meta.rating) : null,
    reviewId: meta.review_id || null,
    hasSpoilers: !!meta.has_spoilers,
    timestamp: event.created_at ? new Date(event.created_at).getTime() : 0,
  }
}

/**
 * "Recently" — Discover's "From people you follow" activity feed.
 *
 * RATINGS + REVIEWS only (`activity_events.type IN ('reviewed','rated')`).
 * List-adds (`type = 'listed'`) are deliberately excluded — Collections
 * owns that surface.
 *
 * Never empty when the platform has ANY qualifying activity: if the
 * viewer follows no one, or their circle hasn't rated/reviewed anything
 * recently, this falls back to the broader community window so the shelf
 * always has something real to show (`scope: 'community'` in the result
 * lets the caller adjust the subtitle copy).
 *
 * Each item is annotated with `tasteMatch` — the real E0
 * `getTasteMatch(viewer, actor)` result (overall score + per-genre
 * breakdown), or `null` when the engine doesn't have enough signal for
 * that pair yet. Callers must hide the taste-match UI on `null` rather
 * than inventing a percentage. Lookups are de-duplicated per actor so a
 * followee with several recent rows only costs one RPC call.
 *
 * Both `getCircleActivityEvents` and `getRecentGlobalActivityEvents`
 * already exclude blocked users (`applyBlockFilter`) and use the explicit
 * `users!activity_events_actor_user_id_fkey` FK hint — see
 * activityEventsService.js.
 *
 * @param {number} limit
 * @returns {Promise<{ scope: 'following'|'community', items: Array }>}
 */
export async function getRecentFollowingActivity(limit = 10) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const viewerId = user?.id || null

    let scope = 'following'
    const circleRows = await getCircleActivityEvents({ limit: Math.min(100, limit * 4) })
    let rows = circleRows.filter((e) => RATING_REVIEW_EVENT_TYPES.includes(e.type))

    if (rows.length === 0) {
      scope = 'community'
      const globalRows = await getRecentGlobalActivityEvents({ limit: Math.min(50, limit * 4) })
      rows = globalRows.filter((e) => RATING_REVIEW_EVENT_TYPES.includes(e.type))
    }

    const items = rows.map(_activityCardFromEvent).filter(Boolean).slice(0, limit)
    if (items.length === 0 || !viewerId) {
      return { scope, items: items.map((it) => ({ ...it, tasteMatch: null })) }
    }

    const uniqueActorIds = Array.from(
      new Set(items.map((it) => it.actor.id).filter(Boolean))
    )
    const matchPairs = await Promise.all(
      uniqueActorIds.map(async (actorId) => [actorId, await getTasteMatch(viewerId, actorId)])
    )
    const matchByActor = new Map(matchPairs)

    return {
      scope,
      items: items.map((it) => ({
        ...it,
        tasteMatch: it.actor.id ? matchByActor.get(it.actor.id) || null : null,
      })),
    }
  } catch (err) {
    console.error('[community] getRecentFollowingActivity failed:', err)
    return { scope: 'following', items: [] }
  }
}

/**
 * Community Pulse for a single game — all three circle-scoped signals
 * needed by GameDetail's "Community Pulse" section.
 *
 * Returns:
 *   circleAvgRating   — mean rating from followed users' reviews, or null
 *   circleRatingCount — number of circle members who rated this game
 *   activePresence    — followed users currently status='playing'
 *   circleRank        — 1-based rank of this game by circle member count,
 *                       null when < 3 games tracked (rank would be meaningless)
 *   circleTotalGames  — distinct games tracked by circle (rank denominator)
 *
 * All three sub-sections hide when their slice is empty, so the whole
 * block disappears for games the circle hasn't touched.
 *
 * FK hints used explicitly:
 *   game_trackers → users : game_trackers_user_id_fkey
 */
export async function getCirclePulseForGame(igdbGameId) {
  const EMPTY = {
    circleAvgRating: null,
    circleRatingCount: 0,
    activePresence: [],
    circleRank: null,
    circleTotalGames: 0,
  }
  try {
    const followeeIds = await _getCurrentUserFollowees()
    if (followeeIds.length === 0) return EMPTY

    const gameIdNum = Number(igdbGameId)

    const [reviewsRes, presenceRes, allTrackersRes] = await Promise.all([
      // Circle reviews for this game — rating column only
      supabase
        .from('reviews')
        .select('rating')
        .in('user_id', followeeIds)
        .eq('igdb_game_id', gameIdNum),

      // Followed users actively playing this game right now
      supabase
        .from('game_trackers')
        .select(
          'user_id, users!game_trackers_user_id_fkey(username, display_name, avatar_url)'
        )
        .in('user_id', followeeIds)
        .eq('igdb_game_id', gameIdNum)
        .eq('status', 'playing'),

      // All (game_id, user_id) pairs tracked by circle — for rank computation
      supabase
        .from('game_trackers')
        .select('igdb_game_id, user_id')
        .in('user_id', followeeIds),
    ])

    // ── Circle avg rating ───────────────────────────────────────────────────
    const circleReviews = reviewsRes.data || []
    const circleRatingCount = circleReviews.length
    let circleAvgRating = null
    if (circleRatingCount > 0) {
      const sum = circleReviews.reduce((acc, r) => acc + Number(r.rating), 0)
      circleAvgRating = Math.round((sum / circleRatingCount) * 10) / 10
    }

    // ── Active presence ─────────────────────────────────────────────────────
    const presenceRows = presenceRes.data || []
    const activePresence = presenceRows
      .map((row) => ({
        userId: row.user_id,
        username: row.users?.username || null,
        displayName: row.users?.display_name || row.users?.username || 'Player',
        avatarUrl: row.users?.avatar_url || null,
      }))
      .slice(0, 7)

    // ── Circle rank ─────────────────────────────────────────────────────────
    // Count distinct circle members per game, then rank by that count.
    const allTrackers = allTrackersRes.data || []
    const membersByGame = new Map()
    for (const t of allTrackers) {
      const key = String(t.igdb_game_id)
      if (!membersByGame.has(key)) membersByGame.set(key, new Set())
      membersByGame.get(key).add(t.user_id)
    }

    const circleTotalGames = membersByGame.size
    let circleRank = null
    const thisKey = String(gameIdNum)
    if (membersByGame.has(thisKey) && circleTotalGames >= 3) {
      const thisCount = membersByGame.get(thisKey).size
      let rank = 1
      for (const [key, members] of membersByGame) {
        if (key !== thisKey && members.size > thisCount) rank++
      }
      circleRank = rank
    }

    return { circleAvgRating, circleRatingCount, activePresence, circleRank, circleTotalGames }
  } catch (err) {
    console.error('[community] getCirclePulseForGame failed:', err)
    return EMPTY
  }
}

/**
 * "From people you follow" row for GameDetail — followed users who rated
 * (reviewed) this specific game, for the community strip rendered directly
 * above the Top Reviews list.
 *
 * Distinct from `getCirclePulseForGame`, which only returns an aggregate
 * average + count for the "Your Circle" block — this returns per-user
 * name/avatar info so the row can render stacked avatars plus the sentence
 * "{name}, {name} and {N} others you follow rated this — avg {X.X}★".
 * Ordered by most recent rating first, so the named users are the two most
 * recent followed raters.
 *
 * FK hint used explicitly: reviews → users : reviews_user_id_fkey
 *
 * RLS (`reviews_select_visible`, see
 * supabase/migrations/20260704221500_home_feed_reviews_trackers_rls.sql)
 * already restricts the rows returned here to ones the viewer is allowed
 * to see — a followed author's review only surfaces when their
 * activity_privacy is 'everyone', or 'followers' (which the viewer
 * satisfies by definition, since we only ever query followee ids), minus
 * any blocked relationship. `applyBlockFilter` is layered on top as
 * defense-in-depth, same as every other read in this file.
 *
 * @param {number|string} igdbGameId
 * @returns {Promise<{
 *   average: number|null,
 *   count: number,
 *   followers: Array<{ userId: string, username: string|null, displayName: string, avatarUrl: string|null, rating: number }>
 * }>}
 * Returns { average: null, count: 0, followers: [] } when the viewer
 * follows no one, or none of them have rated this game — the caller hides
 * the entire row on that shape.
 */
export async function getFollowedRatingsForGame(igdbGameId) {
  const EMPTY = { average: null, count: 0, followers: [] }
  try {
    const followeeIds = await _getCurrentUserFollowees()
    if (followeeIds.length === 0) return EMPTY

    const gameIdNum = Number(igdbGameId)

    let q = supabase
      .from('reviews')
      .select(
        'user_id, rating, created_at, users!reviews_user_id_fkey(id, username, display_name, avatar_url)'
      )
      .in('user_id', followeeIds)
      .eq('igdb_game_id', gameIdNum)
      .order('created_at', { ascending: false })
    q = await applyBlockFilter(q, 'user_id')
    const { data, error } = await q
    if (error) {
      console.error('[community] getFollowedRatingsForGame failed:', error.message)
      return EMPTY
    }

    const rows = data || []
    if (rows.length === 0) return EMPTY

    const sum = rows.reduce((acc, r) => acc + Number(r.rating), 0)
    const average = Math.round((sum / rows.length) * 10) / 10

    const followers = rows.map((r) => ({
      userId: r.user_id,
      username: r.users?.username || null,
      displayName: r.users?.display_name || r.users?.username || 'Player',
      avatarUrl: r.users?.avatar_url || null,
      rating: Number(r.rating),
    }))

    return { average, count: followers.length, followers }
  } catch (err) {
    console.error('[community] getFollowedRatingsForGame crashed:', err)
    return EMPTY
  }
}

/**
 * Home feed — "The pulse", the unified community activity feed.
 *
 * Distinct from `getRecentFollowingActivity` (Explore's "Recently" shelf,
 * which sources `activity_events` and annotates each item with a
 * taste-match strip). `getHomeFeed` never carries a `tasteMatch` field —
 * that stays exclusive to Explore.
 *
 * DIAGNOSIS (pre-broadening): every OTHER user's row here came from the
 * `reviews` table only, via `_fetchHomeFeedReviewRows` — i.e. written
 * reviews and bare star ratings, and nothing else. `activity_events`
 * (Pulse/F1) has carried a much richer type set from day one — played,
 * rated, reviewed, favorited, listed, started, completed, dropped,
 * goal_hit, backlogged (see supabase/activity_events.sql +
 * activityEventsService.ACTIVITY_EVENT_TYPES) — but only the VIEWER'S OWN
 * listed/completed/backlogged rows were ever read out of it here; other
 * users' non-review activity (finished a game, started a game, logged a
 * session) never surfaced on Home at all. This function now unions both
 * sources for every user, not just the viewer.
 *
 * Sources merged into one recency-ordered stream, for EVERY user
 * (viewer + everyone else) alike:
 *   1. `reviews` rows — a mandatory `rating` (0.5–5.0) on every row, with
 *      an empty `body` being the "rated without writing a review" case
 *      (`type: 'rated'`) and a non-empty `body` being `type: 'reviewed'`.
 *      `game_trackers.rating` is a second, currently-unused rating
 *      surface (finished-game ratings with no UI to set them yet) — not
 *      included here since it has no relevant rows to surface.
 *   2. `activity_events` rows of type 'started' | 'completed' | 'listed' |
 *      'played' | 'journaled' (see OTHER_FEED_EVENT_TYPES /
 *      OWN_FEED_EVENT_TYPES) — "started a game", "finished a game"
 *      (rendered as `type: 'finished'`), "added a game/created a list",
 *      "logged a session", and "added a journal entry" respectively.
 *      'backlogged' stays own-only (see OWN_FEED_EVENT_TYPES's comment);
 *      'dropped' / 'favorited' / 'goal_hit' stay Explore/Profile-only —
 *      out of scope for this pass.
 *
 * Scope selection (first page only — `cursor == null && scope == null`)
 * looks at BOTH sources combined (reviews + activity_events) so a viewer
 * whose follows only log sessions and never write reviews doesn't get
 * mis-classified as "quiet":
 *   - No follows at all                 → 'community'
 *   - Follows, but fewer than
 *     HOME_FEED_SPARSE_THRESHOLD
 *     combined recent rows from them    → 'mixed' (follow rows + a
 *                                          non-followee community fill,
 *                                          merged newest-first) — this is
 *                                          the community fallback that
 *                                          keeps the feed from ever being
 *                                          an empty island when follows
 *                                          are quiet.
 *   - Follows with enough activity      → 'following'
 * The caller should pass the `scope` it got back on every subsequent
 * `loadMore` call so pagination keeps reading from the same source(s)
 * instead of re-deciding scope on every page (see useHomeFeed.js).
 * NOTE: this scope decision is about OTHER users' rows only — see
 * "Own activity" below for the viewer's own stream, which is merged in
 * on top regardless of scope.
 *
 * Own activity (Home-is-the-hub sprint) — the viewer's own reviewed/
 * rated/started/listed/finished/played/backlogged rows are fetched
 * unconditionally (own `reviews` rows via the same
 * `_fetchHomeFeedReviewRows` helper, plus own `activity_events` rows —
 * see OWN_FEED_EVENT_TYPES) and merged into the exact same
 * recency-sorted stream as everyone else's items, via
 * `_interleaveOwnWithCap`. Each returned item carries `isOwn: true`
 * when it's the viewer's; HomeReviewCard uses that to render
 * second-person wording and hide (but not remove) the like control.
 * Own items are capped at ~1-in-3 consecutive slots whenever another
 * item is available to fill that slot instead — see
 * `_interleaveOwnWithCap`'s doc comment — so a very active viewer can't
 * bury their circle's activity, but an active viewer with a quiet
 * circle still sees their own activity rather than an empty feed.
 *
 * Block + privacy enforcement: RLS on `reviews` (see
 * supabase/migrations/20260704221500_home_feed_reviews_trackers_rls.sql)
 * and on `activity_events` (see supabase/activity_events.sql +
 * supabase/migrations/20260704222500_home_feed_activity_events_block_rls.sql)
 * already restricts every row returned here to ones the viewer is
 * allowed to see — and both policies explicitly always allow
 * `auth.uid() = <author column>`, so the viewer's own rows are never
 * blocked by their own privacy setting. `applyBlockFilter` is layered
 * on top as defense-in-depth, same as every other read in this file
 * (now applied to the `activity_events` fetch too, keyed on
 * `actor_user_id`); it's a no-op on the viewer's own-row reads (you
 * can't block yourself), same as everywhere else. The `activity_events`
 * fetch also disambiguates its actor join with the explicit FK hint
 * `users!activity_events_actor_user_id_fkey` (same hint
 * activityEventsService.js already uses), since `actor_user_id` isn't
 * the only FK Postgres could otherwise guess from.
 *
 * @param {{ cursor?: string|null, scope?: 'following'|'community'|'mixed'|null, limit?: number }} opts
 * @returns {Promise<{
 *   items: Array<{
 *     id: string,
 *     type: 'reviewed'|'rated'|'listed'|'finished'|'started'|'played'|'backlogged',
 *     isOwn: boolean,
 *     createdAt: string,
 *     author: { id: string|null, username: string|null, displayName: string, avatarUrl: string|null },
 *     game: { id: number|string, title: string, image: string|null }|null,
 *     likeCount: number,
 *     commentCount: number,
 *     body?: string,
 *     rating?: number|null,
 *     hasSpoilers?: boolean,
 *     listKind?: 'created'|'added',
 *     listId?: string|null,
 *     listName?: string|null,
 *     durationSeconds?: number|null,
 *     reactionTargetId?: string,
 *   }>,
 *   nextCursor: string|null,
 *   scope: 'following'|'community'|'mixed',
 *   hasMore: boolean,
 * }>}
 */
const HOME_FEED_PAGE_SIZE = 15
const HOME_FEED_SPARSE_THRESHOLD = 5

// Own-activity event types surfaced on Home, sourced from `activity_events`
// (reviewed/rated own rows come from `reviews` instead — see
// _fetchHomeFeedReviewRows). Deliberately narrower than every type Pulse
// logs: 'dropped'/'favorited'/'goal_hit' stay Explore/Profile-only per
// this sprint's spec.
//   'listed'     → metadata.kind 'list_created' (created a list) or
//                  'game_added_to_list' (added a game to a list)
//   'completed'  → rendered as HomeReviewCard's 'finished' type
//   'backlogged' → added to the Want to Play backlog (see
//                  libraryService.STATUS_TO_EVENT_TYPE) — also surfaced
//                  for other users now, see OTHER_FEED_EVENT_TYPES below
//   'started'    → moved a game to Currently Playing
//   'played'     → logged a play session (sessionService.js)
//   'journaled'  → wrote a journal entry (journalService.js) — see
//                  supabase/migrations/20260729140000_activity_events_journaled_type.sql
const OWN_FEED_EVENT_TYPES = ['listed', 'completed', 'backlogged', 'started', 'played', 'journaled']

// Other-users' event types surfaced on Home (Pulse broadening — task:
// "logged a session, logged/added a game, finished a game, started a
// game, rated a game, reviewed, added to a list"). 'rated'/'reviewed'
// come from the `reviews` table, not this list. 'backlogged' ("logged/
// added a game") WAS own-only in an earlier pass (the reasoning being
// "not circle-worthy from someone else") but the broadening task
// explicitly calls for other users' backlog adds to render too (e.g.
// "justin added Left 4 Dead 2 to his backlog") — included below.
// Deliberately still excludes 'dropped'/'favorited'/'goal_hit'
// (Explore/Profile-only, out of scope for this pass).
// 'journaled' added by the emit-events-for-every-action sprint — journal
// entries previously never surfaced on Home at all (own or others').
const OTHER_FEED_EVENT_TYPES = ['listed', 'completed', 'started', 'played', 'backlogged', 'journaled']

/**
 * Soft-cap interleave: merges two recency-sorted item arrays (the
 * viewer's own activity + everyone else's) into one recency-ordered
 * stream, deferring an own item whenever taking it next would put an
 * own item in 2 of the last 3 emitted slots AND another (non-own) item
 * is available to take that slot instead. Once the "other" queue runs
 * dry the cap stops applying — an all-own feed beats an empty one, per
 * spec ("the cap is a ceiling, not a quota").
 *
 * Never drops an item: a capped own item just waits for its next turn
 * and stays in relative recency order among own items.
 */
function _interleaveOwnWithCap(ownItems, otherItems, limit) {
  const result = []
  const recentOwnFlags = []
  let oi = 0
  let ti = 0
  while (result.length < limit && (oi < ownItems.length || ti < otherItems.length)) {
    const own = ownItems[oi]
    const other = otherItems[ti]
    let takeOwn = !!own && (!other || new Date(own.createdAt) >= new Date(other.createdAt))
    if (takeOwn && other) {
      const cappedByRecentWindow = recentOwnFlags.filter(Boolean).length >= 1
      if (cappedByRecentWindow) takeOwn = false
    }
    if (takeOwn) {
      result.push(own)
      oi++
      recentOwnFlags.push(true)
    } else if (other) {
      result.push(other)
      ti++
      recentOwnFlags.push(false)
    } else if (own) {
      // Other queue is dry — cap no longer applies.
      result.push(own)
      oi++
      recentOwnFlags.push(true)
    } else {
      break
    }
    if (recentOwnFlags.length > 2) recentOwnFlags.shift()
  }
  return result
}

async function _fetchHomeFeedReviewRows({ userIds = null, excludeUserIds = [], cursor = null, limit }) {
  try {
    let q = supabase
      .from('reviews')
      .select(
        'id, user_id, igdb_game_id, body, rating, has_spoilers, game_title, game_image, created_at, ' +
          'users!reviews_user_id_fkey(id, username, display_name, avatar_url)'
      )
      .order('created_at', { ascending: false })
      .limit(limit)
    if (userIds) q = q.in('user_id', userIds)
    if (excludeUserIds.length) q = q.not('user_id', 'in', `(${excludeUserIds.join(',')})`)
    if (cursor) q = q.lt('created_at', cursor)
    q = await applyBlockFilter(q, 'user_id')
    const { data, error } = await q
    if (error) {
      console.error('[community] getHomeFeed page query failed:', error.message)
      return []
    }
    return data || []
  } catch (err) {
    console.error('[community] getHomeFeed page query crashed:', err)
    return []
  }
}

// Generic newest-first merge, used both for two windows of `reviews` rows
// and for two windows of `activity_events` rows (both shapes carry
// `created_at`) — e.g. merging a followee window with a community-fill
// window before slicing to page size. Merging two independently-cursored
// windows can in rare cases skip a row that would have surfaced on a
// later page — an accepted trade-off, consistent with the client-side
// windowing this file already does elsewhere (e.g. _aggregateToMap,
// weaveForYouItems).
function _mergeRowsByRecency(a, b) {
  return [...a, ...b].sort((x, y) => new Date(y.created_at) - new Date(x.created_at))
}

function _homeFeedItemFromRow(row, likeCounts, commentCounts, { isOwn = false } = {}) {
  const u = row.users || {}
  const body = (row.body || '').trim()
  return {
    id: row.id,
    type: body ? 'reviewed' : 'rated',
    isOwn,
    body,
    rating: row.rating != null ? Number(row.rating) : null,
    hasSpoilers: !!row.has_spoilers,
    createdAt: row.created_at,
    author: {
      id: row.user_id || u.id || null,
      username: u.username || null,
      displayName: u.display_name || u.username || 'Player',
      avatarUrl: u.avatar_url || null,
    },
    game: {
      id: row.igdb_game_id,
      title: row.game_title || 'Unknown Game',
      image: row.game_image || null,
    },
    likeCount: likeCounts.get(row.id) || 0,
    commentCount: commentCounts.get(row.id) || 0,
  }
}

/**
 * Shape a single `reviews` row into the same Home feed item
 * `getHomeFeed` produces, for surfaces that already hold the row and
 * just need the canonical `<HomeReviewCard item={...}/>` shape — today
 * that's the review-comments thread header
 * (`/reviews/:reviewId/comments`), which is the review-side twin of
 * what getActivityEventForCard does for `/activity/:activityId/comments`.
 *
 * Counts are passed as plain numbers here (the feed's Map-based batch
 * lookups exist for pages of rows; a single row has nothing to batch).
 *
 * @param {object|null} row  a `reviews` row joined with the reviewer's
 *   user fields — e.g. reviewService.getReviewById's return value
 * @returns {object|null} same item shape as getHomeFeed's review items
 */
export function homeFeedItemFromReviewRow(
  row,
  { likeCount = 0, commentCount = 0, isOwn = false } = {}
) {
  if (!row) return null
  return _homeFeedItemFromRow(
    row,
    new Map([[row.id, likeCount]]),
    new Map([[row.id, commentCount]]),
    { isOwn }
  )
}

/**
 * Fetch a page of `activity_events` rows of the given `types`, scoped to
 * either a specific set of actors (`userIds` — followees, or `[viewerId]`
 * for the own-activity fetch) or every actor EXCEPT a set (`excludeUserIds`
 * — community scope). Mirrors `_fetchHomeFeedReviewRows`'s shape/contract
 * exactly (same cursor semantics, same soft-fail-to-[] convention) so both
 * can be merged/paginated identically.
 *
 * Always joins the actor profile via the explicit FK hint
 * `users!activity_events_actor_user_id_fkey` (same hint
 * activityEventsService.js uses) — needed for other-users' rows so the
 * card can render an avatar/name without a second round-trip; harmless
 * (if unused) on the own-activity fetch, which already has the viewer's
 * profile from elsewhere.
 *
 * Fails soft to [] (same convention as every other read in this file) —
 * the most likely failure mode is a newer enum value's migration not
 * having been run yet in this environment (e.g.
 * supabase/migrations/20260704222000_activity_events_backlogged_type.sql),
 * which would otherwise take down the whole Home feed rather than just
 * quietly omitting these rows.
 */
async function _fetchHomeFeedEventRows({
  types,
  userIds = null,
  excludeUserIds = [],
  cursor = null,
  limit,
}) {
  try {
    let q = supabase
      .from('activity_events')
      .select(
        'id, actor_user_id, type, entity_id, metadata, created_at,' +
          ' actor:users!activity_events_actor_user_id_fkey(id, username, display_name, avatar_url)'
      )
      .in('type', types)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (userIds) q = q.in('actor_user_id', userIds)
    if (excludeUserIds.length) q = q.not('actor_user_id', 'in', `(${excludeUserIds.join(',')})`)
    if (cursor) q = q.lt('created_at', cursor)
    q = await applyBlockFilter(q, 'actor_user_id')
    const { data, error } = await q
    if (error) {
      console.error('[community] getHomeFeed activity_events query failed:', error.message)
      return []
    }
    return data || []
  } catch (err) {
    console.error('[community] getHomeFeed activity_events query crashed:', err)
    return []
  }
}

/**
 * Returns the joined `actor` row (see `_fetchHomeFeedEventRows`'s select)
 * shaped into the same author object `_homeFeedItemFromRow` produces, so
 * HomeReviewCard never has to know which source an item came from.
 */
function _authorFromActorJoin(actor) {
  const a = actor || {}
  return {
    id: a.id || null,
    username: a.username || null,
    displayName: a.display_name || a.username || 'Player',
    avatarUrl: a.avatar_url || null,
  }
}

/**
 * Shape one `activity_events` row (own OR another user's) into a Home
 * feed item. Mirrors _homeFeedItemFromRow's item shape so HomeReviewCard's
 * single switch-on-type render path keeps working unmodified for every
 * type. For own rows, `viewerAuthor` (the viewer's own profile, fetched
 * once per getHomeFeed call, not per row) is used; for everyone else's
 * rows, the author comes from the row's joined `actor` field.
 *
 * 'listed' rows fork on metadata.kind:
 *   - 'list_created' has no specific game — `game: null`, `listName`
 *     comes straight from metadata (no round-trip needed).
 *   - 'game_added_to_list' has a game but metadata never carries
 *     list_name (see listService.addGameToList) — `listName` stays
 *     unset here so HomeReviewCard's existing useListPreview(listId)
 *     lazy-hydration fills it in card-side, same as it already does for
 *     any 'listed' row.
 *
 * 'played' carries `durationSeconds` from metadata.seconds (written by
 * sessionService.applySessionSideEffects) so HomeReviewCard's headerVerb
 * can render "logged 2h 30m" — omitted (not zero) when the writer didn't
 * supply it, same never-fabricate convention as everywhere else in this
 * file.
 *
 * `commentCounts` — a Map<activityEventId, number> from
 * getCommentCountsForEvents (see the Pulse comment-broadening work in
 * commentService.js) — every non-review card is now first-class
 * commentable, same as a review, so this can no longer be hardcoded to
 * 0 the way it was before comments became polymorphic.
 */
function _homeFeedItemFromEventRow(row, { isOwn, viewerAuthor = null, commentCounts = null } = {}) {
  const meta = row.metadata || {}
  const author = isOwn ? viewerAuthor : _authorFromActorJoin(row.actor)
  const base = {
    id: row.id,
    createdAt: row.created_at,
    isOwn,
    author,
    likeCount: 0,
    commentCount: commentCounts ? commentCounts.get(row.id) || 0 : 0,
    reactionTargetId: row.id,
  }

  if (row.type === 'listed') {
    if (meta.kind === 'list_created') {
      return {
        ...base,
        type: 'listed',
        listKind: 'created',
        listId: row.entity_id,
        listName: meta.list_name || null,
        game: null,
      }
    }
    return {
      ...base,
      type: 'listed',
      listKind: 'added',
      listId: meta.list_id || null,
      game: {
        id: row.entity_id,
        title: meta.game_title || 'Unknown Game',
        image: meta.game_image || null,
      },
    }
  }

  if (row.type === 'completed') {
    return {
      ...base,
      type: 'finished',
      game: {
        id: row.entity_id,
        title: meta.game_title || 'Unknown Game',
        image: meta.game_image || null,
      },
    }
  }

  if (row.type === 'started') {
    return {
      ...base,
      type: 'started',
      game: {
        id: row.entity_id,
        title: meta.game_title || 'Unknown Game',
        image: meta.game_image || null,
      },
    }
  }

  if (row.type === 'played') {
    const seconds = Number(meta.seconds)
    return {
      ...base,
      type: 'played',
      durationSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
      game: {
        id: row.entity_id,
        title: meta.game_title || 'Unknown Game',
        image: meta.game_image || null,
      },
    }
  }

  if (row.type === 'journaled') {
    return {
      ...base,
      type: 'journaled',
      mood: meta.mood || null,
      game: {
        id: row.entity_id,
        title: meta.game_title || 'Unknown Game',
        image: meta.game_image || null,
      },
    }
  }

  // 'backlogged' plus a generic fallback for any other real
  // activity_events type (dropped/favorited/goal_hit/reviewed) that
  // isn't feed-eligible today but could still be looked up directly by
  // id (e.g. getActivityEventForCard, which fetches by id with no
  // `type IN (...)` filter) — HomeReviewCard's headerVerb already
  // degrades an unrecognized `type` gracefully ("did something") rather
  // than mislabeling it, so this is never silently wrong.
  return {
    ...base,
    type: row.type === 'backlogged' ? 'backlogged' : row.type,
    game: {
      id: row.entity_id,
      title: meta.game_title || 'Unknown Game',
      image: meta.game_image || null,
    },
  }
}

/**
 * Fetch + shape a single `activity_events` row into the exact same
 * item shape `getHomeFeed` produces, for the activity-comments thread
 * page (`/activity/:activityId/comments`) to render via
 * `<HomeReviewCard item={...}/>` at the top of the thread — the same
 * card the viewer tapped into from the feed, so the header/content
 * reads identically instead of a bespoke summary being built twice.
 *
 * Mirrors reviewService.getReviewById's contract (soft-fails to null,
 * same block-filter pass) but needs one extra step reviews don't: the
 * viewer's own profile lookup for `isOwn` rows, same as getHomeFeed
 * does for the feed page itself.
 *
 * @param {string} activityEventId
 * @returns {Promise<object|null>} same item shape as getHomeFeed's
 *   non-review items (see _homeFeedItemFromEventRow)
 */
export async function getActivityEventForCard(activityEventId) {
  if (!activityEventId) return null
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const viewerId = user?.id || null

    let q = supabase
      .from('activity_events')
      .select(
        'id, actor_user_id, type, entity_id, metadata, created_at,' +
          ' actor:users!activity_events_actor_user_id_fkey(id, username, display_name, avatar_url)'
      )
      .eq('id', activityEventId)
      .maybeSingle()
    q = await applyBlockFilter(q, 'actor_user_id')
    const { data: row, error } = await q
    if (error) {
      console.error('[community] getActivityEventForCard failed:', error.message)
      return null
    }
    if (!row) return null

    const isOwn = !!viewerId && row.actor_user_id === viewerId
    let viewerAuthor = null
    if (isOwn) {
      const { data: viewerProfile } = await supabase
        .from('users')
        .select('id, username, display_name, avatar_url')
        .eq('id', viewerId)
        .single()
      viewerAuthor = {
        id: viewerId,
        username: viewerProfile?.username || null,
        displayName: viewerProfile?.display_name || viewerProfile?.username || 'You',
        avatarUrl: viewerProfile?.avatar_url || null,
      }
    }

    const commentCounts = await getCommentCountsForEvents([row.id])
    return _homeFeedItemFromEventRow(row, { isOwn, viewerAuthor, commentCounts })
  } catch (err) {
    console.error('[community] getActivityEventForCard crashed:', err)
    return null
  }
}

export async function getHomeFeed({ cursor = null, scope = null, limit = HOME_FEED_PAGE_SIZE } = {}) {
  const _t0 = Date.now()
  const EMPTY = (fallbackScope) => ({ items: [], nextCursor: null, scope: fallbackScope, hasMore: false })
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const viewerId = user?.id || null
    if (!viewerId) return EMPTY('community')

    const followeeIds = await _getCurrentUserFollowees()
    let effectiveScope = scope
    // "Other users'" rows for this page, split by source — kept separate
    // (rather than merged into one opaque array) because each source
    // shapes into an item differently (_homeFeedItemFromRow vs
    // _homeFeedItemFromEventRow) — see the shaping step below.
    let otherReviewRows = []
    let otherEventRows = []

    if (effectiveScope === 'following') {
      ;[otherReviewRows, otherEventRows] = followeeIds.length
        ? await Promise.all([
            _fetchHomeFeedReviewRows({ userIds: followeeIds, cursor, limit }),
            _fetchHomeFeedEventRows({
              types: OTHER_FEED_EVENT_TYPES,
              userIds: followeeIds,
              cursor,
              limit,
            }),
          ])
        : [[], []]
    } else if (effectiveScope === 'community') {
      ;[otherReviewRows, otherEventRows] = await Promise.all([
        _fetchHomeFeedReviewRows({ excludeUserIds: [viewerId], cursor, limit }),
        _fetchHomeFeedEventRows({
          types: OTHER_FEED_EVENT_TYPES,
          excludeUserIds: [viewerId],
          cursor,
          limit,
        }),
      ])
    } else if (effectiveScope === 'mixed') {
      const [followReviewRows, communityReviewRows, followEventRows, communityEventRows] =
        await Promise.all([
          followeeIds.length
            ? _fetchHomeFeedReviewRows({ userIds: followeeIds, cursor, limit })
            : [],
          _fetchHomeFeedReviewRows({
            excludeUserIds: [...followeeIds, viewerId],
            cursor,
            limit,
          }),
          followeeIds.length
            ? _fetchHomeFeedEventRows({
                types: OTHER_FEED_EVENT_TYPES,
                userIds: followeeIds,
                cursor,
                limit,
              })
            : [],
          _fetchHomeFeedEventRows({
            types: OTHER_FEED_EVENT_TYPES,
            excludeUserIds: [...followeeIds, viewerId],
            cursor,
            limit,
          }),
        ])
      // Merging two independently-cursored windows can in rare cases skip a
      // row that would have surfaced on a later page (see note above) — an
      // accepted trade-off, consistent with the client-side windowing this
      // file already does elsewhere (e.g. _aggregateToMap, weaveForYouItems).
      otherReviewRows = _mergeRowsByRecency(followReviewRows, communityReviewRows).slice(0, limit)
      otherEventRows = _mergeRowsByRecency(followEventRows, communityEventRows).slice(0, limit)
    } else {
      // First page — decide scope. The sparse-follow check now looks at
      // BOTH sources combined so a viewer whose follows only log sessions
      // or start games (never write reviews) doesn't get mis-classified
      // as having a "quiet" circle — this is the community fallback that
      // keeps the feed from ever being an empty island.
      if (followeeIds.length === 0) {
        effectiveScope = 'community'
        ;[otherReviewRows, otherEventRows] = await Promise.all([
          _fetchHomeFeedReviewRows({ excludeUserIds: [viewerId], limit }),
          _fetchHomeFeedEventRows({
            types: OTHER_FEED_EVENT_TYPES,
            excludeUserIds: [viewerId],
            limit,
          }),
        ])
      } else {
        const [followReviewRows, followEventRows] = await Promise.all([
          _fetchHomeFeedReviewRows({ userIds: followeeIds, limit }),
          _fetchHomeFeedEventRows({ types: OTHER_FEED_EVENT_TYPES, userIds: followeeIds, limit }),
        ])
        if (followReviewRows.length + followEventRows.length >= HOME_FEED_SPARSE_THRESHOLD) {
          effectiveScope = 'following'
          otherReviewRows = followReviewRows
          otherEventRows = followEventRows
        } else {
          effectiveScope = 'mixed'
          const [communityReviewRows, communityEventRows] = await Promise.all([
            _fetchHomeFeedReviewRows({ excludeUserIds: [...followeeIds, viewerId], limit }),
            _fetchHomeFeedEventRows({
              types: OTHER_FEED_EVENT_TYPES,
              excludeUserIds: [...followeeIds, viewerId],
              limit,
            }),
          ])
          otherReviewRows = _mergeRowsByRecency(followReviewRows, communityReviewRows).slice(
            0,
            limit
          )
          otherEventRows = _mergeRowsByRecency(followEventRows, communityEventRows).slice(
            0,
            limit
          )
        }
      }
    }

    // Own activity — merged into the SAME stream regardless of scope
    // (see module doc comment). Fetched independently of the
    // followee-vs-community decision above: it's "Home is the hub", not
    // a 4th scope.
    const [ownReviewRows, ownEventRows] = await Promise.all([
      _fetchHomeFeedReviewRows({ userIds: [viewerId], cursor, limit }),
      _fetchHomeFeedEventRows({ types: OWN_FEED_EVENT_TYPES, userIds: [viewerId], cursor, limit }),
    ])

    if (import.meta.env.DEV) console.log(`[⏱ home] getHomeFeed scope=${effectiveScope} query: ${Date.now() - _t0}ms`)

    if (
      otherReviewRows.length === 0 &&
      otherEventRows.length === 0 &&
      ownReviewRows.length === 0 &&
      ownEventRows.length === 0
    ) {
      return EMPTY(effectiveScope)
    }

    const flaggedIds = await getFlaggedContentIds('review')
    const allReviewRows = [...otherReviewRows, ...ownReviewRows]
    const cleanReviewRows =
      flaggedIds.size > 0 ? allReviewRows.filter((r) => !flaggedIds.has(r.id)) : allReviewRows

    const reviewIds = cleanReviewRows.map((r) => r.id)
    const [likeCounts, commentCounts] = await Promise.all([
      getLikeCountsForReviews(reviewIds),
      getCommentCountsForReviews(reviewIds),
    ])

    const shapedReviewItems = cleanReviewRows.map((row) =>
      _homeFeedItemFromRow(row, likeCounts, commentCounts, { isOwn: row.user_id === viewerId })
    )
    const otherReviewItems = shapedReviewItems.filter((it) => !it.isOwn)
    const ownReviewItems = shapedReviewItems.filter((it) => it.isOwn)

    // Own non-review activity needs the viewer's own profile for the
    // author avatar/name — one lightweight lookup per call (skipped
    // entirely when there's nothing to attach it to). Other users'
    // activity_events rows already carry their author via the actor join
    // (see _fetchHomeFeedEventRows / _authorFromActorJoin) — no extra
    // round-trip needed for those.
    let viewerAuthor = null
    if (ownEventRows.length > 0) {
      const { data: viewerProfile } = await supabase
        .from('users')
        .select('id, username, display_name, avatar_url')
        .eq('id', viewerId)
        .single()
      viewerAuthor = {
        id: viewerId,
        username: viewerProfile?.username || null,
        displayName: viewerProfile?.display_name || viewerProfile?.username || 'You',
        avatarUrl: viewerProfile?.avatar_url || null,
      }
    }
    const allEventIds = [...otherEventRows, ...ownEventRows].map((row) => row.id)
    const eventCommentCounts = await getCommentCountsForEvents(allEventIds)

    const otherEventItems = otherEventRows.map((row) =>
      _homeFeedItemFromEventRow(row, { isOwn: false, commentCounts: eventCommentCounts })
    )
    const ownEventItems = ownEventRows.map((row) =>
      _homeFeedItemFromEventRow(row, { isOwn: true, viewerAuthor, commentCounts: eventCommentCounts })
    )

    const otherItems = [...otherReviewItems, ...otherEventItems].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    )
    const ownItems = [...ownReviewItems, ...ownEventItems].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    )

    const items = _interleaveOwnWithCap(ownItems, otherItems, limit)

    // A source might still have more beyond this page even if this exact
    // combined page came back short (e.g. own rows deferred by the cap,
    // or flagged-content filtering trimmed a review out) — treat any
    // full-size raw fetch as "there's more".
    const hasMore =
      otherReviewRows.length === limit ||
      otherEventRows.length === limit ||
      ownReviewRows.length === limit ||
      ownEventRows.length === limit

    // Next cursor = the oldest timestamp seen across every raw source
    // this page touched, so loadMore never skips a row a deferred/
    // filtered item left behind. Can reproduce a small number of
    // already-seen ids on the next page in rare cases; useHomeFeed's
    // loadMore already dedupes by id — same accepted trade-off as the
    // mixed-scope merge above.
    const tails = [otherReviewRows, otherEventRows, ownReviewRows, ownEventRows]
      .filter((arr) => arr.length)
      .map((arr) => arr[arr.length - 1].created_at)
    const nextCursor =
      hasMore && tails.length
        ? tails.reduce((oldest, t) => (new Date(t) < new Date(oldest) ? t : oldest))
        : null

    if (import.meta.env.DEV) {
      console.log(
        `[⏱ home] getHomeFeed scope=${effectiveScope} TOTAL: ${Date.now() - _t0}ms ` +
          `(${items.length} items, ${ownItems.length} own)`
      )
    }

    return { items, nextCursor, scope: effectiveScope, hasMore }
  } catch (err) {
    console.error('[community] getHomeFeed failed:', err)
    return EMPTY(scope || 'community')
  }
}

export { WEEK_MS }


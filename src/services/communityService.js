import { supabase } from './supabase'
import { applyBlockFilter } from './blockService'
import { getRecentCommunityReviews } from './reviewService'
import { getGamesByIds, getGamesByGenre } from './igdb'

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

export { WEEK_MS }
export { getTrendingCircle, getTrendingByGenre }

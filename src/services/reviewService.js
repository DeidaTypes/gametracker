import { supabase } from './supabase'
import { logActivity } from './activityService'
import {
  ACTIVITY_EVENT_TYPES,
  logActivityEvent,
} from './activityEventsService'
import { applyBlockFilter } from './blockService'
import { getFlaggedContentIds } from './reportService'
import { getLikeCountsForReviews } from './likeService'
import { dedupeInFlight } from './swrCache'

/**
 * Review Service — Supabase-backed.
 *
 * Schema (matches BACKEND_SCHEMA.md, mirrored here for reference):
 *   reviews (
 *     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *     igdb_game_id    bigint NOT NULL,
 *     body            text NOT NULL DEFAULT '',
 *     rating          numeric(2,1) NOT NULL,         -- 0.5–5.0 in 0.5 steps
 *     liked           boolean NOT NULL DEFAULT false,
 *     has_spoilers    boolean NOT NULL DEFAULT false,
 *     -- denormalised cache so feed/profile rows don't have to round-trip IGDB
 *     game_title      text,
 *     game_image      text,
 *     hours_played    numeric(6,1) NOT NULL DEFAULT 0,
 *     vibe_stamp      text CHECK (vibe_stamp IN ('masterpiece','underrated','mid','rage_quit','comfort')),
 *     life_context    text CHECK (life_context IN ('childhood','teen_years','college','burnout','healing','traveling','new_chapter')),
 *     created_at      timestamptz NOT NULL DEFAULT now(),
 *     updated_at      timestamptz NOT NULL DEFAULT now()
 *   )
 *
 *   -- RLS:
 *   --   read:   anyone authenticated (community feed needs cross-user reads)
 *   --   write:  user_id = auth.uid()
 *   --   update: user_id = auth.uid()
 *   --   delete: user_id = auth.uid()
 *
 * The new public API is async (Supabase). Several downstream services
 * (profileStatsService, smartListService) still call
 * the legacy sync `getAllReviews()` / `getReviewCount()` helpers — those
 * are kept as thin shims over an in-memory cache of the *current user's*
 * reviews, hydrated by `loadCurrentUserReviewsCache(userId)` on auth resolve.
 */

/* ============================================================
   Module-level cache (current user only)
   ============================================================ */

const STORAGE_KEY = 'gameReviews'
const MIGRATED_KEY = 'gameReviews_migratedToSupabase'

let _cachedUserReviews = []
let _cachedUserId = null

/**
 * Convert a Supabase row into the legacy localStorage shape so
 * existing sync consumers (profile stats, smart lists, mock community
 * service) keep working unmodified.
 */
function toLegacyShape(row) {
  if (!row) return null
  return {
    id: row.id,
    gameId: row.igdb_game_id != null ? String(row.igdb_game_id) : null,
    gameTitle: row.game_title || '',
    gameImage: row.game_image || '',
    rating: row.rating,
    text: row.body || '',
    hoursPlayed: row.hours_played != null ? Number(row.hours_played) : 0,
    liked: !!row.liked,
    containsSpoilers: !!row.has_spoilers,
    vibeStamp: row.vibe_stamp || null,
    lifeContext: row.life_context || null,
    date: row.created_at,
  }
}

function notifyChange() {
  try {
    window.dispatchEvent(new Event('reviewAdded'))
  } catch {
    // SSR / no-window — best effort
  }
}

/* ============================================================
   Cache hydration
   ============================================================ */

export async function loadCurrentUserReviewsCache(userId) {
  if (!userId) {
    _cachedUserReviews = []
    _cachedUserId = null
    return []
  }
  const reviews = await getReviewsForUser(userId)
  _cachedUserReviews = reviews
  _cachedUserId = userId
  return reviews
}

export function clearReviewCache() {
  _cachedUserReviews = []
  _cachedUserId = null
}

/**
 * Clear the legacy pre-Supabase local review blob + its per-user migration
 * marker. Reviews themselves live in Supabase (see clearReviewCache for the
 * in-memory cache), but an un-migrated legacy blob left behind on this
 * device would otherwise get migrated into whichever account signs in next
 * (migrateLocalReviewsIfNeeded only skips when its marker already matches
 * the *current* userId).
 */
export function clearLocalReviewsLegacyData() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(MIGRATED_KEY)
  } catch {
    // best-effort
  }
}

export function getCachedUserId() {
  return _cachedUserId
}

export function getCachedUserReviews() {
  return _cachedUserReviews
}

/* ============================================================
   Supabase API
   ============================================================ */

/**
 * SELECT *, users.username, users.display_name, users.avatar_url
 * FROM reviews JOIN users ON reviews.user_id = users.id
 * WHERE user_id = $1 ORDER BY created_at DESC
 *
 * This is the single source of truth for a user's reviews — both the
 * Profile "reviews" stat (count) and the Profile Reviews tab (list) call
 * this same function so the two can never drift out of sync. The
 * `users!reviews_user_id_fkey` FK hint matches every other embedding
 * query in this file (getReviewsForGame, getRecentCommunityReviews,
 * etc.) — without it, PostgREST fails ambiguity resolution as soon as a
 * second FK path exists between reviews and users (this repo has hit
 * that before), and a naive unhinted `users(...)` embed silently drops
 * the reviewer's identity (rowToReviewCard falls back to "Anonymous")
 * even when the row set itself is correct.
 */
export async function getReviewsForUser(userId) {
  if (!userId) return []
  // Profile's own bundle and the BadgesRow's useUserStats both want this on
  // the same mount, so the two identical requests overlapped every time.
  return dedupeInFlight(`reviews:forUser:${userId}`, async () => {
    const { data, error } = await supabase
      .from('reviews')
      .select(
        'id, user_id, igdb_game_id, body, rating, liked, has_spoilers, game_title, game_image, hours_played, vibe_stamp, life_context, created_at, updated_at, users!reviews_user_id_fkey(username, display_name, avatar_url)'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) {
      console.error('[reviews] getReviewsForUser failed:', error.message)
      return []
    }
    return data || []
  })
}

/**
 * SELECT *, users.username, users.display_name, users.avatar_url
 * FROM reviews JOIN users ON reviews.user_id = users.id
 * WHERE igdb_game_id = $1
 * ORDER BY created_at DESC LIMIT 20
 *
 * Sprint 7: filters out reviews authored by users the current user
 * has blocked (or who have blocked the current user) via the
 * blockService cache.
 */
export async function getReviewsForGame(igdbGameId) {
  if (igdbGameId == null) return []
  const [flaggedIds, queryResult] = await Promise.all([
    getFlaggedContentIds('review'),
    (async () => {
      let query = supabase
        .from('reviews')
        .select('*, users!reviews_user_id_fkey(username, display_name, avatar_url)')
        .eq('igdb_game_id', Number(igdbGameId))
        .order('created_at', { ascending: false })
        .limit(20)
      query = await applyBlockFilter(query, 'user_id')
      return query
    })(),
  ])
  const { data, error } = await queryResult
  if (error) {
    console.error('[reviews] getReviewsForGame failed:', error.message)
    return []
  }
  const rows = data || []
  return flaggedIds.size > 0 ? rows.filter((r) => !flaggedIds.has(r.id)) : rows
}

/**
 * Fetch a single review by id, joined with the reviewer's user fields
 * and any denormalised game metadata stored on the row. Used by the
 * /reviews/:id/comments page so it can render the parent ReviewCard
 * at the top of the thread without re-deriving the shape from a
 * timeline fetch.
 *
 * Returns null on miss so callers can render a clean "not found" state
 * rather than crashing on undefined access.
 */
export async function getReviewById(reviewId) {
  if (!reviewId) return null
  let query = supabase
    .from('reviews')
    .select('*, users!reviews_user_id_fkey(username, display_name, avatar_url)')
    .eq('id', reviewId)
    .maybeSingle()
  query = await applyBlockFilter(query, 'user_id')
  const { data, error } = await query
  if (error) {
    console.error('[reviews] getReviewById failed:', error.message)
    return null
  }
  return data || null
}

/**
 * Paginated version of getReviewsForGame for the all-reviews page.
 * Returns { items, hasMore } for infinite-scroll consumers.
 *
 * Client-side slice is used for Sprint 5 since the backend already
 * returns up to 20 rows per getReviewsForGame call. A real server-side
 * cursor will replace this in Sprint 6.
 *
 * @param {{ gameId: number|string, page?: number, limit?: number }} opts
 * @returns {Promise<{ items: Array, hasMore: boolean }>}
 */
export async function getReviewsForGamePaginated({ gameId, page = 1, limit = 20 }) {
  if (gameId == null) return { items: [], hasMore: false }

  const from = (page - 1) * limit
  const to = from + limit - 1

  const [flaggedIds, queryResult] = await Promise.all([
    getFlaggedContentIds('review'),
    (async () => {
      let query = supabase
        .from('reviews')
        .select('*, users!reviews_user_id_fkey(username, display_name, avatar_url)')
        .eq('igdb_game_id', Number(gameId))
        .order('created_at', { ascending: false })
        .range(from, to)
      query = await applyBlockFilter(query, 'user_id')
      return query
    })(),
  ])
  const { data, error } = await queryResult

  if (error) {
    console.error('[reviews] getReviewsForGamePaginated failed:', error.message)
    return { items: [], hasMore: false }
  }

  const allItems = data || []
  const items =
    flaggedIds.size > 0 ? allItems.filter((r) => !flaggedIds.has(r.id)) : allItems
  return { items, hasMore: allItems.length === limit }
}

/**
 * Recent reviews across the whole app, joined with the reviewer's
 * display_name + avatar_url. Used by the Explore community feed.
 */
export async function getRecentCommunityReviews(limit = 20) {
  const _t0 = Date.now()
  const [flaggedIds, queryResult] = await Promise.all([
    getFlaggedContentIds('review'),
    (async () => {
      let query = supabase
        .from('reviews')
        .select('*, users!reviews_user_id_fkey(username, display_name, avatar_url)')
        .order('created_at', { ascending: false })
        .limit(limit)
      query = await applyBlockFilter(query, 'user_id')
      return query
    })(),
  ])
  if (import.meta.env.DEV) console.log(`[⏱ explore] getRecentCommunityReviews Promise.all done: ${Date.now() - _t0}ms`)
  const { data, error } = await queryResult
  if (import.meta.env.DEV) console.log(`[⏱ explore] getRecentCommunityReviews TOTAL: ${Date.now() - _t0}ms`)
  if (error) {
    console.error('[reviews] getRecentCommunityReviews failed:', error.message)
    return []
  }
  const rows = data || []
  return flaggedIds.size > 0 ? rows.filter((r) => !flaggedIds.has(r.id)) : rows
}

/**
 * Reviews ranked by like count desc, tiebreak recency.
 * Candidate window: past `days` days, capped at 200 rows. Falls back to
 * all-time (300 rows) when the window is sparse (< ⌈limit/2⌉ results).
 * One batch getLikeCountsForReviews call — no N+1 round-trips.
 *
 * Used by the Discover page "POPULAR" reviews tab.
 */
export async function getPopularReviews({ days = 30, limit = 25 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const [flaggedIds, windowResult] = await Promise.all([
    getFlaggedContentIds('review'),
    (async () => {
      let q = supabase
        .from('reviews')
        .select('*, users!reviews_user_id_fkey(username, display_name, avatar_url)')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200)
      q = await applyBlockFilter(q, 'user_id')
      return q
    })(),
  ])

  const { data: windowData, error: windowErr } = await windowResult
  if (windowErr) {
    console.error('[reviews] getPopularReviews window query failed:', windowErr.message)
    return []
  }

  let candidates = (windowData || []).filter((r) => !flaggedIds.has(r.id))

  // Widen to all-time when the window is sparse
  if (candidates.length < Math.ceil(limit / 2)) {
    let q2 = supabase
      .from('reviews')
      .select('*, users!reviews_user_id_fkey(username, display_name, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(300)
    q2 = await applyBlockFilter(q2, 'user_id')
    const { data: allData, error: allErr } = await q2
    if (!allErr && allData) {
      candidates = allData.filter((r) => !flaggedIds.has(r.id))
    }
  }

  if (candidates.length === 0) return []

  const ids = candidates.map((r) => r.id)
  const likeCounts = await getLikeCountsForReviews(ids)

  return candidates
    .sort((a, b) => {
      const la = likeCounts.get(a.id) || 0
      const lb = likeCounts.get(b.id) || 0
      if (lb !== la) return lb - la
      return new Date(b.created_at) - new Date(a.created_at)
    })
    .slice(0, limit)
}

/**
 * Sprint 5 P5: window of recent community reviews used by the Home
 * timeline's "Popular" tab. Returns rows joined with the reviewer's
 * username/display_name/avatar_url so the timeline can render full
 * ReviewCards without a follow-up round-trip.
 *
 * Sorting is left to the caller. Sprint 6 P0: the Home timeline now
 * batch-fetches real like counts from the `likes` table via
 * `getLikeCountsForReviews(reviewIds)` and re-sorts in-memory by
 * COUNT DESC. A native `order by likes desc` would require either a
 * Postgres view or an RPC; the client-side sort is fine for the
 * 200-row window we fetch and avoids the schema-migration ceremony.
 */
export async function getReviewsForTimeline({ sinceDays = 14, limit = 200 } = {}) {
  const sinceIso = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()
  const [flaggedIds, queryResult] = await Promise.all([
    getFlaggedContentIds('review'),
    (async () => {
      let query = supabase
        .from('reviews')
        .select('*, users!reviews_user_id_fkey(username, display_name, avatar_url)')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(limit)
      query = await applyBlockFilter(query, 'user_id')
      return query
    })(),
  ])
  const { data, error } = await queryResult
  if (error) {
    console.error('[reviews] getReviewsForTimeline failed:', error.message)
    return []
  }
  const rows = data || []
  return flaggedIds.size > 0 ? rows.filter((r) => !flaggedIds.has(r.id)) : rows
}

/**
 * Sprint 5 P7: Reviews from users the current user follows, paginated
 * newest-first. Used by the Home → TimelineFeed Friends tab.
 *
 * Two-step approach (avoids raw SQL / RPC):
 *   1. Fetch the followee IDs for auth.uid() from the follows table.
 *   2. Fetch reviews WHERE user_id IN (followeeIds), paginated.
 *
 * Returns { items, hasMore } matching the shape of getReviewsForGamePaginated.
 *
 * @param {{ page?: number, limit?: number }} opts
 * @returns {Promise<{ items: Array, hasMore: boolean }>}
 */
export async function getReviewsFromFollowing({ page = 1, limit = 10 } = {}) {
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return { items: [], hasMore: false }

  const { data: followRows, error: followErr } = await supabase
    .from('follows')
    .select('followee_id')
    .eq('follower_id', user.id)

  if (followErr) {
    console.error('[reviews] getReviewsFromFollowing follows fetch failed:', followErr.message)
    return { items: [], hasMore: false }
  }

  const followeeIds = (followRows || []).map((r) => r.followee_id)
  if (followeeIds.length === 0) return { items: [], hasMore: false }

  const from = (page - 1) * limit
  const to = from + limit - 1

  const [flaggedIds, queryResult] = await Promise.all([
    getFlaggedContentIds('review'),
    (async () => {
      let query = supabase
        .from('reviews')
        .select('*, users!reviews_user_id_fkey(username, display_name, avatar_url)')
        .in('user_id', followeeIds)
        .order('created_at', { ascending: false })
        .range(from, to)
      query = await applyBlockFilter(query, 'user_id')
      return query
    })(),
  ])
  const { data, error } = await queryResult

  if (error) {
    console.error('[reviews] getReviewsFromFollowing failed:', error.message)
    return { items: [], hasMore: false }
  }

  const allItems = data || []
  const items =
    flaggedIds.size > 0 ? allItems.filter((r) => !flaggedIds.has(r.id)) : allItems
  return { items, hasMore: allItems.length === limit }
}

/**
 * Hot Takes — contrarian reviews that earned community engagement.
 *
 * A "hot take" is a review whose rating deviates significantly from the
 * community average for that game AND that received likes, signalling that
 * others found the contrarian position compelling.
 *
 * Algorithm:
 *   1. Fetch up to 300 reviews from the past `days` days (block + flag filtered).
 *   2. Per game: compute average rating and review count.
 *   3. Require ≥ MIN_GAME_REVIEWS reviews per game for a meaningful average.
 *   4. Per review: deviation = |rating − game_avg|. Keep deviation ≥ 1.5.
 *   5. Batch-fetch like counts; score = likes × deviation + deviation × 0.1
 *      (the 0.1 term keeps unliked contrarian reviews ranked above zero so
 *      the section shows something while the community is still small).
 *   6. Sort score desc, tiebreak recency desc. Slice to `limit`.
 *
 * Returned rows carry two extra fields (internal, for callers):
 *   _likeCount — number of likes (avoids a second round-trip)
 *   _gameAvg   — community average rating for the game
 */
export async function getHotTakeReviews({ days = 60, limit = 10 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const [flaggedIds, queryResult] = await Promise.all([
    getFlaggedContentIds('review'),
    (async () => {
      let q = supabase
        .from('reviews')
        .select('*, users!reviews_user_id_fkey(username, display_name, avatar_url)')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(300)
      q = await applyBlockFilter(q, 'user_id')
      return q
    })(),
  ])

  const { data, error } = await queryResult
  if (error) {
    console.error('[reviews] getHotTakeReviews failed:', error.message)
    return []
  }

  const rows = (data || []).filter((r) => !flaggedIds.has(r.id))
  if (rows.length === 0) return []

  // Per-game average rating + review count
  const MIN_GAME_REVIEWS = 3
  const MIN_DEVIATION = 1.5
  const gameStats = new Map()
  for (const r of rows) {
    if (!r.igdb_game_id) continue
    const s = gameStats.get(r.igdb_game_id) || { sum: 0, count: 0 }
    s.sum += Number(r.rating) || 0
    s.count += 1
    gameStats.set(r.igdb_game_id, s)
  }

  // Keep only reviews on games with enough reviews and a large enough deviation
  const candidates = rows.filter((r) => {
    const s = gameStats.get(r.igdb_game_id)
    if (!s || s.count < MIN_GAME_REVIEWS) return false
    const avg = s.sum / s.count
    return Math.abs(Number(r.rating) - avg) >= MIN_DEVIATION
  })
  if (candidates.length === 0) return []

  const ids = candidates.map((r) => r.id)
  const likeCounts = await getLikeCountsForReviews(ids)

  return candidates
    .map((r) => {
      const s = gameStats.get(r.igdb_game_id)
      const avg = s.sum / s.count
      const deviation = Math.abs(Number(r.rating) - avg)
      const likes = likeCounts.get(r.id) || 0
      const score = likes * deviation + deviation * 0.1
      return { ...r, _likeCount: likes, _gameAvg: avg, _score: score }
    })
    .sort(
      (a, b) => b._score - a._score || new Date(b.created_at) - new Date(a.created_at)
    )
    .slice(0, limit)
}

/**
 * Review of the Week — the most-liked review posted in the last 7 days.
 *
 * Returns null when no reviews in the window have at least 1 like so the
 * spotlight section can hide itself rather than showing an empty card.
 * Ties are broken by recency (newest first).
 *
 * The returned row carries `_likeCount` so the hero component can display
 * the count without an extra round-trip.
 */
export async function getReviewOfWeek() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [flaggedIds, queryResult] = await Promise.all([
    getFlaggedContentIds('review'),
    (async () => {
      let q = supabase
        .from('reviews')
        .select('*, users!reviews_user_id_fkey(username, display_name, avatar_url)')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(100)
      q = await applyBlockFilter(q, 'user_id')
      return q
    })(),
  ])

  const { data, error } = await queryResult
  if (error) {
    console.error('[reviews] getReviewOfWeek failed:', error.message)
    return null
  }

  const candidates = (data || []).filter((r) => !flaggedIds.has(r.id))
  if (candidates.length === 0) return null

  const ids = candidates.map((r) => r.id)
  const likeCounts = await getLikeCountsForReviews(ids)

  // Must have ≥ 1 like — no-like window hides the spotlight entirely
  const qualified = candidates.filter((r) => (likeCounts.get(r.id) || 0) > 0)
  if (qualified.length === 0) return null

  const top = [...qualified].sort((a, b) => {
    const la = likeCounts.get(a.id) || 0
    const lb = likeCounts.get(b.id) || 0
    if (lb !== la) return lb - la
    return new Date(b.created_at) - new Date(a.created_at)
  })[0]

  return { ...top, _likeCount: likeCounts.get(top.id) || 0 }
}

/**
 * Sprint 5 P3: Search community reviews by review body (case-insensitive
 * substring match). Joined with users so the Search Reviews tab can render
 * a full ReviewCard without a second round-trip.
 *
 * The reviews table doesn't carry a separate "title" column (the spec
 * mentions title for forward-compat with future schema changes), so for
 * now we match the body only — which is the substantive content anyway.
 */
export async function searchReviewsByText(query, limit = 20) {
  const trimmed = (query || '').trim()
  if (!trimmed) return []
  // Escape Postgres LIKE wildcards in the user input so a user typing
  // "%" or "_" doesn't accidentally match everything.
  const escaped = trimmed.replace(/[\\%_]/g, (m) => `\\${m}`)
  let q = supabase
    .from('reviews')
    .select('*, users!reviews_user_id_fkey(username, display_name, avatar_url)')
    .ilike('body', `%${escaped}%`)
    .order('created_at', { ascending: false })
    .limit(limit)
  q = await applyBlockFilter(q, 'user_id')
  const { data, error } = await q
  if (error) {
    console.error('[reviews] searchReviewsByText failed:', error.message)
    return []
  }
  return data || []
}

/**
 * INSERT a new review. RLS enforces user_id = auth.uid().
 *
 * The optional gameTitle/gameImage/hoursPlayed are denormalised onto the
 * row so the feed/profile/profile-stats can render without round-tripping
 * IGDB for every row.
 *
 * @param {{
 *   igdbGameId: number|string,
 *   body?: string,
 *   rating: number,
 *   liked?: boolean,
 *   hasSpoilers?: boolean,
 *   gameTitle?: string|null,
 *   gameImage?: string|null,
 *   hoursPlayed?: number,
 * }} args
 */
export async function postReview({
  igdbGameId,
  body = '',
  rating,
  liked = false,
  hasSpoilers = false,
  gameTitle = null,
  gameImage = null,
  hoursPlayed = 0,
  vibeStamp = null,
  lifeContext = null,
}) {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser()
  if (userErr || !user) {
    throw new Error('You must be signed in to post a review.')
  }

  const insert = {
    user_id: user.id,
    igdb_game_id: Number(igdbGameId),
    body: body || '',
    rating: Number(rating),
    liked: !!liked,
    has_spoilers: !!hasSpoilers,
    game_title: gameTitle || null,
    game_image: gameImage || null,
    hours_played: Number(hoursPlayed) || 0,
    vibe_stamp: vibeStamp || null,
    life_context: lifeContext || null,
  }

  const { data, error } = await supabase
    .from('reviews')
    .insert(insert)
    .select('*')
    .single()
  if (error) {
    console.error('[reviews] postReview failed:', error.message)
    throw new Error(error.message)
  }

  // Optimistically prepend to the cache so sync consumers see the new
  // review without waiting for the next hydration.
  _cachedUserReviews = [data, ..._cachedUserReviews]
  notifyChange()

  // Activity log — fire-and-forget AFTER the primary insert succeeds.
  logActivity({
    activityType: 'review_posted',
    igdbGameId: data.igdb_game_id,
    targetId: data.id,
    metadata: {
      game_title: data.game_title || null,
      rating: data.rating != null ? Number(data.rating) : null,
    },
  })

  // Pulse — one event per user-visible action. postReview always
  // includes a rating (rating column is NOT NULL) so we collapse
  // "rated + reviewed" into a single 'reviewed' event with the rating
  // in metadata. The 'rated' enum value is reserved for a future
  // rate-without-review feature.
  logActivityEvent({
    type: ACTIVITY_EVENT_TYPES.REVIEWED,
    entityId: data.igdb_game_id != null ? String(data.igdb_game_id) : null,
    metadata: {
      review_id: data.id,
      rating: data.rating != null ? Number(data.rating) : null,
      game_title: data.game_title || null,
      game_image: data.game_image || null,
      has_spoilers: !!data.has_spoilers,
    },
  })

  return data
}

/**
 * UPDATE review fields. RLS enforces user_id = auth.uid() — this call
 * silently affects 0 rows if the caller doesn't own the review.
 */
export async function updateReview(reviewId, fields) {
  if (!reviewId) throw new Error('reviewId is required')
  const allowed = {}
  if ('body' in fields) allowed.body = fields.body || ''
  if ('rating' in fields) allowed.rating = Number(fields.rating)
  if ('liked' in fields) allowed.liked = !!fields.liked
  if ('hasSpoilers' in fields) allowed.has_spoilers = !!fields.hasSpoilers
  if ('gameTitle' in fields) allowed.game_title = fields.gameTitle || null
  if ('gameImage' in fields) allowed.game_image = fields.gameImage || null
  if ('hoursPlayed' in fields) allowed.hours_played = Number(fields.hoursPlayed) || 0
  if ('vibeStamp' in fields) allowed.vibe_stamp = fields.vibeStamp || null
  if ('lifeContext' in fields) allowed.life_context = fields.lifeContext || null
  allowed.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('reviews')
    .update(allowed)
    .eq('id', reviewId)
    .select('*')
    .single()
  if (error) {
    console.error('[reviews] updateReview failed:', error.message)
    throw new Error(error.message)
  }

  _cachedUserReviews = _cachedUserReviews.map((r) => (r.id === reviewId ? data : r))
  notifyChange()
  return data
}

/**
 * DELETE a review. RLS enforces user_id = auth.uid().
 */
export async function deleteReview(reviewId) {
  if (!reviewId) throw new Error('reviewId is required')
  const { error } = await supabase.from('reviews').delete().eq('id', reviewId)
  if (error) {
    console.error('[reviews] deleteReview failed:', error.message)
    throw new Error(error.message)
  }
  _cachedUserReviews = _cachedUserReviews.filter((r) => r.id !== reviewId)
  notifyChange()
}

/* ============================================================
   One-time localStorage → Supabase migration
   ============================================================ */

/**
 * If the current device still has a `gameReviews` localStorage blob and
 * we haven't already migrated for this user, bulk-insert all local
 * reviews into the `reviews` table.
 *
 * Idempotent per-user: writes a `${MIGRATED_KEY}` marker on success so
 * subsequent loads skip. Same one-time pattern used by trackers.
 */
export async function migrateLocalReviewsIfNeeded(userId) {
  if (!userId) return { migrated: 0, skipped: true, reason: 'no-user' }
  try {
    const marker = localStorage.getItem(MIGRATED_KEY)
    if (marker === userId) {
      return { migrated: 0, skipped: true, reason: 'already-migrated' }
    }

    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      localStorage.setItem(MIGRATED_KEY, userId)
      return { migrated: 0, skipped: false, reason: 'nothing-to-migrate' }
    }

    let parsed
    try {
      parsed = JSON.parse(stored)
    } catch {
      // Corrupt blob — mark as migrated so we don't retry forever.
      localStorage.setItem(MIGRATED_KEY, userId)
      return { migrated: 0, skipped: true, reason: 'corrupt-localstorage' }
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.setItem(MIGRATED_KEY, userId)
      return { migrated: 0, skipped: false, reason: 'empty' }
    }

    const rows = parsed
      .filter((r) => r && r.gameId != null && r.rating != null)
      .map((r) => ({
        user_id: userId,
        igdb_game_id: Number(r.gameId),
        body: r.text || '',
        rating: parseFloat(r.rating) || 0,
        liked: !!r.liked,
        has_spoilers: !!r.containsSpoilers,
        game_title: r.gameTitle || null,
        game_image: r.gameImage || null,
        hours_played: Number(r.hoursPlayed) || 0,
        // Preserve the original write timestamp so feeds sort sensibly.
        created_at: r.date || new Date().toISOString(),
      }))

    if (rows.length === 0) {
      localStorage.setItem(MIGRATED_KEY, userId)
      return { migrated: 0, skipped: false, reason: 'no-valid-rows' }
    }

    const { error } = await supabase.from('reviews').insert(rows)
    if (error) {
      // Don't write the marker — let the next boot retry.
      console.error('[reviews] migration failed:', error.message)
      return { migrated: 0, skipped: false, error }
    }

    localStorage.setItem(MIGRATED_KEY, userId)
    return { migrated: rows.length, skipped: false }
  } catch (err) {
    console.error('[reviews] migration crashed:', err)
    return { migrated: 0, skipped: false, error: err }
  }
}

/* ============================================================
   Legacy sync shims (current-user cache only)
   ============================================================ */

/**
 * @deprecated Returns *only* the cached current-user reviews in the legacy
 * localStorage shape. New code should call `getReviewsForUser(userId)` /
 * `getReviewsForGame(id)` / `getRecentCommunityReviews()` directly.
 */
export function getAllReviews() {
  return _cachedUserReviews.map(toLegacyShape).filter(Boolean)
}

/** @deprecated — sync helper, current-user cache only. */
export function getReviewsByGameId(gameId) {
  if (gameId == null) return []
  const target = String(gameId)
  return _cachedUserReviews
    .filter((r) => String(r.igdb_game_id) === target)
    .map(toLegacyShape)
    .filter(Boolean)
}

/** @deprecated — current-user cache count. */
export function getUserReviewCount() {
  return _cachedUserReviews.length
}

/** @deprecated — alias for getUserReviewCount(). */
export function getReviewCount() {
  return _cachedUserReviews.length
}

/**
 * Fetch rating values for all platform reviews (newest `limit` rows).
 * Used by the profile histogram compare overlay to build a community
 * distribution without a heavyweight round-trip or per-game aggregation.
 *
 * Returns a plain array of numbers in [0.5, 5.0].
 *
 * @param {{ limit?: number }} opts
 * @returns {Promise<number[]>}
 */
export async function getCommunityRatings({ limit = 2000 } = {}) {
  const { data, error } = await supabase
    .from('reviews')
    .select('rating')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[reviews] getCommunityRatings failed:', error.message)
    return []
  }
  return (data || []).map((r) => Number(r.rating)).filter((n) => Number.isFinite(n) && n > 0)
}

/**
 * Whole-star rating distribution for a single game — every rating row is
 * fetched (not just the 20 most recent shown in "Top Reviews") and rounded
 * to its nearest whole star (1–5) for bucketing. Powers GameDetail's
 * community rating card (numeric average + 5-row histogram).
 *
 * The `rating` column itself stores 0.5–5.0 in half-star steps (the
 * composer's picker), but that granularity is out of scope for this
 * whole-star display, so each real rating is rounded to its nearest
 * integer star before counting — no values are invented, only bucketed.
 * `average` is computed from the raw (unrounded) ratings so the numeric
 * average stays precise to one decimal.
 *
 * Returns `{ average, totalCount, counts, error }`:
 *   average    — mean of the raw ratings rounded to 1 decimal, or null
 *                when the game has zero ratings (or the query failed)
 *   totalCount — total number of rating rows for this game
 *   counts     — `{ 1: n, 2: n, 3: n, 4: n, 5: n }` keyed by whole star, or
 *                `null` when the query failed (never a fake all-zero map —
 *                that shape is reserved for a *confirmed* zero-rating game)
 *   error      — true only when the query itself failed (network/RLS/schema).
 *                Callers must NOT treat this the same as a genuine
 *                zero-rating game — it means "we don't know", not "there are
 *                no ratings". The caller is responsible for logging/surfacing
 *                this rather than silently rendering the empty state.
 *
 * @param {number|string} igdbGameId
 * @returns {Promise<{ average: number|null, totalCount: number, counts: Record<number, number>|null, error: boolean }>}
 */
export async function getRatingDistributionForGame(igdbGameId) {
  // Genuine "this game has zero ratings" — a confirmed result from a
  // successful query, safe for the UI to treat as an empty state.
  const EMPTY = { average: null, totalCount: 0, counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, error: false }
  // "We don't know" — the query itself failed. Deliberately shaped
  // differently from EMPTY (counts: null) so a failure can never be
  // mistaken downstream for a confirmed zero-rating game.
  const FAILED = { average: null, totalCount: 0, counts: null, error: true }
  if (igdbGameId == null) return EMPTY

  const { data, error } = await supabase
    .from('reviews')
    .select('rating')
    .eq('igdb_game_id', Number(igdbGameId))
    .limit(10000)
  if (error) {
    console.error('[reviews] getRatingDistributionForGame failed for igdb_game_id=%s:', igdbGameId, error.message, error)
    return FAILED
  }

  const ratings = (data || [])
    .map((r) => Number(r.rating))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (ratings.length === 0) return EMPTY

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let sum = 0
  for (const r of ratings) {
    sum += r
    const star = Math.min(5, Math.max(1, Math.round(r)))
    counts[star] += 1
  }

  return {
    average: Math.round((sum / ratings.length) * 10) / 10,
    totalCount: ratings.length,
    counts,
    error: false,
  }
}

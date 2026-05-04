import { supabase } from './supabase'
import { logActivity } from './activityService'

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
 * (profileStatsService, smartListService, communityMockService) still call
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
 * SELECT * FROM reviews WHERE user_id = $1 ORDER BY created_at DESC
 */
export async function getReviewsForUser(userId) {
  if (!userId) return []
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[reviews] getReviewsForUser failed:', error.message)
    return []
  }
  return data || []
}

/**
 * SELECT *, users.display_name, users.avatar_url
 * FROM reviews JOIN users ON reviews.user_id = users.id
 * WHERE igdb_game_id = $1
 * ORDER BY created_at DESC LIMIT 20
 */
export async function getReviewsForGame(igdbGameId) {
  if (igdbGameId == null) return []
  const { data, error } = await supabase
    .from('reviews')
    .select('*, users(display_name, avatar_url)')
    .eq('igdb_game_id', Number(igdbGameId))
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) {
    console.error('[reviews] getReviewsForGame failed:', error.message)
    return []
  }
  return data || []
}

/**
 * Recent reviews across the whole app, joined with the reviewer's
 * display_name + avatar_url. Used by the Explore community feed.
 */
export async function getRecentCommunityReviews(limit = 20) {
  const { data, error } = await supabase
    .from('reviews')
    .select('*, users(display_name, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[reviews] getRecentCommunityReviews failed:', error.message)
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

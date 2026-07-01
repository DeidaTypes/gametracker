import { supabase } from './supabase'

/**
 * Taste Engine — client read surface.
 *
 * These functions read ONLY from the precomputed server-side caches
 * (user_taste_vectors, user_recommendations) and the get_taste_match RPC.
 * They NEVER call IGDB — that fan-out happens exclusively in the
 * `taste-engine` Edge Function on a daily schedule. See
 * supabase/taste_engine.sql + supabase/functions/taste-engine.
 *
 * Every function fails soft (null / []) so a failed read can never pin a
 * loading spinner, and returns emptiness rather than a fabricated guess
 * when the engine had too little data to write a result.
 */

async function currentUserId() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    return user?.id || null
  } catch {
    return null
  }
}

/**
 * getTasteVector(userId) — one user's normalized genre/theme affinity vector.
 *
 * @param {string} [userId]  Defaults to the current user.
 * @returns {Promise<null | {
 *   userId: string,
 *   genreWeights: Record<string, number>,   // L2-normalized, [0,1]
 *   themeWeights: Record<string, number>,
 *   topRatedGameIds: number[],
 *   ratedGameCount: number,
 *   trackedGameCount: number,
 *   signalCount: number,
 *   confidence: number,                       // [0,1]
 *   updatedAt: string,
 * }>}  null when the engine hasn't built a vector for this user yet.
 */
export async function getTasteVector(userId) {
  try {
    const target = userId || (await currentUserId())
    if (!target) return null

    const { data, error } = await supabase.rpc('get_user_taste_vector', { target })
    if (error) {
      console.error('[tasteEngine] getTasteVector RPC error:', error.message)
      return null
    }
    if (!data) return null

    return {
      userId: data.user_id,
      genreWeights: data.genre_weights || {},
      themeWeights: data.theme_weights || {},
      topRatedGameIds: data.top_rated_game_ids || [],
      ratedGameCount: data.rated_game_count || 0,
      trackedGameCount: data.tracked_game_count || 0,
      signalCount: data.signal_count || 0,
      confidence: Number(data.confidence) || 0,
      updatedAt: data.updated_at || null,
    }
  } catch (err) {
    console.error('[tasteEngine] getTasteVector crashed:', err)
    return null
  }
}

/**
 * getTasteMatch(a, b) — taste compatibility between two users.
 *
 * Returns a real 0–100 score + per-genre breakdown, or NULL below the
 * confidence threshold (too few rated/shared games) — never a shaky guess.
 *
 * @param {string} userA
 * @param {string} userB
 * @returns {Promise<null | {
 *   score: number,                                   // 0–100
 *   confidence: number,                              // 0–1
 *   sharedGenreCount: number,
 *   genres: Array<{ genre: string, strength: number }>,  // top shared, strength 0–100
 * }>}
 */
export async function getTasteMatch(userA, userB) {
  try {
    if (!userA || !userB) return null
    const { data, error } = await supabase.rpc('get_taste_match', { user_a: userA, user_b: userB })
    if (error) {
      console.error('[tasteEngine] getTasteMatch RPC error:', error.message)
      return null
    }
    // Below threshold → the RPC returns enough_data:false. Surface null so
    // callers render an honest "not enough data" state, not a fake percent.
    if (!data || data.enough_data !== true || data.score == null) return null

    return {
      score: Number(data.score),
      confidence: Number(data.confidence) || 0,
      sharedGenreCount: data.shared_genre_count || 0,
      genres: Array.isArray(data.genres)
        ? data.genres.map((g) => ({ genre: g.genre, strength: Number(g.strength) || 0 }))
        : [],
    }
  } catch (err) {
    console.error('[tasteEngine] getTasteMatch crashed:', err)
    return null
  }
}

/**
 * getRecommendations(userId) — precomputed "Because you played X" picks.
 *
 * Reads the user_recommendations cache (RLS: own rows only). Returns [] when
 * the engine had too little data — never invented picks.
 *
 * @param {string} [userId]  Defaults to the current user.
 * @param {number} [limit=20]
 * @returns {Promise<Array<{
 *   game: { id: number, title: string, image: string|null, genres: string[],
 *           totalRating: number|null, totalRatingCount: number|null },
 *   matchScore: number,                                  // 0–100
 *   becauseOf: { id: number|null, title: string|null },  // the seed game
 *   rank: number,
 * }>>}
 */
export async function getRecommendations(userId, limit = 20) {
  try {
    const target = userId || (await currentUserId())
    if (!target) return []

    const { data, error } = await supabase
      .from('user_recommendations')
      .select('*')
      .eq('user_id', target)
      .order('rank', { ascending: true })
      .limit(limit)

    if (error) {
      console.error('[tasteEngine] getRecommendations query error:', error.message)
      return []
    }

    return (data || []).map((row) => ({
      game: {
        id: Number(row.igdb_game_id),
        title: row.game_title || '',
        image: row.game_image || null,
        genres: row.genre_names || [],
        totalRating: row.total_rating != null ? Number(row.total_rating) : null,
        totalRatingCount: row.total_rating_count != null ? Number(row.total_rating_count) : null,
      },
      matchScore: Number(row.match_score) || 0,
      becauseOf: {
        id: row.because_of_game_id != null ? Number(row.because_of_game_id) : null,
        title: row.because_of_title || null,
      },
      rank: Number(row.rank) || 0,
    }))
  } catch (err) {
    console.error('[tasteEngine] getRecommendations crashed:', err)
    return []
  }
}

const BECAUSE_YOU_PLAYED_MIN_RAIL = 4
const BECAUSE_YOU_PLAYED_ROTATION_KEY = 'gt:because-you-played:seed-rotation:v1'

/** Owned/tracked IGDB ids for `userId`, as a Set<string> — client-side
 * belt-and-suspenders on top of the engine's own owned-game exclusion. */
async function _getOwnedGameIds(userId) {
  const ids = new Set()
  try {
    const { data } = await supabase
      .from('game_trackers')
      .select('igdb_game_id')
      .eq('user_id', userId)
    for (const row of data ?? []) {
      if (row.igdb_game_id != null) ids.add(String(row.igdb_game_id))
    }
  } catch {
    // soft-fail — no exclusions rather than blocking the rail
  }
  return ids
}

/** Advances (and persists) the per-user rotation cursor into [0, seedCount). */
function _nextRotationIndex(userId, seedCount) {
  if (seedCount <= 0) return 0
  try {
    const raw = localStorage.getItem(BECAUSE_YOU_PLAYED_ROTATION_KEY)
    const state = raw ? JSON.parse(raw) : {}
    const current = Number.isInteger(state[userId]) ? state[userId] : -1
    const next = (current + 1) % seedCount
    state[userId] = next
    localStorage.setItem(BECAUSE_YOU_PLAYED_ROTATION_KEY, JSON.stringify(state))
    return next
  } catch {
    return 0
  }
}

/**
 * getBecauseYouPlayed(userId) — the Discover page's "Because you played X"
 * closer rail.
 *
 * NARROW + precise by design, unlike SwipeDeck (which now draws broadly
 * across the whole taste vector — see SwipeDeck.jsx): every row returned
 * here was recommended *because of* the exact same single seed game, named
 * in the returned `seed.title`. Rotates which top-rated seed it anchors to
 * on every call (persisted per-user in localStorage) so the closer doesn't
 * spotlight the same title every visit.
 *
 * Composition only — reads getTasteVector + getRecommendations (both
 * already precomputed by the engine) and groups/filters client-side.
 * Never calls IGDB directly; never invents a seed or a pick.
 *
 * @param {string} [userId]  Defaults to the current user.
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<null | {
 *   seed: { id: number, title: string },
 *   items: Array<{ game: object, matchScore: number }>,
 * }>}  null when the engine has no recommendations yet for this user, or
 *      every recommended game is already owned.
 */
export async function getBecauseYouPlayed(userId, { limit = 10 } = {}) {
  try {
    const target = userId || (await currentUserId())
    if (!target) return null

    const [vector, recs, ownedIds] = await Promise.all([
      getTasteVector(target),
      getRecommendations(target, 60),
      _getOwnedGameIds(target),
    ])

    if (!recs.length) return null

    const available = recs.filter(
      (r) => r.game.id != null && !ownedIds.has(String(r.game.id))
    )
    if (!available.length) return null

    // Group by seed game so we can anchor the whole rail to exactly one.
    const bySeed = new Map()
    for (const r of available) {
      const seedId = r.becauseOf?.id
      if (seedId == null) continue
      if (!bySeed.has(seedId)) bySeed.set(seedId, { title: r.becauseOf.title, recs: [] })
      bySeed.get(seedId).recs.push(r)
    }
    if (bySeed.size === 0) return null

    // Rotation order: the engine's own top-rated list first (highest
    // affinity), then any remaining seeds not represented there.
    const preferredOrder = (vector?.topRatedGameIds || []).filter((id) => bySeed.has(id))
    for (const seedId of bySeed.keys()) {
      if (!preferredOrder.includes(seedId)) preferredOrder.push(seedId)
    }

    const minRail = Math.min(BECAUSE_YOU_PLAYED_MIN_RAIL, available.length)
    const eligible = preferredOrder.filter((id) => bySeed.get(id).recs.length >= minRail)
    const rotationPool = eligible.length > 0 ? eligible : preferredOrder
    if (rotationPool.length === 0) return null

    const idx = _nextRotationIndex(target, rotationPool.length)
    const seedId = rotationPool[idx]
    const seedGroup = bySeed.get(seedId)

    const items = seedGroup.recs
      .slice()
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit)
      .map((r) => ({ game: r.game, matchScore: r.matchScore }))

    return {
      seed: { id: seedId, title: seedGroup.title || 'a game you loved' },
      items,
    }
  } catch (err) {
    console.error('[tasteEngine] getBecauseYouPlayed crashed:', err)
    return null
  }
}

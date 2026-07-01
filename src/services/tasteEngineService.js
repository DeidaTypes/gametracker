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
 * getRecommendationSeeds(userId) — the user's cached seed set, ordered by
 * weight (strongest first).
 *
 * Reads the user_recommendation_seeds cache (RLS: own rows only) — the
 * daily job's top 10-15 highest-rated/played games that currently
 * qualify (fewer if the user has rated fewer; empty if none qualify).
 * Never invented — an empty array means the engine genuinely has nothing
 * for this user yet.
 *
 * @param {string} [userId]  Defaults to the current user.
 * @returns {Promise<Array<{
 *   seedGameId: number, seedTitle: string, seedImage: string|null,
 *   seedWeight: number, seedRank: number, recCount: number,
 * }>>}
 */
export async function getRecommendationSeeds(userId) {
  try {
    const target = userId || (await currentUserId())
    if (!target) return []

    const { data, error } = await supabase
      .from('user_recommendation_seeds')
      .select('*')
      .eq('user_id', target)
      .order('seed_rank', { ascending: true })

    if (error) {
      console.error('[tasteEngine] getRecommendationSeeds query error:', error.message)
      return []
    }

    return (data || []).map((row) => ({
      seedGameId: Number(row.seed_game_id),
      seedTitle: row.seed_title || 'a game you loved',
      seedImage: row.seed_image || null,
      seedWeight: Number(row.seed_weight) || 0,
      seedRank: Number(row.seed_rank) || 0,
      recCount: Number(row.rec_count) || 0,
    }))
  } catch (err) {
    console.error('[tasteEngine] getRecommendationSeeds crashed:', err)
    return []
  }
}

/**
 * getSeedRecommendations(userId, seedGameId) — one seed's own cached
 * rec list ("Because you played {seed}").
 *
 * Reads the user_recommendations cache filtered to a single seed, so
 * displaying a seed never touches (or re-derives from) any other seed's
 * picks. Returns [] when the engine has nothing cached for this
 * (user, seed) pair.
 *
 * @param {string} userId
 * @param {number} seedGameId
 * @param {number} [limit=20]
 * @returns {Promise<Array<{
 *   game: { id: number, title: string, image: string|null, genres: string[],
 *           totalRating: number|null, totalRatingCount: number|null },
 *   matchScore: number,  // 0–100
 *   rank: number,
 * }>>}
 */
export async function getSeedRecommendations(userId, seedGameId, limit = 20) {
  try {
    if (!userId || seedGameId == null) return []

    const { data, error } = await supabase
      .from('user_recommendations')
      .select('*')
      .eq('user_id', userId)
      .eq('seed_game_id', seedGameId)
      .order('rank', { ascending: true })
      .limit(limit)

    if (error) {
      console.error('[tasteEngine] getSeedRecommendations query error:', error.message)
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
      rank: Number(row.rank) || 0,
    }))
  } catch (err) {
    console.error('[tasteEngine] getSeedRecommendations crashed:', err)
    return []
  }
}

const BECAUSE_YOU_PLAYED_ROTATION_KEY = 'gt:because-you-played:seed-rotation:v2'
// How many of the strongest seeds get a second slot in each lap of the
// rotation — see _buildRotationPool.
const ROTATION_BOOST_FRACTION = 3

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

/**
 * Builds a deterministic rotation sequence over the user's cached seeds,
 * weighted so the strongest (top third, min 1) seeds reappear sooner —
 * a full lap visits every seed once in weight order, then revisits the
 * top third for a second pass, before looping back to seed #1. Cycling
 * forward through this pool (round-robin) is what both "re-entering
 * Explore" and "pull to refresh → next seed" walk through — it never
 * reshuffles randomly, so repeated pulls visit different seeds in a
 * stable sequence.
 *
 * @param {Array<{ seedGameId: number }>} orderedSeeds  Sorted by seedRank asc.
 * @returns {number[]}  seedGameId sequence (may repeat top seeds).
 */
function _buildRotationPool(orderedSeeds) {
  const n = orderedSeeds.length
  if (n === 0) return []
  const pool = orderedSeeds.map((s) => s.seedGameId)
  const boostCount = Math.max(1, Math.ceil(n / ROTATION_BOOST_FRACTION))
  for (let i = 0; i < boostCount; i++) pool.push(orderedSeeds[i].seedGameId)
  return pool
}

/** Advances (and persists) the per-user rotation cursor into [0, poolSize). */
function _nextRotationIndex(userId, poolSize) {
  if (poolSize <= 0) return 0
  try {
    const raw = localStorage.getItem(BECAUSE_YOU_PLAYED_ROTATION_KEY)
    const state = raw ? JSON.parse(raw) : {}
    const current = Number.isInteger(state[userId]) ? state[userId] : -1
    const next = (current + 1) % poolSize
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
 * NARROW + precise by design, unlike SwipeDeck (which draws broadly across
 * the whole taste vector — see SwipeDeck.jsx): every row returned here was
 * recommended *because of* the exact same single seed game, named in the
 * returned `seed.title`. Every call (mount, app resume, or an explicit
 * "show me another" refresh) advances a persisted per-user rotation
 * cursor through the user's cached seed set (see _buildRotationPool) —
 * so re-entering Explore or refreshing always surfaces a DIFFERENT real
 * cached seed, cycling through the set rather than reshuffling randomly
 * or recomputing anything.
 *
 * Composition only — reads getRecommendationSeeds + getSeedRecommendations
 * (both already precomputed by the daily job) and filters client-side.
 * NEVER calls IGDB directly; NEVER invents a seed or a pick. Hides
 * (returns null) when the engine has no qualifying seed for this user.
 *
 * @param {string} [userId]  Defaults to the current user.
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<null | {
 *   seed: { id: number, title: string },
 *   items: Array<{ game: object, matchScore: number }>,
 * }>}
 */
export async function getBecauseYouPlayed(userId, { limit = 10 } = {}) {
  try {
    const target = userId || (await currentUserId())
    if (!target) return null

    const [seeds, ownedIds] = await Promise.all([
      getRecommendationSeeds(target),
      _getOwnedGameIds(target),
    ])
    if (!seeds.length) return null // no qualifying seeds — hide gracefully, never fabricate one

    const pool = _buildRotationPool(seeds)
    const seedByGameId = new Map(seeds.map((s) => [s.seedGameId, s]))

    // Walk forward from the rotation cursor (bounded by pool size) so a
    // seed whose every pick happens to already be owned doesn't blank the
    // rail — it just steps to the next seed in the same forward sequence.
    for (let attempt = 0; attempt < pool.length; attempt++) {
      const idx = _nextRotationIndex(target, pool.length)
      const seedGameId = pool[idx]
      const seedMeta = seedByGameId.get(seedGameId)
      if (!seedMeta) continue

      const recs = await getSeedRecommendations(target, seedGameId, limit + ownedIds.size)
      const available = recs.filter((r) => r.game.id != null && !ownedIds.has(String(r.game.id)))
      if (!available.length) continue

      return {
        seed: { id: seedGameId, title: seedMeta.seedTitle },
        items: available.slice(0, limit).map((r) => ({ game: r.game, matchScore: r.matchScore })),
      }
    }

    return null
  } catch (err) {
    console.error('[tasteEngine] getBecauseYouPlayed crashed:', err)
    return null
  }
}

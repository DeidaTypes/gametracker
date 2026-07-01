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

import { supabase } from './supabase'

/**
 * Taste Engine — client read surface.
 *
 * These functions read ONLY from the precomputed server-side caches
 * (user_taste_vectors, user_hidden_gems) and the get_taste_match RPC.
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
 * Human-readable label per signal type, for building "why" copy. Deliberately
 * phrased as sentence fragments so a caller can join them:
 *   "Sport — because of your play time and a game you finished"
 */
export const SIGNAL_LABELS = Object.freeze({
  hours: 'your play time',
  finished: 'games you finished',
  rating: 'your ratings',
  review: 'reviews you wrote',
  list: 'games you listed',
  backlog: 'your backlog',
  swipe_right: 'games you swiped right on',
  swipe_left: 'games you passed on',
})

/**
 * Turn a raw genre_signals entry into the ordered, labelled shape the UI wants.
 * Signal types are sorted by how much they actually contributed, so the first
 * one is the honest headline reason. Negative contributors (swipe_left) are
 * reported separately — they explain why a genre ranks LOW and should never be
 * cited as a reason a game was recommended.
 */
function shapeGenreSignals(key, entry, affinity) {
  const raw = entry?.signals && typeof entry.signals === 'object' ? entry.signals : {}
  const all = Object.entries(raw)
    .map(([type, points]) => ({ type, points: Number(points) || 0, label: SIGNAL_LABELS[type] || type }))
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))

  return {
    genre: key,
    affinity: Number(affinity) || 0,
    raw: Number(entry?.raw) || 0,
    gameCount: Number(entry?.games) || 0,
    signals: all.filter((s) => s.points > 0),
    negativeSignals: all.filter((s) => s.points < 0),
    signalTypes: all.filter((s) => s.points > 0).map((s) => s.type),
  }
}

/** Build the sorted per-tag affinity array from a weights + signals pair. */
function buildAffinities(weights, signals) {
  return Object.entries(weights || {})
    .map(([key, affinity]) => shapeGenreSignals(key, (signals || {})[key], affinity))
    .sort((a, b) => b.affinity - a.affinity)
}

/**
 * getTasteVector(userId) — one user's behavioral taste profile.
 *
 * Returns per-genre affinities ALONGSIDE the signal types that produced each
 * one, so a downstream section can explain a recommendation ("more Sport,
 * because of your play time") instead of showing an unexplained number.
 *
 * Reads the precomputed `user_taste_vectors` row via RPC — never IGDB, never a
 * live recompute. Returns null (not a fabricated guess) when the daily job
 * hasn't built a vector for this user yet.
 *
 * A genre appears here only if the user has REAL positive signal in it, and
 * every genre listed has affinity > 0 — the engine guarantees a genre with real
 * signal is never reported as zero. Genres the user only ever swiped left on
 * are intentionally absent: that's a dislike, not an affinity.
 *
 * @param {string} [userId]  Defaults to the current user.
 * @returns {Promise<null | {
 *   userId: string,
 *   genres: Array<{                          // sorted, strongest first
 *     genre: string,
 *     affinity: number,                      // L2-normalized, always > 0
 *     raw: number,                           // pre-normalization points
 *     gameCount: number,
 *     signals: Array<{ type: string, points: number, label: string }>,
 *     negativeSignals: Array<{ type: string, points: number, label: string }>,
 *     signalTypes: string[],                 // positive contributors only
 *   }>,
 *   themes: Array<object>,                   // same shape, keyed by theme
 *   genreWeights: Record<string, number>,    // flat map, for cosine math
 *   themeWeights: Record<string, number>,
 *   signalTotals: Record<string, number>,    // user-level points by signal type
 *   behavior: {
 *     hoursTotal: number, sessionCount: number, ratedGameCount: number,
 *     reviewedCount: number, listGameCount: number, listsCreated: number,
 *     finishedCount: number, backlogCount: number,
 *     swipeRightCount: number, swipeLeftCount: number,
 *     trackedGameCount: number, lastSignalAt: string|null,
 *   },
 *   topRatedGameIds: number[],
 *   signalCount: number,
 *   confidence: number,                      // [0,1]
 *   updatedAt: string,
 * }>}
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

    const genreWeights = data.genre_weights || {}
    const themeWeights = data.theme_weights || {}

    return {
      userId: data.user_id,
      genres: buildAffinities(genreWeights, data.genre_signals),
      themes: buildAffinities(themeWeights, data.theme_signals),
      genreWeights,
      themeWeights,
      signalTotals: data.signal_totals || {},
      behavior: {
        hoursTotal: Number(data.hours_total) || 0,
        sessionCount: Number(data.session_count) || 0,
        ratedGameCount: Number(data.rated_game_count) || 0,
        reviewedCount: Number(data.reviewed_count) || 0,
        listGameCount: Number(data.list_game_count) || 0,
        listsCreated: Number(data.lists_created) || 0,
        finishedCount: Number(data.finished_count) || 0,
        backlogCount: Number(data.backlog_count) || 0,
        swipeRightCount: Number(data.swipe_right_count) || 0,
        swipeLeftCount: Number(data.swipe_left_count) || 0,
        trackedGameCount: Number(data.tracked_game_count) || 0,
        lastSignalAt: data.last_signal_at || null,
      },
      topRatedGameIds: data.top_rated_game_ids || [],
      // Kept for existing callers that read these at the top level.
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
 * explainGenreAffinity(vector, genre) — one-line "why" for a genre, built from
 * the contributing signal types.
 *
 * Returns null when the genre isn't in the vector or has no positive signal, so
 * callers render nothing rather than an invented reason.
 *
 * @param {object} vector  Result of getTasteVector.
 * @param {string} genre
 * @returns {string|null}  e.g. "because of your play time and games you finished"
 */
export function explainGenreAffinity(vector, genre) {
  const entry = vector?.genres?.find((g) => g.genre === genre)
  if (!entry || entry.signals.length === 0) return null
  const labels = entry.signals.slice(0, 2).map((s) => s.label)
  return `because of ${labels.length === 2 ? `${labels[0]} and ${labels[1]}` : labels[0]}`
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

const HIDDEN_GEMS_SLICE_ROTATION_KEY = 'gt:hidden-gems:slice-rotation:v1'

/** Advances (and persists) the per-user slice cursor into [0, sliceCount). */
function _nextHiddenGemsSlice(userId, sliceCount) {
  if (sliceCount <= 0) return 0
  try {
    const raw = localStorage.getItem(HIDDEN_GEMS_SLICE_ROTATION_KEY)
    const state = raw ? JSON.parse(raw) : {}
    const current = Number.isInteger(state[userId]) ? state[userId] : -1
    const next = (current + 1) % sliceCount
    state[userId] = next
    localStorage.setItem(HIDDEN_GEMS_SLICE_ROTATION_KEY, JSON.stringify(state))
    return next
  } catch {
    return 0
  }
}

/**
 * getHiddenGems(userId) — the Discover page's "Hidden gems for you" rail.
 *
 * Replaces "Because you played X": rather than anchoring to one seed
 * game's similar_games (which kept surfacing titles the user already
 * knew), this reads the user_hidden_gems cache — high total_rating, LOW
 * total_rating_count games scoped to the genres/themes the user's OWN
 * taste vector shows real affinity for (see getTasteVector) — so a
 * niche-indie player sees indies, a sports player sees sports, a horror
 * fan sees horror. `matchedTag` names exactly which real affinity
 * produced each pick.
 *
 * Every call (mount, app resume, or an explicit "show me another"
 * refresh) advances a persisted per-user cursor through fixed-size
 * slices of the user's cached pool (rank order, strongest match +
 * quality first) — so refreshing always surfaces a DIFFERENT slice,
 * cycling forward rather than reshuffling randomly or recomputing
 * anything. Purely a cache read + client-side owned-game filter — NEVER
 * calls IGDB. Hides (returns null) when the engine has too little
 * behavioral signal to personalize for this user, or nothing in the
 * cache survives the owned-game filter — never falls back to generic
 * popular games.
 *
 * @param {string} [userId]  Defaults to the current user.
 * @param {{ sliceSize?: number }} [opts]
 * @returns {Promise<null | {
 *   items: Array<{
 *     game: { id: number, title: string, image: string|null, genres: string[],
 *             totalRating: number|null, totalRatingCount: number|null },
 *     matchedTag: string|null,
 *     rank: number,
 *   }>,
 *   sliceIndex: number,
 *   totalSlices: number,
 * }>}
 */
export async function getHiddenGems(userId, { sliceSize = 6 } = {}) {
  try {
    const target = userId || (await currentUserId())
    if (!target) return null

    const [rows, ownedIds] = await Promise.all([
      _fetchHiddenGemRows(target),
      _getOwnedGameIds(target),
    ])
    if (!rows.length) return null // engine has nothing cached for this user — hide, never fabricate

    const available = rows.filter((r) => !ownedIds.has(String(r.game.id)))
    if (!available.length) return null

    const totalSlices = Math.max(1, Math.ceil(available.length / sliceSize))
    const sliceIndex = _nextHiddenGemsSlice(target, totalSlices)
    const items = available.slice(sliceIndex * sliceSize, sliceIndex * sliceSize + sliceSize)
    if (!items.length) return null

    return { items, sliceIndex, totalSlices }
  } catch (err) {
    console.error('[tasteEngine] getHiddenGems crashed:', err)
    return null
  }
}

/** Raw read of the user_hidden_gems cache, ordered strongest-first (rank asc). */
async function _fetchHiddenGemRows(userId) {
  const { data, error } = await supabase
    .from('user_hidden_gems')
    .select('*')
    .eq('user_id', userId)
    .order('rank', { ascending: true })

  if (error) {
    console.error('[tasteEngine] getHiddenGems query error:', error.message)
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
    matchedTag: row.matched_tag || null,
    rank: Number(row.rank) || 0,
  }))
}

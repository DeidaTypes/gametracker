/**
 * On-ramps — ranking accessible ENTRY POINTS into a genre.
 *
 * Used by both surfaces that ask "where should I start with this genre?":
 * Venture Out (an uncharted genre) and the genre detail grid's "good places
 * to start" strip. Both call rankOnRamps; neither reimplements the scoring.
 *
 * THE PROBLEM THIS SOLVES
 * Sorting a genre by rating does NOT produce good entry points — it produces
 * the genre's monuments. The top of Role-playing by rating is a wall of
 * 100-hour epics; the top of Platform is the hardest precision platformers.
 * Those are the titles a genre's existing fans revere precisely BECAUSE they
 * demand fluency, which makes them the worst possible first game. An on-ramp
 * is a different question from "what is best".
 *
 * THE MODEL — three factors, deliberately weighted
 *   quality  (0.45)  It still has to be a good game. Normalized across the
 *                    range that actually discriminates (70-95); below the
 *                    pool's quality floor this is 0.
 *   brevity  (0.40)  Weighted almost as heavily as quality, and that is the
 *                    whole point — it is what stops the ranking collapsing
 *                    back into "highest rated". A tight 8-hour game you will
 *                    actually finish teaches you a genre; a 90-hour epic you
 *                    bounce off teaches you that you dislike the genre.
 *   reach    (0.15)  Mild. A game with a large rating count has broad appeal
 *                    beyond genre devotees, and has guides/community if the
 *                    player gets stuck. Kept small so it can't turn this into
 *                    a popularity list.
 *
 * Unknown completion time scores NEUTRAL_BREVITY, not zero and not one. IGDB
 * has no community time for plenty of good games, and that absence says
 * nothing about length — penalizing it would silently bury them, rewarding it
 * would let unmeasured games outrank known-short ones.
 *
 * The per-user half (themes they already like) is applied separately in
 * rankOnRamps, so the user-independent half can be precomputed once per game
 * by the daily job. See `accessibility` on genre_game_pools.
 *
 * NOTE: supabase/functions/taste-engine/gamingMap.ts carries a port of
 * scoreAccessibility so the daily job can precompute it server-side. The two
 * must agree — the constants below are the reference. (Same arrangement as
 * the IGDB throttle, which is likewise mirrored between src/services/igdb.js
 * and the Edge Function.)
 */

// ── Accessibility model (user-independent) ──────────────────────────────────
const QUALITY_FLOOR = 70    // total_rating at/below this scores 0 quality
const QUALITY_CEIL = 95     // and at/above this, a full 1
const SHORT_HOURS = 6       // ≤ this is maximally approachable
const LONG_HOURS = 60       // ≥ this is maximally daunting
const NEUTRAL_BREVITY = 0.5 // IGDB has no completion time — an honest unknown
const REACH_SATURATION = 500 // rating_count at which "well known" maxes out

const W_QUALITY = 0.45
const W_BREVITY = 0.40
const W_REACH = 0.15

// ── Taste blending (per-user) ───────────────────────────────────────────────
// How much of the final match score comes from "themes you already like"
// versus raw accessibility. Held below 0.5 on purpose: this ranks entry points
// into a genre the user does NOT know, so accessibility has to lead. Taste
// breaks ties and colours the ordering; it does not choose the list.
const W_TASTE = 0.3

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * The user-independent half of an on-ramp score, 0-100.
 *
 * @param {{ totalRating?: number|null, totalRatingCount?: number|null,
 *           timeToBeatSeconds?: number|null }} game
 * @returns {number} 0-100
 */
export function scoreAccessibility(game) {
  const rating = Number(game?.totalRating)
  const count = Number(game?.totalRatingCount)
  const ttb = Number(game?.timeToBeatSeconds)

  const quality = Number.isFinite(rating)
    ? clamp01((rating - QUALITY_FLOOR) / (QUALITY_CEIL - QUALITY_FLOOR))
    : 0

  let brevity = NEUTRAL_BREVITY
  if (Number.isFinite(ttb) && ttb > 0) {
    const hours = ttb / 3600
    brevity = clamp01((LONG_HOURS - hours) / (LONG_HOURS - SHORT_HOURS))
  }

  const reach = Number.isFinite(count) && count > 0
    ? clamp01(Math.log1p(count) / Math.log1p(REACH_SATURATION))
    : 0

  return Math.round((W_QUALITY * quality + W_BREVITY * brevity + W_REACH * reach) * 100)
}

/**
 * Build a name → relative-strength (0-1) map from a taste vector's themes.
 *
 * Taste vectors are L2-normalized, so absolute weights depend on how many
 * themes a user has signal in — 0.4 is a dominant theme for one user and a
 * minor one for another. Rescaling against the user's OWN strongest theme
 * makes the bonus mean the same thing for everybody.
 */
function relativeThemeStrength(tasteVector) {
  const weights = tasteVector?.themeWeights
  if (!weights) return null
  const values = Object.values(weights).filter((v) => Number(v) > 0)
  if (values.length === 0) return null
  const top = Math.max(...values.map(Number))
  if (!(top > 0)) return null

  const out = new Map()
  for (const [name, weight] of Object.entries(weights)) {
    const w = Number(weight)
    if (w > 0) out.set(String(name).toLowerCase(), clamp01(w / top))
  }
  return out
}

/**
 * How well a game's themes match what the user already likes.
 * Returns the strongest single match, not a sum — a game tagged with five
 * themes shouldn't out-score a perfect single-theme match just for carrying
 * more tags.
 */
function themeFit(game, strengthByTheme) {
  const themes = Array.isArray(game?.themeNames) ? game.themeNames : []
  if (!strengthByTheme || themes.length === 0) return { fit: 0, matched: [] }

  let fit = 0
  const matched = []
  for (const theme of themes) {
    const strength = strengthByTheme.get(String(theme).toLowerCase())
    if (strength == null) continue
    matched.push(theme)
    if (strength > fit) fit = strength
  }
  // Strongest match first, so the "because you like X" line cites the real
  // reason this game ranked rather than whichever theme IGDB listed first.
  matched.sort(
    (a, b) =>
      (strengthByTheme.get(String(b).toLowerCase()) || 0) -
      (strengthByTheme.get(String(a).toLowerCase()) || 0),
  )
  return { fit, matched }
}

/**
 * rankOnRamps(games, tasteVector, opts) — order games by how good an ENTRY
 * POINT into their genre they are.
 *
 * Accepts games from either source without the caller caring which:
 *   • cached pool rows, which already carry a precomputed `accessibility`
 *   • raw games, for which accessibility is computed here on the spot
 *
 * Pure and synchronous — never touches the network. The pool it ranks has
 * already been fetched from cache by the caller.
 *
 * @param {Array<{
 *   id: number|string, title?: string, accessibility?: number|null,
 *   totalRating?: number|null, totalRatingCount?: number|null,
 *   timeToBeatSeconds?: number|null, themeNames?: string[],
 * }>} games
 * @param {object|null} tasteVector  Result of getTasteVector; null is fine —
 *                                   ranking then falls back to pure accessibility.
 * @param {{ limit?: number }} [opts]
 * @returns {Array<object>} the same game objects, each with `onRamp` attached:
 *   { score: 0-100, accessibility: 0-100, tasteFit: 0-1, matchedThemes: string[],
 *     hoursToBeat: number|null }
 */
export function rankOnRamps(games, tasteVector, opts = {}) {
  if (!Array.isArray(games) || games.length === 0) return []
  const strengthByTheme = relativeThemeStrength(tasteVector)

  const scored = games.map((game) => {
    const accessibility = Number.isFinite(Number(game?.accessibility))
      ? Number(game.accessibility)
      : scoreAccessibility(game)

    const { fit, matched } = themeFit(game, strengthByTheme)

    // With no taste signal, taste contributes nothing rather than a neutral
    // half-score — a new user should get the honestly-most-accessible games,
    // not games nudged by a vector that doesn't exist yet.
    const score = strengthByTheme
      ? (1 - W_TASTE) * accessibility + W_TASTE * fit * 100
      : accessibility

    const ttb = Number(game?.timeToBeatSeconds)

    return {
      ...game,
      onRamp: {
        score: Math.round(score),
        accessibility,
        tasteFit: Math.round(fit * 100) / 100,
        matchedThemes: matched,
        hoursToBeat: Number.isFinite(ttb) && ttb > 0 ? Math.round(ttb / 360) / 10 : null,
      },
    }
  })

  scored.sort((a, b) => {
    if (b.onRamp.score !== a.onRamp.score) return b.onRamp.score - a.onRamp.score
    // Deterministic tiebreak, so the same pool always renders in the same
    // order instead of shuffling between reads.
    return Number(a.id) - Number(b.id)
  })

  const limit = Number(opts.limit)
  return Number.isFinite(limit) && limit > 0 ? scored.slice(0, limit) : scored
}

/**
 * One-line "why this is a good place to start", built only from facts the
 * score actually used. Returns null when nothing honest can be said, so
 * callers render nothing rather than an invented reason.
 *
 * @param {{ onRamp?: { hoursToBeat: number|null, matchedThemes: string[] },
 *           totalRating?: number|null }} game
 * @returns {string|null}
 */
export function explainOnRamp(game) {
  const parts = []
  const hours = game?.onRamp?.hoursToBeat
  if (hours != null && hours <= SHORT_HOURS * 2) {
    parts.push(`about ${Math.round(hours)}h to finish`)
  }
  const rating = Number(game?.totalRating)
  if (Number.isFinite(rating) && rating >= 80) parts.push('highly rated')
  const theme = game?.onRamp?.matchedThemes?.[0]
  if (theme) parts.push(`${theme.toLowerCase()}, which you already like`)

  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

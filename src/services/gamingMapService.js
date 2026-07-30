import { supabase } from './supabase'
import { getTasteVector } from './tasteEngineService'
import { IGDB_GENRES, genreById, normalizeGenreIds, genreIdsFromNames } from './igdbGenres'
import { rankOnRamps } from './onRamps'
import { getAllLists, getGameProgress } from './libraryService'
import { igdbRequest } from './igdb'

/**
 * Your Gaming Map — data layer.
 *
 * Sorts the 23 formal IGDB genres (see igdbGenres.js) into four tiers for one
 * user, and serves the cached per-genre game pools the map's detail grid and
 * Venture Out read from.
 *
 * TWO SOURCES, ONE MAP
 * The tiers are derived from the user's OWN data, never from IGDB. That data
 * lives in two places and both are required:
 *   • localStorage — the primary library. setGameStatus writes here and
 *     nowhere else, so Want to Play / Playing / Played / Dropped only fully
 *     exist on-device. This is also what makes the map update in REAL TIME:
 *     a status change is visible on the very next getGamingMap call, with no
 *     job to wait for.
 *   • Supabase — hours (play_sessions rolled into game_trackers.hours_played),
 *     ratings (reviews / game_trackers), and backlog intent recorded from
 *     swipes. Also the only source available when viewing SOMEONE ELSE's map.
 *
 * NO IGDB ON A ROUTINE READ
 * Nothing in this file calls IGDB except fetchGenrePageLive, which exists
 * solely for scrolling PAST the cached pool. Genres come from the `game_tags`
 * cache; pools come from `genre_game_pools` / `user_genre_pools`, refreshed by
 * the daily taste-engine job. A game with no cached genres is reported as
 * unresolved and queued for the job to resolve — the map never fixes that by
 * reaching for IGDB mid-render.
 */

// ── Tier model ──────────────────────────────────────────────────────────────
// Blended score inputs. Hours outweighs game count for the same reason the
// taste engine's HOURS_COEF does: time spent is the truest statement of
// preference, and log-shaping keeps one 300-hour obsession from flattening
// everything else on the map to nothing.
const W_GAMES = 3.0   // × ln(1 + engaged games)
const W_HOURS = 4.0   // × ln(1 + hours)
const W_RATING = 2.0  // × (avg/5) × ln(1 + rated games)

// A genre you touched last month should read as more "home" than one you left
// behind in 2019, but volume still leads — this is a map of a gaming life, not
// a 90-day activity chart, so recency is a nudge and not a decay.
const RECENT_WINDOW_DAYS = 90
const RECENCY_BOOST = 0.25

// HOME TURF is capped so the map has a few clear home regions instead of a
// gradient. A genre must ALSO clear a real depth bar to qualify — being
// someone's 3rd-best genre means nothing if they've played two games in it.
const HOME_TURF_MAX = 5
const HOME_TURF_MIN_GAMES = 3
const HOME_TURF_MIN_HOURS = 20 // an alternate route in: one 60-hour MMO is home turf

export const TIERS = Object.freeze({
  HOME_TURF: 'home_turf',
  EXPLORING: 'exploring',
  ON_HORIZON: 'on_horizon',
  NOT_YET: 'not_yet',
})

export const TIER_LABELS = Object.freeze({
  home_turf: 'Home turf',
  exploring: 'Exploring',
  on_horizon: 'On the horizon',
  not_yet: "Haven't explored",
})

// Statuses, in both vocabularies the app speaks. The local library uses
// 'want'/'currently'; game_trackers.status uses 'want_to_play'/'playing'.
// See TRACKER_STATUS in libraryService.js for why they differ.
const BACKLOG_STATUSES = new Set(['want', 'want_to_play', 'want-to-play', 'backlog'])
const PLAYED_STATUSES = new Set(['played', 'completed', 'finished'])
const PLAYING_STATUSES = new Set(['currently', 'playing'])
const DROPPED_STATUSES = new Set(['dropped'])

const RATING_SCALE_MAX = 5 // reviews.rating / game_trackers.rating are 0-5 stars
const TAG_CHUNK = 200      // ids per game_tags `in (...)` filter

function coverUrlFromImageId(imageId) {
  if (!imageId) return null
  return `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`
}

async function currentUserId() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    return user?.id || null
  } catch {
    return null
  }
}

const toMs = (value) => {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

const maxMs = (...values) => {
  let best = null
  for (const v of values) if (v != null && (best == null || v > best)) best = v
  return best
}

const numOrNull = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ── Gathering the user's games ──────────────────────────────────────────────

/**
 * One game as the map sees it, merged across every source.
 * @typedef {{
 *   id: number, title: string|null, status: string|null,
 *   hours: number, rating: number|null, lastActivityAt: number|null,
 *   genreIds: number[], localGenreText: string|null,
 * }} MapGame
 */

/** Read the on-device library. Only ever available for the signed-in user. */
function readLocalGames() {
  const games = new Map()
  let lists
  try {
    lists = getAllLists()
  } catch {
    return games
  }

  const statusByList = {
    'want-to-play': 'want',
    'currently-playing': 'currently',
    played: 'played',
    dropped: 'dropped',
  }

  for (const [listId, status] of Object.entries(statusByList)) {
    for (const game of lists?.[listId]?.games || []) {
      const id = Number(game?.id)
      if (!Number.isFinite(id) || id <= 0) continue

      // gameProgress mirrors hours + last-played on-device. Treated as one
      // more source of the SAME hours, reconciled by max() below — never
      // added to the server's count.
      let progress = {}
      try {
        progress = getGameProgress(id) || {}
      } catch { /* progress is optional */ }

      games.set(id, {
        id,
        title: game.title || null,
        status,
        hours: Number(progress.hoursPlayed) > 0 ? Number(progress.hoursPlayed) : 0,
        rating: null,
        lastActivityAt: maxMs(toMs(progress.lastPlayedAt), toMs(progress.playedFirstAt), toMs(game.addedAt)),
        genreIds: [],
        // Library entries carry a denormalized genre STRING from whatever
        // surface added them. A weak fallback, but it rescues a game that
        // has no game_tags row yet from being unplaceable.
        localGenreText: typeof game.genre === 'string' ? game.genre : null,
      })
    }
  }
  return games
}

/**
 * Merge the Supabase-side signals into the game map.
 *
 * Hours arrive from three places that describe the SAME time and must not be
 * summed — play_sessions.hours, game_trackers.hours_played (the roll-up
 * trigger's total of exactly those sessions) and reviews.hours_played
 * (self-reported). Taking max() is the same reconciliation the taste engine
 * does; see the hoursBySource block in the Edge Function.
 */
async function mergeRemoteGames(games, userId) {
  const ensure = (id, title) => {
    let g = games.get(id)
    if (!g) {
      g = {
        id, title: title || null, status: null, hours: 0, rating: null,
        lastActivityAt: null, genreIds: [], localGenreText: null,
      }
      games.set(id, g)
    }
    if (!g.title && title) g.title = title
    return g
  }

  const [trackers, reviews, sessions, swipes] = await Promise.all([
    supabase.from('game_trackers')
      .select('igdb_game_id, status, hours_played, rating, game_title, last_played_at, updated_at')
      .eq('user_id', userId),
    supabase.from('reviews')
      .select('igdb_game_id, rating, hours_played, game_title, created_at, updated_at')
      .eq('user_id', userId),
    supabase.from('play_sessions')
      .select('igdb_game_id, hours, seconds, ended_at, played_on')
      .eq('user_id', userId)
      .not('ended_at', 'is', null),
    supabase.from('user_swipe_signals')
      .select('igdb_game_id, action, genre_names, swiped_at')
      .eq('user_id', userId)
      .eq('action', 'backlog'),
  ])

  for (const key of ['trackers', 'reviews', 'sessions', 'swipes']) {
    const res = { trackers, reviews, sessions, swipes }[key]
    if (res?.error) console.error(`[gamingMap] ${key} read failed:`, res.error.message)
  }

  // Sessions first, so their summed hours are available as one candidate.
  const sessionHours = new Map()
  for (const s of sessions?.data || []) {
    const id = Number(s.igdb_game_id)
    if (!Number.isFinite(id) || id <= 0) continue
    const hours = Number(s.hours)
    const seconds = Number(s.seconds)
    const h = hours > 0 ? hours : (seconds > 0 ? seconds / 3600 : 0)
    const prev = sessionHours.get(id) || { hours: 0, at: null }
    sessionHours.set(id, {
      hours: prev.hours + h,
      at: maxMs(prev.at, toMs(s.ended_at), toMs(s.played_on)),
    })
    const g = ensure(id, null)
    g.lastActivityAt = maxMs(g.lastActivityAt, toMs(s.ended_at), toMs(s.played_on))
  }
  for (const [id, ev] of sessionHours) {
    const g = ensure(id, null)
    if (ev.hours > g.hours) g.hours = ev.hours
  }

  for (const t of trackers?.data || []) {
    const id = Number(t.igdb_game_id)
    if (!Number.isFinite(id) || id <= 0) continue
    const g = ensure(id, t.game_title)
    // The local library wins on status when we have it — it is the store the
    // user actually edits, so a stale synced row must never override it.
    if (!g.status && t.status) g.status = String(t.status).toLowerCase()
    const th = Number(t.hours_played)
    if (th > 0 && th > g.hours) g.hours = th
    const tr = Number(t.rating)
    if (tr > 0 && g.rating == null) g.rating = tr
    g.lastActivityAt = maxMs(g.lastActivityAt, toMs(t.last_played_at), toMs(t.updated_at))
  }

  for (const r of reviews?.data || []) {
    const id = Number(r.igdb_game_id)
    if (!Number.isFinite(id) || id <= 0) continue
    const g = ensure(id, r.game_title)
    const rr = Number(r.rating)
    // A written review's rating is the more considered of the two and wins
    // over a quick tracker star.
    if (rr > 0) g.rating = rr
    const rh = Number(r.hours_played)
    if (rh > 0 && rh > g.hours) g.hours = rh
    g.lastActivityAt = maxMs(g.lastActivityAt, toMs(r.updated_at), toMs(r.created_at))
  }

  // A swipe-right IS a backlog add — it is how most backlog intent is
  // actually expressed in this app. It only sets status when nothing
  // stronger is known, so it can never demote a played game to backlog.
  for (const s of swipes?.data || []) {
    const id = Number(s.igdb_game_id)
    if (!Number.isFinite(id) || id <= 0) continue
    const g = ensure(id, null)
    if (!g.status) g.status = 'want'
    if (!g.genreIds.length && Array.isArray(s.genre_names)) {
      g.genreIds = genreIdsFromNames(s.genre_names)
    }
    g.lastActivityAt = maxMs(g.lastActivityAt, toMs(s.swiped_at))
  }

  return games
}

/**
 * Fill in each game's formal genre ids from the `game_tags` cache.
 * Reads only — a cache miss is reported, never resolved with a live call.
 * @returns {Promise<number[]>} ids that could not be resolved
 */
async function resolveGenresFromCache(games) {
  const needing = Array.from(games.values()).filter((g) => g.genreIds.length === 0)
  const ids = needing.map((g) => g.id)

  for (let i = 0; i < ids.length; i += TAG_CHUNK) {
    const chunk = ids.slice(i, i + TAG_CHUNK)
    const { data, error } = await supabase
      .from('game_tags')
      .select('igdb_game_id, name, genre_ids, genre_names')
      .in('igdb_game_id', chunk)
    if (error) {
      console.error('[gamingMap] game_tags read failed:', error.message)
      continue
    }
    for (const row of data || []) {
      const g = games.get(Number(row.igdb_game_id))
      if (!g) continue
      const fromIds = normalizeGenreIds(row.genre_ids)
      g.genreIds = fromIds.length ? fromIds : genreIdsFromNames(row.genre_names)
      if (!g.title && row.name) g.title = row.name
    }
  }

  // Last resort for on-device games the daily job has never seen: the genre
  // string the library stored when the game was added. Only exact matches on
  // a formal genre name count — a fuzzy match would put games on the wrong
  // tile, which is worse than leaving them off the map and saying so.
  const unresolved = []
  for (const g of games.values()) {
    if (g.genreIds.length > 0) continue
    if (g.localGenreText) {
      const parsed = genreIdsFromNames(g.localGenreText.split(',').map((s) => s.trim()))
      if (parsed.length) {
        g.genreIds = parsed
        continue
      }
    }
    unresolved.push(g.id)
  }
  return unresolved
}

// ── Tier classification ─────────────────────────────────────────────────────

function emptyStats() {
  return {
    gameCount: 0, playedCount: 0, playingCount: 0, droppedCount: 0,
    backlogCount: 0, hours: 0, ratedCount: 0, ratingSum: 0,
    recentCount: 0, lastActivityAt: null,
  }
}

/**
 * Fold games into per-genre stats.
 *
 * A game counts toward EVERY formal genre it carries. That is deliberate: a
 * game tagged Adventure + Indie is genuinely evidence in both, and picking one
 * "primary" genre would mean inventing a priority IGDB doesn't publish. The
 * consequence is that genre game counts sum to more than the library size,
 * which is correct for a map of terrain covered.
 */
function accumulateGenreStats(games) {
  const byGenre = new Map(IGDB_GENRES.map((g) => [g.id, emptyStats()]))
  const recentCutoff = Date.now() - RECENT_WINDOW_DAYS * 86400000

  for (const game of games.values()) {
    const status = game.status ? String(game.status).toLowerCase() : null
    const isBacklog = status != null && BACKLOG_STATUSES.has(status)
    const isPlayed = status != null && PLAYED_STATUSES.has(status)
    const isPlaying = status != null && PLAYING_STATUSES.has(status)
    const isDropped = status != null && DROPPED_STATUSES.has(status)
    const hasRating = game.rating != null && game.rating > 0

    // "Engaged" = real evidence they played it. Hours or a rating count even
    // with no status at all, which is how a game synced from another device
    // still lands on the map.
    const engaged = isPlayed || isPlaying || isDropped || game.hours > 0 || hasRating
    if (!engaged && !isBacklog) continue

    for (const genreId of game.genreIds) {
      const s = byGenre.get(genreId)
      if (!s) continue

      if (isBacklog && !engaged) {
        s.backlogCount++
        s.lastActivityAt = maxMs(s.lastActivityAt, game.lastActivityAt)
        continue
      }
      if (isBacklog) s.backlogCount++

      s.gameCount++
      if (isPlayed) s.playedCount++
      if (isPlaying) s.playingCount++
      if (isDropped) s.droppedCount++
      s.hours += game.hours
      if (hasRating) {
        s.ratedCount++
        s.ratingSum += game.rating
      }
      if (game.lastActivityAt != null && game.lastActivityAt >= recentCutoff) s.recentCount++
      s.lastActivityAt = maxMs(s.lastActivityAt, game.lastActivityAt)
    }
  }
  return byGenre
}

/** Blended games + hours + ratings score, lightly lifted by recent activity. */
function blendedScore(stats) {
  if (stats.gameCount === 0) return 0
  const avgRating = stats.ratedCount > 0 ? stats.ratingSum / stats.ratedCount : 0

  const base =
    W_GAMES * Math.log1p(stats.gameCount) +
    W_HOURS * Math.log1p(stats.hours) +
    W_RATING * (avgRating / RATING_SCALE_MAX) * Math.log1p(stats.ratedCount)

  const recentShare = stats.gameCount > 0 ? stats.recentCount / stats.gameCount : 0
  return base * (1 + RECENCY_BOOST * recentShare)
}

/**
 * Assign one tier per genre. Every genre gets exactly one, and all 23 are
 * always classified — "you have never played a Racing game" is a tile the map
 * has to draw, not an absence.
 */
function assignTiers(byGenre) {
  const scored = IGDB_GENRES.map((genre) => {
    const stats = byGenre.get(genre.id) || emptyStats()
    return { genre, stats, score: blendedScore(stats) }
  })

  const engaged = scored
    .filter((row) => row.stats.gameCount > 0)
    .sort((a, b) => b.score - a.score)

  const homeTurf = new Set()
  for (const row of engaged) {
    if (homeTurf.size >= HOME_TURF_MAX) break
    const deepEnough =
      row.stats.gameCount >= HOME_TURF_MIN_GAMES || row.stats.hours >= HOME_TURF_MIN_HOURS
    if (deepEnough) homeTurf.add(row.genre.id)
  }

  const tierOf = (row) => {
    if (homeTurf.has(row.genre.id)) return TIERS.HOME_TURF
    if (row.stats.gameCount > 0) return TIERS.EXPLORING
    // Backlogged but nothing played or rated here yet — the definition of
    // ON THE HORIZON. gameCount is 0 precisely because a pure backlog entry
    // never increments it.
    if (row.stats.backlogCount > 0) return TIERS.ON_HORIZON
    return TIERS.NOT_YET
  }

  const withTiers = scored.map((row) => ({ ...row, tier: tierOf(row) }))

  // tier_rank orders within a tier: by score where there is one, else by
  // backlog depth (a genre with 4 games waiting is further "on the horizon"
  // than one with a single impulse add), else canonical order.
  const rankCounters = {}
  for (const tier of Object.values(TIERS)) {
    const members = withTiers
      .filter((r) => r.tier === tier)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        if (b.stats.backlogCount !== a.stats.backlogCount) {
          return b.stats.backlogCount - a.stats.backlogCount
        }
        return a.genre.sortOrder - b.genre.sortOrder
      })
    members.forEach((row, i) => { rankCounters[`${tier}:${row.genre.id}`] = i + 1 })
  }

  return withTiers.map((row) => ({
    ...row,
    tierRank: rankCounters[`${row.tier}:${row.genre.id}`] || 0,
  }))
}

// ── Public read surface ─────────────────────────────────────────────────────

/**
 * getGamingMap(userId) — the user's 23 genres, each with its tier and the
 * stats a map tile renders.
 *
 * Recomputed on every call from the user's real library/backlog/sessions/
 * ratings, so it reflects a status change immediately — there is no job to
 * wait for. Reads the `game_tags` cache for genres and the precomputed taste
 * vector for affinity; never calls IGDB.
 *
 * Viewing your OWN map merges localStorage with Supabase. Viewing someone
 * else's can only use Supabase, so `source` reports which happened and
 * `coverage` reports how many of their games could be placed — a caller
 * should present a partial map honestly rather than as a complete one.
 *
 * @param {string} [userId] Defaults to the current user.
 * @returns {Promise<null | {
 *   userId: string,
 *   source: 'local+remote' | 'remote',
 *   generatedAt: string,
 *   genres: Array<{
 *     id: number, name: string, slug: string, sortOrder: number,
 *     tier: 'home_turf'|'exploring'|'on_horizon'|'not_yet',
 *     tierRank: number, score: number, affinity: number|null,
 *     stats: { gameCount: number, playedCount: number, playingCount: number,
 *              droppedCount: number, backlogCount: number, hours: number,
 *              avgRating: number|null, ratedCount: number,
 *              lastActivityAt: string|null },
 *   }>,
 *   tiers: Record<string, number[]>,
 *   coverage: { placedGames: number, unresolvedGames: number },
 * }>}
 */
export async function getGamingMap(userId) {
  try {
    const viewerId = await currentUserId()
    const targetId = userId || viewerId
    if (!targetId) return null
    const isSelf = targetId === viewerId

    const games = isSelf ? readLocalGames() : new Map()
    await mergeRemoteGames(games, targetId)
    const unresolved = await resolveGenresFromCache(games)

    const byGenre = accumulateGenreStats(games)
    const rows = assignTiers(byGenre)

    // Reuse the B1 taste vector for affinity rather than recomputing anything
    // it already knows. Its keys are genre NAMES, which is exactly why
    // igdbGenres.js pins the exact IGDB spelling.
    const vector = await getTasteVector(targetId)
    const affinityByName = vector?.genreWeights || {}

    const genres = rows
      .sort((a, b) => a.genre.sortOrder - b.genre.sortOrder)
      .map(({ genre, stats, score, tier, tierRank }) => ({
        id: genre.id,
        name: genre.name,
        slug: genre.slug,
        sortOrder: genre.sortOrder,
        tier,
        tierRank,
        score: Math.round(score * 100) / 100,
        affinity: numOrNull(affinityByName[genre.name]),
        stats: {
          gameCount: stats.gameCount,
          playedCount: stats.playedCount,
          playingCount: stats.playingCount,
          droppedCount: stats.droppedCount,
          backlogCount: stats.backlogCount,
          hours: Math.round(stats.hours * 10) / 10,
          avgRating: stats.ratedCount > 0
            ? Math.round((stats.ratingSum / stats.ratedCount) * 10) / 10
            : null,
          ratedCount: stats.ratedCount,
          lastActivityAt: stats.lastActivityAt != null
            ? new Date(stats.lastActivityAt).toISOString()
            : null,
        },
      }))

    const tiers = { home_turf: [], exploring: [], on_horizon: [], not_yet: [] }
    for (const g of genres) tiers[g.tier].push(g.id)

    const map = {
      userId: targetId,
      source: isSelf ? 'local+remote' : 'remote',
      generatedAt: new Date().toISOString(),
      genres,
      tiers,
      coverage: {
        placedGames: games.size - unresolved.length,
        unresolvedGames: unresolved.length,
      },
    }

    // Persist so the map is readable server-side (the daily job needs to know
    // which genres are genuinely uncharted before it builds Venture Out
    // pools) and by other users. Best-effort and non-blocking — a failed
    // write must never stop the map from rendering.
    if (isSelf) void persistSnapshot(targetId, genres, unresolved, games.size)

    return map
  } catch (err) {
    console.error('[gamingMap] getGamingMap crashed:', err)
    return null
  }
}

// Writing 23 rows on every render would be wasteful, and the snapshot only
// matters to a job that runs once a day. Rate-limit to one write per session
// per meaningful change.
let lastSnapshotKey = null

async function persistSnapshot(userId, genres, unresolved, totalGames) {
  try {
    const key = genres.map((g) => `${g.id}:${g.tier}:${g.score}`).join('|')
    if (key === lastSnapshotKey) return
    lastSnapshotKey = key

    const computedAt = new Date().toISOString()
    const rows = genres.map((g) => ({
      user_id: userId,
      genre_id: g.id,
      tier: g.tier,
      tier_rank: g.tierRank,
      score: g.score,
      game_count: g.stats.gameCount,
      played_count: g.stats.playedCount,
      dropped_count: g.stats.droppedCount,
      backlog_count: g.stats.backlogCount,
      hours: g.stats.hours,
      avg_rating: g.stats.avgRating,
      rated_count: g.stats.ratedCount,
      affinity: g.affinity,
      last_activity_at: g.stats.lastActivityAt,
      source: 'client',
      computed_at: computedAt,
    }))

    const { error } = await supabase
      .from('user_gaming_map')
      .upsert(rows, { onConflict: 'user_id,genre_id' })
    if (error) console.error('[gamingMap] snapshot upsert failed:', error.message)

    // Hand the daily job the ids it needs to resolve so the map self-heals
    // without any read ever calling IGDB.
    const { error: metaError } = await supabase
      .from('user_gaming_map_meta')
      .upsert({
        user_id: userId,
        unresolved_game_ids: unresolved.slice(0, 500),
        unresolved_count: unresolved.length,
        resolved_count: Math.max(0, totalGames - unresolved.length),
        computed_at: computedAt,
      }, { onConflict: 'user_id' })
    if (metaError) console.error('[gamingMap] meta upsert failed:', metaError.message)
  } catch (err) {
    console.error('[gamingMap] persistSnapshot crashed:', err)
  }
}

// ── Per-genre pools ─────────────────────────────────────────────────────────

const POOL_COLUMNS =
  'igdb_game_id, rank, game_title, cover_image_id, release_year, total_rating, ' +
  'total_rating_count, theme_names, time_to_beat_seconds, accessibility'

function shapePoolRow(row) {
  return {
    id: Number(row.igdb_game_id),
    title: row.game_title || null,
    image: coverUrlFromImageId(row.cover_image_id),
    year: row.release_year ?? null,
    totalRating: numOrNull(row.total_rating),
    totalRatingCount: numOrNull(row.total_rating_count),
    themeNames: Array.isArray(row.theme_names) ? row.theme_names : [],
    timeToBeatSeconds: numOrNull(row.time_to_beat_seconds),
    accessibility: numOrNull(row.accessibility),
    rank: Number(row.rank) || 0,
  }
}

export const GENRE_SORTS = Object.freeze(['top_rated', 'popular', 'new'])

/**
 * getGenrePool(genreId, sort, opts) — a page of the cached per-genre pool.
 *
 * Pure cache read. The pool holds the top ~100 per (genre, sort); once a
 * caller pages past `total`, it should switch to fetchGenrePageLive, which is
 * the only path in this file allowed to reach IGDB.
 *
 * @returns {Promise<{ games: object[], total: number, exhausted: boolean,
 *                     refreshedAt: string|null }>}
 */
export async function getGenrePool(genreId, sort = 'top_rated', opts = {}) {
  const empty = { games: [], total: 0, exhausted: true, refreshedAt: null }
  try {
    const genre = genreById(genreId)
    if (!genre || !GENRE_SORTS.includes(sort)) return empty

    const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 50
    const offset = Number(opts.offset) > 0 ? Number(opts.offset) : 0

    const { data, error, count } = await supabase
      .from('genre_game_pools')
      .select(`${POOL_COLUMNS}, refreshed_at`, { count: 'exact' })
      .eq('genre_id', genre.id)
      .eq('sort_key', sort)
      .order('rank', { ascending: true })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('[gamingMap] getGenrePool failed:', error.message)
      return empty
    }

    const games = (data || []).map(shapePoolRow)
    const total = count ?? games.length
    return {
      games,
      total,
      exhausted: offset + games.length >= total,
      refreshedAt: data?.[0]?.refreshed_at || null,
    }
  } catch (err) {
    console.error('[gamingMap] getGenrePool crashed:', err)
    return empty
  }
}

/**
 * getGoodPlacesToStart(genreId, opts) — on-ramps for a genre.
 *
 * Reads the accessible end of the cached pool (precomputed `accessibility`,
 * so this is an indexed SELECT, not a scan) and then applies the per-user
 * half of the ranking with the taste vector. Backs the genre grid's "good
 * places to start" strip.
 *
 * @returns {Promise<object[]>} games with `onRamp` attached; see rankOnRamps.
 */
export async function getGoodPlacesToStart(genreId, opts = {}) {
  try {
    const genre = genreById(genreId)
    if (!genre) return []
    const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 12

    // Over-fetch the accessible end so the taste pass has room to reorder
    // rather than just trimming an already-final list.
    const { data, error } = await supabase
      .from('genre_game_pools')
      .select(POOL_COLUMNS)
      .eq('genre_id', genre.id)
      .not('accessibility', 'is', null)
      .order('accessibility', { ascending: false })
      .limit(Math.max(limit * 4, 40))

    if (error) {
      console.error('[gamingMap] getGoodPlacesToStart failed:', error.message)
      return []
    }

    // One game can appear under several sorts; the pool is keyed per sort so
    // dedupe before ranking or the strip repeats titles.
    const seen = new Set()
    const games = []
    for (const row of data || []) {
      const id = Number(row.igdb_game_id)
      if (seen.has(id)) continue
      seen.add(id)
      games.push(shapePoolRow(row))
    }

    const vector = opts.tasteVector !== undefined
      ? opts.tasteVector
      : await getTasteVector()
    return rankOnRamps(games, vector, { limit })
  } catch (err) {
    console.error('[gamingMap] getGoodPlacesToStart crashed:', err)
    return []
  }
}

/**
 * getVentureOutPool(genreId, opts) — the user's cached Venture Out pool for an
 * uncharted genre.
 *
 * Built nightly per user: quality-gated, biased toward themes they already
 * like, with owned and backlogged games removed. A pure cache read; returns
 * [] when the job hasn't built one yet (a genre they've already explored, or
 * a brand-new account) rather than falling back to generic popular games.
 *
 * @returns {Promise<object[]>}
 */
export async function getVentureOutPool(genreId, opts = {}) {
  try {
    const genre = genreById(genreId)
    if (!genre) return []
    const userId = opts.userId || (await currentUserId())
    if (!userId) return []
    const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 40

    const { data, error } = await supabase
      .from('user_genre_pools')
      .select('igdb_game_id, rank, match_score, accessibility, matched_themes, game_title, ' +
              'cover_image_id, release_year, total_rating, total_rating_count, time_to_beat_seconds')
      .eq('user_id', userId)
      .eq('genre_id', genre.id)
      .order('rank', { ascending: true })
      .limit(limit)

    if (error) {
      console.error('[gamingMap] getVentureOutPool failed:', error.message)
      return []
    }

    return (data || []).map((row) => ({
      id: Number(row.igdb_game_id),
      title: row.game_title || null,
      image: coverUrlFromImageId(row.cover_image_id),
      year: row.release_year ?? null,
      totalRating: numOrNull(row.total_rating),
      totalRatingCount: numOrNull(row.total_rating_count),
      timeToBeatSeconds: numOrNull(row.time_to_beat_seconds),
      accessibility: numOrNull(row.accessibility),
      matchScore: numOrNull(row.match_score),
      matchedThemes: Array.isArray(row.matched_themes) ? row.matched_themes : [],
      rank: Number(row.rank) || 0,
    }))
  } catch (err) {
    console.error('[gamingMap] getVentureOutPool crashed:', err)
    return []
  }
}

// Mirrors the daily job's pool query so a live page continues the SAME
// ordering the cached pool established — paging past the cache must not
// silently change what "top rated" means mid-scroll.
const LIVE_QUALITY_WHERE =
  'total_rating != null & total_rating_count != null & cover != null & version_parent = null'
const LIVE_SORTS = {
  top_rated: { where: 'total_rating >= 70 & total_rating_count >= 20', sort: 'total_rating desc' },
  popular: { where: 'total_rating_count >= 20', sort: 'total_rating_count desc' },
  new: { where: 'total_rating_count >= 5', sort: 'first_release_date desc' },
}

/**
 * fetchGenrePageLive(genreId, sort, opts) — deep scroll past the cached pool.
 *
 * THE ONLY function here that calls IGDB, and it is never on a routine read
 * path: the grid calls it exclusively once getGenrePool reports `exhausted`.
 * Results are deliberately NOT written back to the cache — that is what keeps
 * genre_game_pools a bounded pool instead of a slow copy of IGDB's catalog.
 *
 * Goes through igdbRequest, so it inherits the shared ≤4 req/s throttle and
 * the 5-minute response cache in igdb.js.
 */
export async function fetchGenrePageLive(genreId, sort = 'top_rated', opts = {}) {
  try {
    const genre = genreById(genreId)
    const spec = LIVE_SORTS[sort]
    if (!genre || !spec) return []

    const limit = Math.min(Number(opts.limit) > 0 ? Number(opts.limit) : 50, 100)
    const offset = Number(opts.offset) > 0 ? Number(opts.offset) : 0

    const query =
      'fields name, cover.image_id, first_release_date, total_rating, ' +
      'total_rating_count, themes.name; ' +
      `where ${LIVE_QUALITY_WHERE} & ${spec.where} & genres = (${genre.id}); ` +
      `sort ${spec.sort}; limit ${limit}; offset ${offset};`

    const rows = await igdbRequest('games', query)
    return (rows || [])
      .filter((g) => g?.id && g?.name && g?.cover?.image_id)
      .map((g) => ({
        id: Number(g.id),
        title: g.name,
        image: coverUrlFromImageId(g.cover.image_id),
        year: g.first_release_date
          ? new Date(g.first_release_date * 1000).getFullYear()
          : null,
        totalRating: numOrNull(g.total_rating),
        totalRatingCount: numOrNull(g.total_rating_count),
        themeNames: (g.themes || []).map((t) => t.name).filter(Boolean),
        // Completion time is only cached for pool games, so a live page has
        // none. rankOnRamps handles that as a genuine unknown — which is why
        // on-ramps are sourced from the pool, not from deep-scroll results.
        timeToBeatSeconds: null,
        accessibility: null,
        rank: offset + 1,
      }))
  } catch (err) {
    console.error('[gamingMap] fetchGenrePageLive crashed:', err)
    return []
  }
}

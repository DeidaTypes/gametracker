// @ts-nocheck
// supabase/functions/taste-engine/gamingMap.ts
//
// Your Gaming Map — the daily job's share of the work.
//
// Runs as a step inside the existing `taste-engine` refresh (see index.ts), so
// it reuses that function's IGDB throttle, concurrency pool and /multiquery
// batching rather than opening a second, unmetered path to IGDB.
//
// It owns three things:
//
//   1. GENRE POOLS — the top GENRE_POOL_SIZE games per formal genre per sort
//      (top_rated / popular / new) in `genre_game_pools`. This is a POOL, not
//      a mirror: 23 genres x 3 sorts x 100 is a hard ceiling of ~6.9k rows and
//      it stays there. Users scrolling deeper page live against IGDB from the
//      client, and those results are never written back.
//
//   2. VENTURE OUT POOLS — per user, per UNCHARTED genre, a taste-filtered
//      slice of the pool above with their owned/backlogged games removed.
//      Derived entirely from data already fetched in step 1, so every user's
//      pool costs ZERO additional IGDB requests. That is the reason step 1
//      caches three sorts: the union is the candidate set step 2 filters.
//
//   3. TIER SNAPSHOTS + BACKFILL — an 'engine' fallback row in
//      `user_gaming_map` for users whose client hasn't written one, and
//      resolution of the game ids clients reported they couldn't place.
//
// IGDB COST, measured against the ≤4 req/s + ≤8 concurrent ceiling:
//   • pools    69 sub-queries -> 7 POSTs (fixed, every night)
//   • TTB      cache-first, ~4 POSTs on the first run, ~0 after
//   • users    0
// So the whole feature adds a bounded ~11 POSTs/night regardless of how many
// users exist, which is what keeps it inside the rate limit as the app grows.

// ── The 23 formal IGDB genres ───────────────────────────────────────────────
// Mirrors src/services/igdbGenres.js and the igdb_genres seed. Hardcoded, not
// synced: a new IGDB genre changes what the map MEANS for every existing user,
// so adding one is a deliberate edit in all three places, never automatic.
// (Same client/Edge-Function mirroring arrangement as the IGDB throttle.)
const GENRES: { id: number; name: string }[] = [
  { id: 2, name: 'Point-and-click' },
  { id: 4, name: 'Fighting' },
  { id: 5, name: 'Shooter' },
  { id: 7, name: 'Music' },
  { id: 8, name: 'Platform' },
  { id: 9, name: 'Puzzle' },
  { id: 10, name: 'Racing' },
  { id: 11, name: 'Real Time Strategy (RTS)' },
  { id: 12, name: 'Role-playing (RPG)' },
  { id: 13, name: 'Simulator' },
  { id: 14, name: 'Sport' },
  { id: 15, name: 'Strategy' },
  { id: 16, name: 'Turn-based strategy (TBS)' },
  { id: 24, name: 'Tactical' },
  { id: 25, name: "Hack and slash/Beat 'em up" },
  { id: 26, name: 'Quiz/Trivia' },
  { id: 30, name: 'Pinball' },
  { id: 31, name: 'Adventure' },
  { id: 32, name: 'Indie' },
  { id: 33, name: 'Arcade' },
  { id: 34, name: 'Visual Novel' },
  { id: 35, name: 'Card & Board Game' },
  { id: 36, name: 'MOBA' },
]
const GENRE_IDS = new Set(GENRES.map((g) => g.id))

// ── Pool configuration ──────────────────────────────────────────────────────
const GENRE_POOL_SIZE = 100      // games cached per (genre, sort)
const ID_CHUNK = 100             // ids per IGDB `where id = (...)` sub-query
const TTB_TTL_MS = 90 * 24 * 60 * 60 * 1000 // completion times barely change

// Quality bar for the cached pool. Symmetric across every genre — no genre
// gets a stricter or looser bar, or the map would quietly imply that thin
// genres have nothing worth playing.
const MIN_RATING = 70
const MIN_RATING_COUNT = 20
// `new` needs its own, lower bar: a game released last month has not had time
// to accumulate ratings, and holding it to the same count would make the "new"
// sort permanently empty for every genre outside the biggest few.
const NEW_MIN_RATING_COUNT = 5
const NEW_WINDOW_SECONDS = 2 * 365 * 24 * 60 * 60

const POOL_FIELDS =
  'fields name, cover.image_id, first_release_date, total_rating, ' +
  'total_rating_count, genres, themes.id, themes.name'
const POOL_QUALITY =
  'total_rating != null & total_rating_count != null & cover != null & version_parent = null'

// ── Venture Out configuration ───────────────────────────────────────────────
const VENTURE_GENRE_LIMIT = 8  // uncharted genres given a pool per user per night
const VENTURE_POOL_SIZE = 60   // games per (user, genre) — inside the 40-80 target
const VENTURE_MIN_POOL = 12    // below this the pool is too thin to be worth storing

// ── On-ramp accessibility ───────────────────────────────────────────────────
// Port of scoreAccessibility in src/services/onRamps.js, which is the
// reference implementation and carries the full rationale. Kept in sync by
// hand, the same way the IGDB throttle constants are mirrored between
// src/services/igdb.js and index.ts. Precomputed here so the client's "good
// places to start" is an indexed SELECT rather than a scan-and-score.
const QUALITY_FLOOR = 70
const QUALITY_CEIL = 95
const SHORT_HOURS = 6
const LONG_HOURS = 60
const NEUTRAL_BREVITY = 0.5
const REACH_SATURATION = 500
const W_QUALITY = 0.45
const W_BREVITY = 0.40
const W_REACH = 0.15
// How much of a Venture Out match score is taste vs raw accessibility. Below
// 0.5 on purpose: this ranks entry points into a genre the user does NOT know,
// so approachability has to lead and taste breaks ties.
const W_TASTE = 0.3

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

function scoreAccessibility(
  totalRating: number | null,
  totalRatingCount: number | null,
  ttbSeconds: number | null,
): number {
  const quality = Number.isFinite(totalRating as number)
    ? clamp01(((totalRating as number) - QUALITY_FLOOR) / (QUALITY_CEIL - QUALITY_FLOOR))
    : 0

  let brevity = NEUTRAL_BREVITY
  if (Number.isFinite(ttbSeconds as number) && (ttbSeconds as number) > 0) {
    const hours = (ttbSeconds as number) / 3600
    brevity = clamp01((LONG_HOURS - hours) / (LONG_HOURS - SHORT_HOURS))
  }

  const reach = Number.isFinite(totalRatingCount as number) && (totalRatingCount as number) > 0
    ? clamp01(Math.log1p(totalRatingCount as number) / Math.log1p(REACH_SATURATION))
    : 0

  return Math.round((W_QUALITY * quality + W_BREVITY * brevity + W_REACH * reach) * 100)
}

// ── Tier model ──────────────────────────────────────────────────────────────
// Mirrors src/services/gamingMapService.js. The client's computation is the
// authoritative one because it can see the localStorage library; this exists
// so a user who has never opened the map still gets sensible Venture Out
// pools, and so another user's profile can render something.
const W_GAMES = 3.0
const W_HOURS = 4.0
const W_RATING = 2.0
const RECENT_WINDOW_DAYS = 90
const RECENCY_BOOST = 0.25
const HOME_TURF_MAX = 5
const HOME_TURF_MIN_GAMES = 3
const HOME_TURF_MIN_HOURS = 20
const RATING_SCALE_MAX = 5

const BACKLOG_STATUSES = new Set(['want', 'want_to_play', 'want-to-play', 'backlog'])
const PLAYED_STATUSES = new Set(['played', 'completed', 'finished'])
const PLAYING_STATUSES = new Set(['currently', 'playing'])
const DROPPED_STATUSES = new Set(['dropped'])

const toMs = (v: any): number | null => {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}
const maxMs = (...vals: (number | null)[]): number | null => {
  let best: number | null = null
  for (const v of vals) if (v != null && (best == null || v > best)) best = v
  return best
}

// ── 1. Genre pools ──────────────────────────────────────────────────────────

interface PoolGame {
  id: number
  name: string | null
  coverImageId: string | null
  releaseYear: number | null
  totalRating: number | null
  totalRatingCount: number | null
  genreIds: number[]
  themeIds: number[]
  themeNames: string[]
}

function shapePoolGame(g: any): PoolGame | null {
  if (!g?.id || !g?.name || !g?.cover?.image_id) return null
  const themes = Array.isArray(g.themes) ? g.themes : []
  return {
    id: Number(g.id),
    name: g.name,
    coverImageId: g.cover.image_id,
    releaseYear: g.first_release_date
      ? new Date(g.first_release_date * 1000).getUTCFullYear()
      : null,
    totalRating: typeof g.total_rating === 'number' ? g.total_rating : null,
    totalRatingCount: typeof g.total_rating_count === 'number' ? g.total_rating_count : null,
    genreIds: (Array.isArray(g.genres) ? g.genres : [])
      .map((x: any) => Number(typeof x === 'object' ? x.id : x))
      .filter((id: number) => GENRE_IDS.has(id)),
    themeIds: themes.map((t: any) => Number(t.id)).filter(Boolean),
    themeNames: themes.map((t: any) => String(t.name)).filter(Boolean),
  }
}

function poolSubQuery(genreId: number, sortKey: string, nowSeconds: number) {
  let where: string
  let sort: string
  if (sortKey === 'top_rated') {
    where = `${POOL_QUALITY} & total_rating >= ${MIN_RATING} & total_rating_count >= ${MIN_RATING_COUNT}`
    sort = 'total_rating desc'
  } else if (sortKey === 'popular') {
    where = `${POOL_QUALITY} & total_rating_count >= ${MIN_RATING_COUNT}`
    sort = 'total_rating_count desc'
  } else {
    where =
      `${POOL_QUALITY} & total_rating_count >= ${NEW_MIN_RATING_COUNT}` +
      ` & first_release_date >= ${nowSeconds - NEW_WINDOW_SECONDS}` +
      ` & first_release_date <= ${nowSeconds}`
    sort = 'first_release_date desc'
  }
  return {
    name: `pool_${genreId}_${sortKey}`,
    endpoint: 'games',
    body: `${POOL_FIELDS}; where ${where} & genres = (${genreId}); sort ${sort}; limit ${GENRE_POOL_SIZE};`,
  }
}

/**
 * Resolve completion times, cache-first.
 *
 * Rows with NULL seconds are cached too — that records "IGDB publishes no time
 * for this game", which is what stops the job re-asking about the same
 * thousands of games every night.
 */
async function resolveTimeToBeat(
  db: any,
  igdbMulti: (qs: any[]) => Promise<Map<string, any[]>>,
  ids: number[],
): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>()
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (unique.length === 0) return out

  const freshCutoff = new Date(Date.now() - TTB_TTL_MS).toISOString()
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500)
    const { data, error } = await db
      .from('game_time_to_beat')
      .select('igdb_game_id, seconds')
      .in('igdb_game_id', chunk)
      .gte('fetched_at', freshCutoff)
    if (error) {
      console.error('[gaming-map] time_to_beat cache read failed:', error.message)
      continue
    }
    for (const row of data || []) {
      out.set(Number(row.igdb_game_id), row.seconds == null ? null : Number(row.seconds))
    }
  }

  const missing = unique.filter((id) => !out.has(id))
  if (missing.length === 0) return out

  const chunks: number[][] = []
  for (let i = 0; i < missing.length; i += ID_CHUNK) chunks.push(missing.slice(i, i + ID_CHUNK))
  const results = await igdbMulti(
    chunks.map((chunk, i) => ({
      name: `ttb_${i}`,
      endpoint: 'game_time_to_beats',
      body: `fields game_id, normally; where game_id = (${chunk.join(',')}); limit ${chunk.length};`,
    })),
  )

  const found = new Map<number, number>()
  for (const rows of results.values()) {
    for (const r of rows) {
      const gid = Number(r?.game_id)
      const secs = Number(r?.normally)
      if (gid && Number.isFinite(secs) && secs > 0) found.set(gid, secs)
    }
  }

  const toUpsert = missing.map((id) => ({
    igdb_game_id: id,
    seconds: found.has(id) ? found.get(id) : null,
    fetched_at: new Date().toISOString(),
  }))
  for (let i = 0; i < toUpsert.length; i += 500) {
    const { error } = await db
      .from('game_time_to_beat')
      .upsert(toUpsert.slice(i, i + 500), { onConflict: 'igdb_game_id' })
    if (error) console.error('[gaming-map] time_to_beat upsert failed:', error.message)
  }

  for (const id of missing) out.set(id, found.has(id) ? found.get(id)! : null)
  return out
}

interface PoolEntry extends PoolGame {
  accessibility: number
  ttbSeconds: number | null
}

/**
 * Refresh `genre_game_pools` for all 23 genres x 3 sorts.
 * @returns candidates per genre — the deduped union across sorts, reused by
 *          Venture Out so it needs no IGDB traffic of its own.
 */
async function refreshGenrePools(
  db: any,
  igdbMulti: (qs: any[]) => Promise<Map<string, any[]>>,
): Promise<Map<number, PoolEntry[]>> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const sorts = ['top_rated', 'popular', 'new']

  const subQueries = []
  for (const genre of GENRES) {
    for (const sortKey of sorts) subQueries.push(poolSubQuery(genre.id, sortKey, nowSeconds))
  }
  const results = await igdbMulti(subQueries)

  // Completion times for every distinct game across every pool, in one
  // cache-first pass rather than per genre.
  const allIds = new Set<number>()
  const parsed = new Map<string, PoolGame[]>()
  for (const [name, rows] of results) {
    const games = (rows || []).map(shapePoolGame).filter(Boolean) as PoolGame[]
    parsed.set(name, games)
    for (const g of games) allIds.add(g.id)
  }
  const ttb = await resolveTimeToBeat(db, igdbMulti, Array.from(allIds))

  const candidatesByGenre = new Map<number, PoolEntry[]>()
  const refreshedAt = new Date().toISOString()

  for (const genre of GENRES) {
    const seenForGenre = new Map<number, PoolEntry>()
    const rowsToWrite: any[] = []

    for (const sortKey of sorts) {
      const games = parsed.get(`pool_${genre.id}_${sortKey}`) || []
      games.forEach((g, index) => {
        const ttbSeconds = ttb.get(g.id) ?? null
        const accessibility = scoreAccessibility(g.totalRating, g.totalRatingCount, ttbSeconds)

        rowsToWrite.push({
          genre_id: genre.id,
          sort_key: sortKey,
          igdb_game_id: g.id,
          rank: index + 1,
          game_title: g.name,
          cover_image_id: g.coverImageId,
          release_year: g.releaseYear,
          total_rating: g.totalRating,
          total_rating_count: g.totalRatingCount,
          genre_ids: g.genreIds,
          theme_ids: g.themeIds,
          theme_names: g.themeNames,
          time_to_beat_seconds: ttbSeconds,
          accessibility,
          refreshed_at: refreshedAt,
        })

        if (!seenForGenre.has(g.id)) {
          seenForGenre.set(g.id, { ...g, accessibility, ttbSeconds })
        }
      })
    }

    if (rowsToWrite.length === 0) {
      // IGDB returned nothing for this genre this run — almost certainly a
      // transient failure. Leave yesterday's rows in place; blanking a genre
      // would empty its grid for a whole day.
      console.warn(`[gaming-map] no pool results for genre ${genre.id} (${genre.name}); keeping previous rows`)
      continue
    }

    for (let i = 0; i < rowsToWrite.length; i += 500) {
      const { error } = await db
        .from('genre_game_pools')
        .upsert(rowsToWrite.slice(i, i + 500), { onConflict: 'genre_id,sort_key,igdb_game_id' })
      if (error) console.error(`[gaming-map] pool upsert genre ${genre.id} failed:`, error.message)
    }

    // Evict games that dropped out of the pool. Without this the table would
    // only ever grow, which is exactly the "copy of IGDB's catalog" this
    // design exists to avoid.
    const { error: pruneError } = await db
      .from('genre_game_pools')
      .delete()
      .eq('genre_id', genre.id)
      .lt('refreshed_at', refreshedAt)
    if (pruneError) console.error(`[gaming-map] pool prune genre ${genre.id} failed:`, pruneError.message)

    candidatesByGenre.set(genre.id, Array.from(seenForGenre.values()))
  }

  return candidatesByGenre
}

// ── 2. Per-user genre stats + tiers ─────────────────────────────────────────

interface GenreStat {
  gameCount: number
  playedCount: number
  droppedCount: number
  backlogCount: number
  hours: number
  ratedCount: number
  ratingSum: number
  recentCount: number
  lastActivityAt: number | null
}

const emptyStat = (): GenreStat => ({
  gameCount: 0, playedCount: 0, droppedCount: 0, backlogCount: 0,
  hours: 0, ratedCount: 0, ratingSum: 0, recentCount: 0, lastActivityAt: null,
})

interface UserGameState {
  status: string | null
  hours: number
  rating: number | null
  lastAt: number | null
}

/**
 * Fold the Supabase-side signals into per-user, per-game state.
 *
 * Hours from sessions, trackers and reviews describe the SAME time and are
 * reconciled with max(), never summed — the same rule index.ts applies.
 */
function buildUserGameStates(sources: {
  trackers: any[]; reviews: any[]; sessions: any[]; swipes: any[]
}): Map<string, Map<number, UserGameState>> {
  const users = new Map<string, Map<number, UserGameState>>()

  const ensure = (uid: string, gid: number): UserGameState => {
    let games = users.get(uid)
    if (!games) { games = new Map(); users.set(uid, games) }
    let g = games.get(gid)
    if (!g) { g = { status: null, hours: 0, rating: null, lastAt: null }; games.set(gid, g) }
    return g
  }
  const idOf = (v: any) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  const sessionHours = new Map<string, number>()
  for (const s of sources.sessions) {
    const uid = s.user_id, gid = idOf(s.igdb_game_id)
    if (!uid || !gid || !s.ended_at) continue
    const hours = Number(s.hours)
    const seconds = Number(s.seconds)
    const h = hours > 0 ? hours : (seconds > 0 ? seconds / 3600 : 0)
    const key = `${uid}:${gid}`
    sessionHours.set(key, (sessionHours.get(key) || 0) + h)
    const g = ensure(uid, gid)
    g.lastAt = maxMs(g.lastAt, toMs(s.ended_at), toMs(s.played_on))
  }
  for (const [key, h] of sessionHours) {
    const [uid, gid] = key.split(':')
    const g = ensure(uid, Number(gid))
    if (h > g.hours) g.hours = h
  }

  for (const t of sources.trackers) {
    const uid = t.user_id, gid = idOf(t.igdb_game_id)
    if (!uid || !gid) continue
    const g = ensure(uid, gid)
    if (t.status) g.status = String(t.status).toLowerCase()
    const th = Number(t.hours_played)
    if (th > 0 && th > g.hours) g.hours = th
    const tr = Number(t.rating)
    if (tr > 0 && g.rating == null) g.rating = tr
    g.lastAt = maxMs(g.lastAt, toMs(t.last_played_at), toMs(t.updated_at))
  }

  for (const r of sources.reviews) {
    const uid = r.user_id, gid = idOf(r.igdb_game_id)
    if (!uid || !gid) continue
    const g = ensure(uid, gid)
    const rr = Number(r.rating)
    if (rr > 0) g.rating = rr
    const rh = Number(r.hours_played)
    if (rh > 0 && rh > g.hours) g.hours = rh
    g.lastAt = maxMs(g.lastAt, toMs(r.updated_at), toMs(r.created_at))
  }

  // A swipe-right IS a backlog add. It only fills an empty status, so it can
  // never demote a game the user has actually played.
  for (const s of sources.swipes) {
    const uid = s.user_id, gid = idOf(s.igdb_game_id)
    if (!uid || !gid) continue
    if (String(s.action || '').toLowerCase() !== 'backlog') continue
    const g = ensure(uid, gid)
    if (!g.status) g.status = 'want_to_play'
    g.lastAt = maxMs(g.lastAt, toMs(s.swiped_at))
  }

  return users
}

function accumulateGenreStats(
  games: Map<number, UserGameState>,
  tags: Map<number, any>,
): Map<number, GenreStat> {
  const byGenre = new Map<number, GenreStat>()
  for (const g of GENRES) byGenre.set(g.id, emptyStat())
  const recentCutoff = Date.now() - RECENT_WINDOW_DAYS * 86400000

  for (const [gid, state] of games) {
    const tag = tags.get(gid)
    const genreIds: number[] = (tag?.genre_ids || []).map(Number).filter((id: number) => GENRE_IDS.has(id))
    if (genreIds.length === 0) continue

    const status = state.status
    const isBacklog = status != null && BACKLOG_STATUSES.has(status)
    const isPlayed = status != null && PLAYED_STATUSES.has(status)
    const isPlaying = status != null && PLAYING_STATUSES.has(status)
    const isDropped = status != null && DROPPED_STATUSES.has(status)
    const hasRating = state.rating != null && state.rating > 0
    const engaged = isPlayed || isPlaying || isDropped || state.hours > 0 || hasRating
    if (!engaged && !isBacklog) continue

    for (const genreId of genreIds) {
      const s = byGenre.get(genreId)!
      if (isBacklog && !engaged) {
        s.backlogCount++
        s.lastActivityAt = maxMs(s.lastActivityAt, state.lastAt)
        continue
      }
      if (isBacklog) s.backlogCount++
      s.gameCount++
      if (isPlayed) s.playedCount++
      if (isDropped) s.droppedCount++
      s.hours += state.hours
      if (hasRating) { s.ratedCount++; s.ratingSum += state.rating as number }
      if (state.lastAt != null && state.lastAt >= recentCutoff) s.recentCount++
      s.lastActivityAt = maxMs(s.lastActivityAt, state.lastAt)
    }
  }
  return byGenre
}

function blendedScore(s: GenreStat): number {
  if (s.gameCount === 0) return 0
  const avg = s.ratedCount > 0 ? s.ratingSum / s.ratedCount : 0
  const base =
    W_GAMES * Math.log1p(s.gameCount) +
    W_HOURS * Math.log1p(s.hours) +
    W_RATING * (avg / RATING_SCALE_MAX) * Math.log1p(s.ratedCount)
  return base * (1 + RECENCY_BOOST * (s.recentCount / s.gameCount))
}

function assignTiers(byGenre: Map<number, GenreStat>) {
  const scored = GENRES.map((genre) => {
    const stats = byGenre.get(genre.id) || emptyStat()
    return { genre, stats, score: blendedScore(stats) }
  })

  const homeTurf = new Set<number>()
  for (const row of scored.filter((r) => r.stats.gameCount > 0).sort((a, b) => b.score - a.score)) {
    if (homeTurf.size >= HOME_TURF_MAX) break
    if (row.stats.gameCount >= HOME_TURF_MIN_GAMES || row.stats.hours >= HOME_TURF_MIN_HOURS) {
      homeTurf.add(row.genre.id)
    }
  }

  return scored.map((row) => {
    let tier = 'not_yet'
    if (homeTurf.has(row.genre.id)) tier = 'home_turf'
    else if (row.stats.gameCount > 0) tier = 'exploring'
    else if (row.stats.backlogCount > 0) tier = 'on_horizon'
    return { ...row, tier }
  })
}

// ── 3. Venture Out pools ────────────────────────────────────────────────────

/**
 * Build one user's Venture Out pool for one uncharted genre.
 *
 * Reads only the already-fetched candidate list, so this costs no IGDB
 * traffic. Returns [] rather than a padded list when too few games qualify —
 * a thin pool should hide the section, not get topped up with games that
 * don't meet the bar.
 */
function buildVenturePool(
  candidates: PoolEntry[],
  excludeIds: Set<number>,
  themeStrength: Map<string, number> | null,
) {
  const scored = []
  for (const game of candidates) {
    if (excludeIds.has(game.id)) continue

    let fit = 0
    const matched: string[] = []
    if (themeStrength) {
      for (const theme of game.themeNames) {
        const strength = themeStrength.get(theme.toLowerCase())
        if (strength == null) continue
        matched.push(theme)
        if (strength > fit) fit = strength
      }
      matched.sort(
        (a, b) => (themeStrength.get(b.toLowerCase()) || 0) - (themeStrength.get(a.toLowerCase()) || 0),
      )
    }

    // No taste signal yet → rank on accessibility alone rather than letting a
    // nonexistent vector contribute a neutral half-score.
    const score = themeStrength
      ? (1 - W_TASTE) * game.accessibility + W_TASTE * fit * 100
      : game.accessibility

    scored.push({ game, score: Math.round(score), matched: matched.slice(0, 3) })
  }

  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.game.id - b.game.id))
  return scored.slice(0, VENTURE_POOL_SIZE)
}

/** Rescale theme weights against the user's own strongest, so the bonus means
 *  the same thing regardless of how many themes they have signal in. */
function relativeThemeStrength(themeWeights: Record<string, number> | null) {
  if (!themeWeights) return null
  const values = Object.values(themeWeights).map(Number).filter((v) => v > 0)
  if (values.length === 0) return null
  const top = Math.max(...values)
  if (!(top > 0)) return null
  const out = new Map<string, number>()
  for (const [name, w] of Object.entries(themeWeights)) {
    const v = Number(w)
    if (v > 0) out.set(name.toLowerCase(), clamp01(v / top))
  }
  return out
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * refreshGamingMap — the daily job's gaming-map step.
 *
 * Called from refresh() in index.ts AFTER taste vectors are written, because
 * Venture Out's theme bias reads those vectors.
 *
 * @param db      service-role Supabase client
 * @param deps.igdbMulti   index.ts's throttled /multiquery batcher — reused so
 *                         all IGDB traffic shares one rate budget
 * @param deps.resolveTags index.ts's cache-first tag resolver, for backfill
 * @param deps.sources     the behavioral rows refresh() already loaded
 * @param deps.tags        game_tags resolved this run
 * @param deps.vectors     userId -> { genreWeights, themeWeights }
 */
export async function refreshGamingMap(db: any, deps: {
  igdbMulti: (qs: any[]) => Promise<Map<string, any[]>>
  resolveTags: (db: any, ids: number[]) => Promise<Map<number, any>>
  sources: { trackers: any[]; reviews: any[]; sessions: any[]; swipes: any[] }
  tags: Map<number, any>
  vectors: Map<string, { genreWeights: Record<string, number>; themeWeights: Record<string, number> }>
}) {
  const summary = {
    genres_refreshed: 0,
    pool_rows: 0,
    users_mapped: 0,
    venture_pools_written: 0,
    venture_rows: 0,
    backfilled_games: 0,
  }

  // 1. Global pools — the only IGDB traffic this step generates.
  const candidatesByGenre = await refreshGenrePools(db, deps.igdbMulti)
  summary.genres_refreshed = candidatesByGenre.size
  for (const list of candidatesByGenre.values()) summary.pool_rows += list.length

  // 2. Backfill the game ids clients reported they could not place. Doing this
  // here means the map self-heals overnight and no client read ever has to
  // call IGDB to fix its own coverage.
  const { data: metaRows, error: metaError } = await db
    .from('user_gaming_map_meta')
    .select('user_id, unresolved_game_ids')
    .gt('unresolved_count', 0)
  if (metaError) console.error('[gaming-map] meta read failed:', metaError.message)

  const backfillIds = new Set<number>()
  for (const row of metaRows || []) {
    for (const id of row.unresolved_game_ids || []) {
      const n = Number(id)
      if (Number.isFinite(n) && n > 0 && !deps.tags.has(n)) backfillIds.add(n)
    }
  }
  if (backfillIds.size > 0) {
    const resolved = await deps.resolveTags(db, Array.from(backfillIds))
    for (const [id, tag] of resolved) deps.tags.set(id, tag)
    summary.backfilled_games = resolved.size
  }

  // 3. Per-user tiers + Venture Out pools. No IGDB traffic from here down.
  const userStates = buildUserGameStates(deps.sources)

  // Which users already have a client-written snapshot? Those rows saw the
  // localStorage library, so they beat anything derivable here and must not be
  // overwritten with a thinner server-side view.
  const clientMapped = new Set<string>()
  const { data: existing, error: existingError } = await db
    .from('user_gaming_map')
    .select('user_id, source')
    .eq('source', 'client')
  if (existingError) console.error('[gaming-map] snapshot read failed:', existingError.message)
  for (const row of existing || []) clientMapped.add(row.user_id)

  const generatedAt = new Date().toISOString()

  for (const [userId, games] of userStates) {
    const vector = deps.vectors.get(userId) || null
    const byGenre = accumulateGenreStats(games, deps.tags)
    const rows = assignTiers(byGenre)

    // 3a. Engine-side tier snapshot, only where the client hasn't written one.
    if (!clientMapped.has(userId)) {
      const affinityByName = vector?.genreWeights || {}
      const byTier: Record<string, number> = {}
      const snapshot = rows
        .slice()
        .sort((a, b) => b.score - a.score)
        .map((row) => {
          byTier[row.tier] = (byTier[row.tier] || 0) + 1
          const avg = row.stats.ratedCount > 0 ? row.stats.ratingSum / row.stats.ratedCount : null
          return {
            user_id: userId,
            genre_id: row.genre.id,
            tier: row.tier,
            tier_rank: byTier[row.tier],
            score: Math.round(row.score * 100) / 100,
            game_count: row.stats.gameCount,
            played_count: row.stats.playedCount,
            dropped_count: row.stats.droppedCount,
            backlog_count: row.stats.backlogCount,
            hours: Math.round(row.stats.hours * 10) / 10,
            avg_rating: avg == null ? null : Math.round(avg * 10) / 10,
            rated_count: row.stats.ratedCount,
            affinity: affinityByName[row.genre.name] ?? null,
            last_activity_at: row.stats.lastActivityAt != null
              ? new Date(row.stats.lastActivityAt).toISOString()
              : null,
            source: 'engine',
            computed_at: generatedAt,
          }
        })

      const { error } = await db
        .from('user_gaming_map')
        .upsert(snapshot, { onConflict: 'user_id,genre_id' })
      if (error) console.error(`[gaming-map] snapshot upsert for ${userId} failed:`, error.message)
      else summary.users_mapped++
    } else {
      summary.users_mapped++
    }

    // 3b. Venture Out pools for the genres this user has genuinely never
    // touched. Read the stored tiers back rather than trusting the engine's
    // own view, so a client snapshot (which saw the full library) wins.
    const { data: storedTiers } = await db
      .from('user_gaming_map')
      .select('genre_id, tier')
      .eq('user_id', userId)
      .eq('tier', 'not_yet')

    const unchartedIds: number[] = (storedTiers || [])
      .map((r: any) => Number(r.genre_id))
      .filter((id: number) => GENRE_IDS.has(id))

    // The moment a user plays their first game in a genre it stops being
    // uncharted, and any Venture Out pool we built for it is now offering to
    // introduce them to something they already started. The per-genre prune
    // further down only touches genres rebuilt this run, so those pools would
    // otherwise linger forever — drop them here.
    const staleGenreFilter = unchartedIds.length > 0
      ? `(${unchartedIds.join(',')})`
      : '(0)' // no uncharted genres left: every stored pool is stale
    const { error: staleError } = await db
      .from('user_genre_pools')
      .delete()
      .eq('user_id', userId)
      .not('genre_id', 'in', staleGenreFilter)
    if (staleError) {
      console.error(`[gaming-map] stale venture prune for ${userId} failed:`, staleError.message)
    }

    if (unchartedIds.length === 0) continue

    // Prioritise uncharted genres adjacent to the user's taste — the ones
    // where a recommendation has the best chance of landing — so the nightly
    // budget goes to the most useful few rather than an arbitrary slice.
    const themeStrength = relativeThemeStrength(vector?.themeWeights || null)
    const affinityByName = vector?.genreWeights || {}
    const ordered = unchartedIds
      .map((id) => {
        const genre = GENRES.find((g) => g.id === id)!
        return { id, affinity: Number(affinityByName[genre.name]) || 0 }
      })
      .sort((a, b) => (b.affinity !== a.affinity ? b.affinity - a.affinity : a.id - b.id))
      .slice(0, VENTURE_GENRE_LIMIT)

    const excludeIds = new Set<number>(games.keys())

    for (const { id: genreId } of ordered) {
      const candidates = candidatesByGenre.get(genreId) || []
      if (candidates.length === 0) continue

      const picks = buildVenturePool(candidates, excludeIds, themeStrength)
      if (picks.length < VENTURE_MIN_POOL) continue

      const poolRows = picks.map((p, i) => ({
        user_id: userId,
        genre_id: genreId,
        igdb_game_id: p.game.id,
        rank: i + 1,
        match_score: p.score,
        accessibility: p.game.accessibility,
        matched_themes: p.matched,
        game_title: p.game.name,
        cover_image_id: p.game.coverImageId,
        release_year: p.game.releaseYear,
        total_rating: p.game.totalRating,
        total_rating_count: p.game.totalRatingCount,
        time_to_beat_seconds: p.game.ttbSeconds,
        generated_at: generatedAt,
      }))

      const { error } = await db
        .from('user_genre_pools')
        .upsert(poolRows, { onConflict: 'user_id,genre_id,igdb_game_id' })
      if (error) {
        console.error(`[gaming-map] venture pool ${userId}/${genreId} failed:`, error.message)
        continue
      }

      // Drop games that fell out of this user's pool, so it stays a fixed-size
      // slice rather than accumulating every game ever recommended.
      await db
        .from('user_genre_pools')
        .delete()
        .eq('user_id', userId)
        .eq('genre_id', genreId)
        .lt('generated_at', generatedAt)

      summary.venture_pools_written++
      summary.venture_rows += poolRows.length
    }
  }

  return summary
}

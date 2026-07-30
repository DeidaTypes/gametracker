// @ts-nocheck
// supabase/functions/taste-engine/index.ts
//
// Supabase Edge Function — taste-engine
//
// PRECOMPUTE + CACHE the recommendation engine server-side. This is the
// ONLY place IGDB is touched for taste/recs — the UI reads exclusively
// from the cache tables. Invoked once a day by pg_cron (see
// supabase/taste_engine_schedule.sql) and manually for smoke tests.
//
// For every user with ANY behavioral activity it:
//   1. Builds a NORMALIZED genre/theme affinity vector from EVERY behavioral
//      signal the app records — not just ratings → user_taste_vectors.
//      See "Behavioral weighting" below for the model.
//
// IGDB is reached through the existing `igdb-proxy` function's
// /multiquery endpoint so a user's whole batch of lookups (tag
// resolution across every signal game + genre/theme candidate queries)
// rides in a small, bounded number of POSTs (~2-3/user) instead of one
// round trip per lookup — see igdbMulti() below. All IGDB traffic is
// throttled to ≤4 req/s with ≤8 concurrent, batched via id lists
// (≤ ID_CHUNK per sub-query) and ≤ MULTIQUERY_MAX_SUBQUERIES sub-queries
// per POST.
//
// Auth: this function is deployed with verify_jwt=false and instead
// requires a shared `x-engine-secret` header matching the ENGINE_SECRET
// env var (set via `supabase secrets set`). pg_cron supplies it from Vault.
//
// Request  : POST { trigger?, userId?, limit? }
//   userId — optional: refresh a single user only (smoke tests).
//   limit  — optional cap on users processed (default: all).
// Response : 200 { ok, users_processed, vectors_written }
//
// ── Behavioral weighting ────────────────────────────────────────────────────
// This engine previously read ONLY reviews.rating + game_trackers.status, took
// the max() of the two per game, and applied no recency at all. That produced a
// reproducible bug: a genre the user had real play sessions in but had never
// rated scored ZERO. Every signal below is now accumulated ADDITIVELY per game
// (a game you played 40 hours, finished, reviewed AND rated earns all four),
// then each contribution is recency-decayed before it lands in the vector.
//
// Points per signal, and why (all pre-decay):
//   hours       HOURS_COEF * ln(1 + hours)  — THE strongest signal. Time is the
//                                             truest statement of preference.
//                                             Log-shaped so a 300-hour grinder
//                                             dominates without flattening the
//                                             rest of their vector to noise.
//   finished    3.0  — completion beats intent.
//   rating      3.0 max, scaled rating/5 — an opinion, but a cheap one next to
//                                          hours. A LOW rating stays a weak
//                                          POSITIVE: the user chose to play the
//                                          genre, which is real genre interest.
//                                          Only swipe-left is treated as
//                                          negative preference.
//   review      2.5 (+0.5 longform)  — strong engagement; writing costs effort.
//   list        1.2  — curation signal.
//   backlog     0.8  — intent only, and intent is cheap. Deliberately well
//                      below `finished` so completion beats intent.
//   swipe right +0.5 — light positive.
//   swipe left  -0.5 (skip) / -1.0 (not_interested) — light negative, mirroring
//                      the client's own 30-day vs 1-year exclusion asymmetry.
//
// Recency: every contribution is multiplied by
//   RECENCY_FLOOR + (1-RECENCY_FLOOR) * 0.5^(ageDays / RECENCY_HALF_LIFE_DAYS)
// so recent behavior outweighs stale behavior, but an old signal decays toward
// a nonzero FLOOR rather than vanishing — a genre you loved years ago stays in
// the vector, quietly.
//
// Non-zero guarantee (task 2): a genre with ANY real positive signal is ALWAYS
// present with affinity > 0. Two things protect this:
//   • negatives can suppress at most (1 - NEGATIVE_RETENTION) of a genre's
//     positive score — a left-swipe can never cancel out real play time;
//   • normalization floors at MIN_AFFINITY so a small-but-real weight cannot
//     round down to 0.0 (the old 4-decimal rounding could).
// Genres known ONLY from a left swipe are intentionally absent rather than
// stored as 0 — that is a negative preference, not an affinity.
//
// Dropped games contribute no positive intent points, but their hours/rating
// still count: you genuinely played that genre, you just didn't finish.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ENGINE_SECRET = Deno.env.get('ENGINE_SECRET') || ''
const PROXY_URL = `${SUPABASE_URL}/functions/v1/igdb-proxy`

// IGDB rate limiting — mirror the client throttle (≤4 req/s) + cap concurrency.
const RATE_WINDOW_MS = 1000
const RATE_MAX = 4
const MAX_CONCURRENCY = 8
const ID_CHUNK = 100 // ids per IGDB `where id = (...)` sub-query
const MULTIQUERY_MAX_SUBQUERIES = 10 // IGDB's own /multiquery cap per POST

// Metadata cache freshness — skip re-fetching game_tags newer than this.
const TAG_TTL_MS = 7 * 24 * 60 * 60 * 1000

// ── Behavioral signal weighting (see the header block for rationale) ─────────
// Points are PRE-decay. Every value here is a product decision, not a tuned
// constant — changing one changes what the app believes about its users.
const HOURS_COEF = 4.0                  // × ln(1 + hours); 1h→2.8, 5h→7.2, 40h→14.8, 300h→22.8
const RATING_MAX_POINTS = 3.0           // × (rating / RATING_SCALE_MAX)
const RATING_SCALE_MAX = 5              // reviews.rating / game_trackers.rating are 0-5 stars
const REVIEW_POINTS = 2.5
const REVIEW_LONGFORM_BONUS = 0.5       // body ≥ REVIEW_LONGFORM_CHARS
const REVIEW_LONGFORM_CHARS = 280
const FINISHED_POINTS = 3.0             // completion beats intent
const BACKLOG_POINTS = 0.8              // intent only — deliberately << FINISHED_POINTS
const LIST_POINTS = 1.2                 // curation
const SWIPE_RIGHT_POINTS = 0.5          // light positive
const SWIPE_SKIP_POINTS = -0.5          // light negative
const SWIPE_NOT_INTERESTED_POINTS = -1.0 // stronger downvote (client keeps these out for a year)

// Recency. Half-life ≈ 8 months: a 2-year-old rating retains ~26% of its
// weight, an 8-month-old one ~58%. FLOOR keeps ancient-but-real signal in the
// vector instead of deleting a user's history.
const RECENCY_HALF_LIFE_DAYS = 240
const RECENCY_FLOOR = 0.15
// Applied when a row has no usable timestamp — treated as "age unknown",
// deliberately mid-scale so a missing date neither inflates nor erases it.
const RECENCY_UNKNOWN = 0.5

// Negatives can suppress at most 95% of a genre's positive score, never 100% —
// this is what makes the "no genre with real signal returns zero" guarantee hold
// even for a user who swipe-lefts a genre they also play.
const NEGATIVE_RETENTION = 0.05
// Normalized-affinity floor. The old 4-decimal rounding could turn a small but
// real weight into exactly 0.0; this makes that unrepresentable.
const MIN_AFFINITY = 0.000001

// Statuses that mean "I finished this", vs intent, vs abandonment.
const FINISHED_STATUSES = new Set(['played', 'completed', 'finished'])
const BACKLOG_STATUSES = new Set(['want', 'want_to_play', 'want-to-play', 'backlog'])
const DROPPED_STATUSES = new Set(['dropped'])

const CONFIDENCE_FULL = 8 // signal games → confidence 1.0

// Supabase caps a single select at 1000 rows. The behavioral tables (sessions,
// activity events, list entries) grow without bound, so every read paginates —
// silently truncating input would quietly corrupt every vector.
const PAGE_SIZE = 1000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-engine-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

// ── IGDB throttle + concurrency ──────────────────────────────────────────────
const rateWindow: number[] = []
async function throttle() {
  while (true) {
    const now = Date.now()
    while (rateWindow.length && now - rateWindow[0] >= RATE_WINDOW_MS) rateWindow.shift()
    if (rateWindow.length < RATE_MAX) { rateWindow.push(now); return }
    await new Promise((r) => setTimeout(r, RATE_WINDOW_MS - (now - rateWindow[0]) + 5))
  }
}

// Observability for the rate ceiling. Widening the signal set grows the number
// of games needing tag resolution, so the daily job reports what it actually
// spent against IGDB — a regression here should be visible, not inferred.
const igdbStats = {
  requests: 0,
  inFlight: 0,
  peakConcurrency: 0,
  peakPerSecond: 0,
}
function resetIgdbStats() {
  igdbStats.requests = 0
  igdbStats.inFlight = 0
  igdbStats.peakConcurrency = 0
  igdbStats.peakPerSecond = 0
  rateWindow.length = 0
}

async function igdb(endpoint: string, query: string): Promise<any[]> {
  await throttle()
  igdbStats.requests++
  igdbStats.peakPerSecond = Math.max(igdbStats.peakPerSecond, rateWindow.length)
  igdbStats.inFlight++
  igdbStats.peakConcurrency = Math.max(igdbStats.peakConcurrency, igdbStats.inFlight)
  try {
    return await igdbFetch(endpoint, query)
  } finally {
    igdbStats.inFlight--
  }
}

async function igdbFetch(endpoint: string, query: string): Promise<any[]> {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ endpoint, query }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`IGDB ${endpoint} ${res.status}: ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

// Run async fn over items with bounded concurrency.
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * Read an entire table/filtered set in PAGE_SIZE pages.
 *
 * `build` must return a fresh query builder each call (Supabase builders are
 * single-use). Stops on a short page. On error it returns what it has so far
 * rather than throwing — a transient failure should degrade one signal, not
 * abort the whole nightly run.
 */
async function fetchAll(build: () => any, label: string): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error(`[taste-engine] ${label} page ${from} failed:`, error.message)
      return out
    }
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return out
  }
}

// ── Recency ──────────────────────────────────────────────────────────────────
/**
 * Recency multiplier for a signal that happened at `at`.
 *
 * Exponential decay with a nonzero floor: recent behavior counts far more than
 * old behavior, but a genre you loved three years ago never falls out of the
 * vector entirely. Future timestamps (clock skew) clamp to 1.
 */
function recencyWeight(at: number | null, nowMs: number): number {
  if (at == null || !Number.isFinite(at)) return RECENCY_UNKNOWN
  const ageDays = Math.max(0, (nowMs - at) / 86400000)
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS)
}

/** Parse a timestamp column to epoch ms, or null when absent/unparseable. */
function ts(value: any): number | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

/** Latest (largest) of several possibly-null epoch ms values. */
function latest(...values: (number | null)[]): number | null {
  let best: number | null = null
  for (const v of values) if (v != null && (best == null || v > best)) best = v
  return best
}

// ── IGDB /multiquery batching ────────────────────────────────────────────────
// A naive implementation would fire one IGDB round trip per tag-resolution
// chunk — many requests per user, per day, across the whole user base.
// Instead every independent lookup becomes a named sub-query and gets
// packed, up to MULTIQUERY_MAX_SUBQUERIES at a time, into a single POST to
// IGDB's /multiquery endpoint — collapsing what would be N round trips into
// a small constant number (~1-2 per user for the full signal-tag set).
interface SubQuery { name: string; endpoint: string; body: string }

function subQueryBlock(sq: SubQuery): string {
  return `query ${sq.endpoint} "${sq.name}" {\n  ${sq.body}\n};`
}

/** Runs `subQueries` through IGDB /multiquery, batched ≤10 per POST, and
 * returns a Map<subQuery.name, result rows>. A failed batch degrades to
 * empty results for just that batch's sub-queries (never throws) so one
 * bad chunk can't blank out an entire user's recommendations. */
async function igdbMulti(subQueries: SubQuery[]): Promise<Map<string, any[]>> {
  const out = new Map<string, any[]>()
  if (subQueries.length === 0) return out

  const batches: SubQuery[][] = []
  for (let i = 0; i < subQueries.length; i += MULTIQUERY_MAX_SUBQUERIES) {
    batches.push(subQueries.slice(i, i + MULTIQUERY_MAX_SUBQUERIES))
  }

  const batchResults = await mapPool(batches, MAX_CONCURRENCY, async (batch) => {
    try {
      const body = batch.map(subQueryBlock).join('\n\n')
      return await igdb('multiquery', body)
    } catch (err) {
      console.error('[taste-engine] multiquery batch failed:', String(err))
      return []
    }
  })

  for (const rows of batchResults) {
    for (const entry of rows) {
      if (entry?.name) out.set(entry.name, Array.isArray(entry.result) ? entry.result : [])
    }
  }
  return out
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface GameTag {
  igdb_game_id: number
  name: string | null
  cover_image_id: string | null
  genre_ids: number[]
  genre_names: string[]
  theme_ids: number[]
  theme_names: string[]
  similar_game_ids: number[]
  total_rating: number | null
  total_rating_count: number | null
}

// ── Tag resolution (cache-first, IGDB fallback) ───────────────────────────────
function shapeIgdbGame(g: any): GameTag {
  const genres = Array.isArray(g.genres) ? g.genres : []
  const themes = Array.isArray(g.themes) ? g.themes : []
  const similar = Array.isArray(g.similar_games) ? g.similar_games : []
  return {
    igdb_game_id: Number(g.id),
    name: g.name ?? null,
    cover_image_id: g.cover?.image_id ?? null,
    genre_ids: genres.map((x: any) => Number(x.id)).filter(Boolean),
    genre_names: genres.map((x: any) => String(x.name)).filter(Boolean),
    theme_ids: themes.map((x: any) => Number(x.id)).filter(Boolean),
    theme_names: themes.map((x: any) => String(x.name)).filter(Boolean),
    similar_game_ids: similar.map((x: any) => (typeof x === 'object' ? Number(x.id) : Number(x))).filter(Boolean),
    total_rating: typeof g.total_rating === 'number' ? g.total_rating : null,
    total_rating_count: typeof g.total_rating_count === 'number' ? g.total_rating_count : null,
  }
}

const TAG_FIELDS =
  'fields name, cover.image_id, genres.id, genres.name, themes.id, themes.name, ' +
  'similar_games, total_rating, total_rating_count'

/**
 * Resolve GameTag for a set of IGDB ids. Reads fresh rows from the
 * game_tags cache, fetches the rest from IGDB (chunked), upserts new rows,
 * and returns a Map<id, GameTag>. `db` is the service-role client.
 */
async function resolveTags(db: any, ids: number[]): Promise<Map<number, GameTag>> {
  const result = new Map<number, GameTag>()
  const unique = Array.from(new Set(ids.map(Number).filter(Boolean)))
  if (unique.length === 0) return result

  // 1. Cache read (only rows fresh within the TTL are trusted).
  const freshCutoff = new Date(Date.now() - TAG_TTL_MS).toISOString()
  const { data: cached } = await db
    .from('game_tags')
    .select('*')
    .in('igdb_game_id', unique)
    .gte('fetched_at', freshCutoff)
  for (const row of cached || []) result.set(Number(row.igdb_game_id), row as GameTag)

  const missing = unique.filter((id) => !result.has(id))
  if (missing.length === 0) return result

  // 2. IGDB fetch for the misses, chunked + batched via /multiquery so
  // however many chunks this pass needs still costs a small bounded
  // number of round trips (≤10 chunks per POST) rather than one per chunk.
  const chunks: number[][] = []
  for (let i = 0; i < missing.length; i += ID_CHUNK) chunks.push(missing.slice(i, i + ID_CHUNK))

  const subQueries: SubQuery[] = chunks.map((chunk, i) => ({
    name: `tags_${i}`,
    endpoint: 'games',
    body: `${TAG_FIELDS}; where id = (${chunk.join(',')}); limit ${chunk.length};`,
  }))
  const resultsByName = await igdbMulti(subQueries)

  const toUpsert: GameTag[] = []
  for (const games of resultsByName.values()) {
    for (const g of games) {
      if (!g?.id) continue
      const tag = shapeIgdbGame(g)
      result.set(tag.igdb_game_id, tag)
      toUpsert.push(tag)
    }
  }

  // 3. Persist to cache (fetched_at defaults to now()).
  if (toUpsert.length > 0) {
    const rows = toUpsert.map((t) => ({ ...t, fetched_at: new Date().toISOString() }))
    const { error } = await db.from('game_tags').upsert(rows, { onConflict: 'igdb_game_id' })
    if (error) console.error('[taste-engine] game_tags upsert error:', error.message)
  }
  return result
}

// ── Vector maths ───────────────────────────────────────────────────────────────
/**
 * L2-normalize a raw weight map so cosine similarity between two users is a
 * plain dot product.
 *
 * Two deliberate properties, both load-bearing for the "no genre with real
 * signal returns zero" guarantee:
 *   • keys with a non-positive raw weight are DROPPED, not stored as 0 — the
 *     vector only ever claims positive affinity;
 *   • a surviving key is floored at MIN_AFFINITY, so a genuinely small weight
 *     (one light swipe against 300 hours elsewhere) cannot round to 0.0. The
 *     previous 4-decimal rounding silently did exactly that.
 */
function l2normalize(raw: Record<string, number>): Record<string, number> {
  const norm = Math.sqrt(Object.values(raw).reduce((s, v) => s + (v > 0 ? v * v : 0), 0))
  if (norm === 0) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v <= 0) continue
    out[k] = Math.max(MIN_AFFINITY, Math.round((v / norm) * 1e6) / 1e6)
  }
  return out
}

/** Round to `dp` decimals for compact, readable jsonb payloads. */
function round(v: number, dp = 2): number {
  const f = Math.pow(10, dp)
  return Math.round(v * f) / f
}

// ── Per-user data model ─────────────────────────────────────────────────────────
/** Every behavioral signal type that can contribute to a taste vector. */
type SignalKind =
  | 'hours' | 'rating' | 'review' | 'finished'
  | 'list' | 'backlog' | 'swipe_right' | 'swipe_left'

/** One behavior, with when it happened so it can be recency-decayed. */
interface Contribution {
  kind: SignalKind
  points: number      // pre-decay; negative for swipe_left
  at: number | null   // epoch ms, null = unknown
}

interface GameSignals {
  gid: number
  title: string | null
  contributions: Contribution[]
  hours: number
  finished: boolean
  rated: boolean
  reviewed: boolean
  /** Genres/themes straight off a swipe row — used only when IGDB tag
   * resolution didn't return anything for this game, so a swipe still lands
   * in the right genre bucket instead of being dropped. */
  fallbackGenres: string[]
  fallbackThemes: string[]
}

interface UserSignal {
  userId: string
  games: Map<number, GameSignals>
  knownIds: Set<number> // every game the user knows (any signal) → exclude from recs
  listsCreated: number
  ratedGames: Set<number>
  reviewedGames: Set<number>
  finishedGames: Set<number>
  backlogGames: Set<number>
  listGames: Set<number>
  sessionCount: number
  swipeRight: number
  swipeLeft: number
}

/**
 * Fold every behavioral source into per-user, per-game contribution lists.
 *
 * Signals are ADDITIVE, not max()'d: a game you played 40 hours, finished,
 * reviewed and rated contributes all four, which is the whole point — the old
 * engine kept only the single largest and threw the rest away.
 */
function buildUserSignals(sources: {
  reviews: any[]
  trackers: any[]
  sessions: any[]
  lists: any[]
  listGames: any[]
  events: any[]
  swipes: any[]
}): Map<string, UserSignal> {
  const users = new Map<string, UserSignal>()

  const ensure = (uid: string): UserSignal => {
    let u = users.get(uid)
    if (!u) {
      u = {
        userId: uid, games: new Map(), knownIds: new Set(), listsCreated: 0,
        ratedGames: new Set(), reviewedGames: new Set(), finishedGames: new Set(),
        backlogGames: new Set(), listGames: new Set(),
        sessionCount: 0, swipeRight: 0, swipeLeft: 0,
      }
      users.set(uid, u)
    }
    return u
  }

  const game = (uid: string, gid: number, title?: string | null): GameSignals => {
    const u = ensure(uid)
    u.knownIds.add(gid)
    let g = u.games.get(gid)
    if (!g) {
      g = {
        gid, title: title ?? null, contributions: [], hours: 0,
        finished: false, rated: false, reviewed: false,
        fallbackGenres: [], fallbackThemes: [],
      }
      u.games.set(gid, g)
    }
    if (!g.title && title) g.title = title
    return g
  }

  const idOf = (v: any): number => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  // Hours arrive from three places that must NOT be summed: play_sessions.hours,
  // game_trackers.hours_played (the trigger's roll-up of exactly those sessions)
  // and reviews.hours_played (self-reported total). We take the max as the
  // magnitude, but recency is tracked separately per source because only a
  // session's ended_at is real evidence of WHEN the user played — a tracker's
  // updated_at is bookkeeping and gets bumped by the roll-up trigger itself.
  const hoursBySource = new Map<string, {
    sessionHours: number; sessionAt: number | null
    otherHours: number; otherAt: number | null
  }>()
  const hoursEvidence = (uid: string, gid: number) => {
    const key = `${uid}:${gid}`
    let h = hoursBySource.get(key)
    if (!h) {
      h = { sessionHours: 0, sessionAt: null, otherHours: 0, otherAt: null }
      hoursBySource.set(key, h)
    }
    return h
  }

  // ── Reviews: an opinion (rating) AND an act of engagement (writing) ─────────
  // These are separate signals about the same game and both count.
  for (const r of sources.reviews) {
    const uid = r.user_id, gid = idOf(r.igdb_game_id)
    if (!uid || !gid) continue
    const g = game(uid, gid, r.game_title)
    const at = latest(ts(r.updated_at), ts(r.created_at))

    const rating = Number(r.rating)
    if (Number.isFinite(rating) && rating > 0) {
      g.rated = true
      ensure(uid).ratedGames.add(gid)
      g.contributions.push({
        kind: 'rating',
        points: RATING_MAX_POINTS * Math.min(1, rating / RATING_SCALE_MAX),
        at,
      })
    }

    const body = typeof r.body === 'string' ? r.body.trim() : ''
    if (body.length > 0) {
      g.reviewed = true
      ensure(uid).reviewedGames.add(gid)
      g.contributions.push({
        kind: 'review',
        points: REVIEW_POINTS + (body.length >= REVIEW_LONGFORM_CHARS ? REVIEW_LONGFORM_BONUS : 0),
        at,
      })
    }

    // reviews.hours_played is a self-reported total for the game. Held as
    // secondary hours evidence and reconciled below so it can't double-count.
    const rh = Number(r.hours_played)
    if (Number.isFinite(rh) && rh > 0) {
      const h = hoursEvidence(uid, gid)
      if (rh > h.otherHours) { h.otherHours = rh; h.otherAt = at }
    }
  }

  // ── Play sessions: hours played, the strongest signal ───────────────────────
  // Summed per game across sessions. Only completed sessions count — an open
  // timer has no duration yet.
  for (const s of sources.sessions) {
    const uid = s.user_id, gid = idOf(s.igdb_game_id)
    if (!uid || !gid) continue
    if (!s.ended_at) continue
    game(uid, gid, s.game_title)
    ensure(uid).sessionCount++

    const hours = Number(s.hours)
    const seconds = Number(s.seconds)
    const h = Number.isFinite(hours) && hours > 0
      ? hours
      : (Number.isFinite(seconds) && seconds > 0 ? seconds / 3600 : 0)

    const ev = hoursEvidence(uid, gid)
    ev.sessionHours += h
    ev.sessionAt = latest(ev.sessionAt, ts(s.ended_at), ts(s.played_on))
  }

  // ── Trackers: status → finished / backlog, plus rating and rolled-up hours ──
  for (const t of sources.trackers) {
    const uid = t.user_id, gid = idOf(t.igdb_game_id)
    if (!uid || !gid) continue
    const g = game(uid, gid, t.game_title)
    const u = ensure(uid)
    const status = String(t.status || '').toLowerCase()
    const at = latest(ts(t.last_played_at), ts(t.updated_at), ts(t.created_at))

    if (FINISHED_STATUSES.has(status)) {
      g.finished = true
      u.finishedGames.add(gid)
    } else if (BACKLOG_STATUSES.has(status)) {
      u.backlogGames.add(gid)
      g.contributions.push({ kind: 'backlog', points: BACKLOG_POINTS, at })
    }
    // DROPPED_STATUSES add no positive intent points — but the user's hours and
    // rating on a dropped game still count. Playing a genre and bouncing off one
    // title is real genre interest.

    const tr = Number(t.rating)
    if (Number.isFinite(tr) && tr > 0 && !g.rated) {
      g.rated = true
      u.ratedGames.add(gid)
      g.contributions.push({
        kind: 'rating',
        points: RATING_MAX_POINTS * Math.min(1, tr / RATING_SCALE_MAX),
        at,
      })
    }

    // game_trackers.hours_played is the trigger's roll-up of play_sessions.hours,
    // so it is secondary evidence of the same hours, never additional hours.
    // (It IS the only hours source on instances where the roll-up trigger was
    // installed after existing sessions were backfilled.) Recency comes from
    // last_played_at only — updated_at is bumped by the roll-up trigger itself,
    // so trusting it would make ancient play time look like it happened today.
    const th = Number(t.hours_played)
    if (Number.isFinite(th) && th > 0) {
      const ev = hoursEvidence(uid, gid)
      if (th > ev.otherHours) {
        ev.otherHours = th
        ev.otherAt = ts(t.last_played_at)
      }
    }
  }

  // Apply reconciled hours once per game: max() magnitude across sources, with
  // recency taken from real session evidence when we have any.
  for (const u of users.values()) {
    for (const g of u.games.values()) {
      const ev = hoursBySource.get(`${u.userId}:${g.gid}`)
      if (!ev) continue
      const h = Math.max(ev.sessionHours, ev.otherHours)
      if (h <= 0) continue
      g.hours = h
      g.contributions.push({
        kind: 'hours',
        points: HOURS_COEF * Math.log1p(h),
        at: ev.sessionHours > 0 ? ev.sessionAt : ev.otherAt,
      })
    }
  }

  // ── activity_events: the only real COMPLETION timestamp we have ─────────────
  // game_trackers has no finished_at, so a `completed` event is what lets a
  // recent finish outrank an old one. entity_id is a text column shared with
  // UUID-keyed event types, so only numeric ids are IGDB games.
  for (const e of sources.events) {
    const uid = e.actor_user_id
    if (!uid || typeof e.entity_id !== 'string' || !/^\d+$/.test(e.entity_id)) continue
    const gid = idOf(e.entity_id)
    if (!gid) continue
    const type = String(e.type || '').toLowerCase()
    if (type !== 'completed') continue
    const g = game(uid, gid, e.metadata?.game_title ?? null)
    g.finished = true
    ensure(uid).finishedGames.add(gid)
  }

  // One `finished` contribution per game, dated from the completion event when
  // there is one, else the tracker's own timestamp.
  const completionAt = new Map<string, number | null>()
  for (const e of sources.events) {
    const uid = e.actor_user_id
    if (!uid || typeof e.entity_id !== 'string' || !/^\d+$/.test(e.entity_id)) continue
    if (String(e.type || '').toLowerCase() !== 'completed') continue
    const key = `${uid}:${idOf(e.entity_id)}`
    completionAt.set(key, latest(completionAt.get(key) ?? null, ts(e.created_at)))
  }
  for (const t of sources.trackers) {
    const uid = t.user_id, gid = idOf(t.igdb_game_id)
    if (!uid || !gid) continue
    if (!FINISHED_STATUSES.has(String(t.status || '').toLowerCase())) continue
    const key = `${uid}:${gid}`
    if (completionAt.get(key) == null) {
      // last_played_at is a real play timestamp; updated_at is bookkeeping and
      // only used when there is nothing better.
      completionAt.set(key, ts(t.last_played_at) ?? ts(t.updated_at) ?? ts(t.created_at))
    }
  }
  for (const u of users.values()) {
    for (const g of u.games.values()) {
      if (!g.finished) continue
      g.contributions.push({
        kind: 'finished',
        points: FINISHED_POINTS,
        at: completionAt.get(`${u.userId}:${g.gid}`) ?? null,
      })
    }
  }

  // ── Lists: curation ────────────────────────────────────────────────────────
  const listOwner = new Map<string, { userId: string; createdAt: number | null }>()
  for (const l of sources.lists) {
    if (!l?.id || !l.user_id) continue
    listOwner.set(String(l.id), { userId: l.user_id, createdAt: ts(l.created_at) })
    ensure(l.user_id).listsCreated++
  }
  for (const lg of sources.listGames) {
    const owner = listOwner.get(String(lg.list_id))
    const gid = idOf(lg.igdb_game_id)
    if (!owner || !gid) continue
    const g = game(owner.userId, gid, lg.game_title)
    ensure(owner.userId).listGames.add(gid)
    g.contributions.push({
      kind: 'list',
      points: LIST_POINTS,
      at: latest(ts(lg.added_at), owner.createdAt),
    })
  }

  // ── Swipes: light positive / light negative ────────────────────────────────
  // Read from the user_swipe_signals mirror — swipe history is device-local
  // (gt:swipes:v1) and would otherwise be invisible to a server-side job.
  for (const s of sources.swipes) {
    const uid = s.user_id, gid = idOf(s.igdb_game_id)
    if (!uid || !gid) continue
    const g = game(uid, gid, null)
    const u = ensure(uid)
    const action = String(s.action || '').toLowerCase()
    const at = ts(s.swiped_at)

    if (Array.isArray(s.genre_names)) g.fallbackGenres = s.genre_names.filter(Boolean).map(String)
    if (Array.isArray(s.theme_names)) g.fallbackThemes = s.theme_names.filter(Boolean).map(String)

    if (action === 'backlog') {
      u.swipeRight++
      g.contributions.push({ kind: 'swipe_right', points: SWIPE_RIGHT_POINTS, at })
    } else if (action === 'skip' || action === 'not_interested') {
      u.swipeLeft++
      g.contributions.push({
        kind: 'swipe_left',
        points: action === 'not_interested' ? SWIPE_NOT_INTERESTED_POINTS : SWIPE_SKIP_POINTS,
        at,
      })
    }
  }

  return users
}

// ── Vector assembly ───────────────────────────────────────────────────────────
interface GenreAccum {
  positive: number
  negative: number
  byKind: Record<string, number>
  games: Set<number>
}

/** Accumulate decayed contributions into a tag bucket (genre or theme). */
function accumulate(
  bucket: Map<string, GenreAccum>,
  names: string[],
  gid: number,
  contributions: Contribution[],
  nowMs: number,
) {
  for (const name of names) {
    let a = bucket.get(name)
    if (!a) { a = { positive: 0, negative: 0, byKind: {}, games: new Set() }; bucket.set(name, a) }
    for (const c of contributions) {
      const decayed = c.points * recencyWeight(c.at, nowMs)
      if (decayed >= 0) a.positive += decayed
      else a.negative += -decayed
      a.byKind[c.kind] = (a.byKind[c.kind] || 0) + decayed
      a.games.add(gid)
    }
  }
}

/**
 * Collapse accumulators into (raw weights, provenance) — the step that makes the
 * non-zero guarantee real.
 *
 * A genre with positive signal keeps at least NEGATIVE_RETENTION of that
 * positive score no matter how much negative signal it also carries, so a
 * left-swipe can never zero out a genre the user demonstrably plays. Genres with
 * only negative signal are dropped: that is a dislike, not an affinity.
 */
function collapse(bucket: Map<string, GenreAccum>): {
  raw: Record<string, number>
  signals: Record<string, any>
} {
  const raw: Record<string, number> = {}
  const signals: Record<string, any> = {}
  for (const [name, a] of bucket) {
    if (a.positive <= 0) continue
    raw[name] = Math.max(a.positive - a.negative, a.positive * NEGATIVE_RETENTION)
    const byKind: Record<string, number> = {}
    for (const [k, v] of Object.entries(a.byKind)) byKind[k] = round(v, 3)
    signals[name] = { raw: round(raw[name], 3), games: a.games.size, signals: byKind }
  }
  return { raw, signals }
}

// ── Main refresh routine ──────────────────────────────────────────────────────
async function refresh(db: any, opts: { userId?: string; limit?: number }) {
  resetIgdbStats()

  // 1. Load EVERY behavioral signal source (service role bypasses RLS).
  // All reads paginate — these tables grow without bound and a silently
  // truncated page would corrupt vectors rather than fail loudly.
  const only = (q: any) => (opts.userId ? q.eq('user_id', opts.userId) : q)
  const nowMs = Date.now()

  const [reviews, trackers, sessions, lists, events, swipes] = await Promise.all([
    fetchAll(() => only(db.from('reviews').select(
      'user_id, igdb_game_id, rating, body, hours_played, game_title, created_at, updated_at')), 'reviews'),
    fetchAll(() => only(db.from('game_trackers').select(
      'user_id, igdb_game_id, status, rating, hours_played, game_title, last_played_at, created_at, updated_at')), 'game_trackers'),
    fetchAll(() => only(db.from('play_sessions').select(
      'user_id, igdb_game_id, hours, seconds, started_at, ended_at, played_on, game_title')), 'play_sessions'),
    fetchAll(() => only(db.from('lists').select('id, user_id, created_at')), 'lists'),
    fetchAll(() => (opts.userId
      ? db.from('activity_events').select('actor_user_id, type, entity_id, metadata, created_at')
          .eq('actor_user_id', opts.userId).eq('type', 'completed')
      : db.from('activity_events').select('actor_user_id, type, entity_id, metadata, created_at')
          .eq('type', 'completed')), 'activity_events'),
    fetchAll(() => only(db.from('user_swipe_signals').select(
      'user_id, igdb_game_id, action, genre_names, theme_names, swiped_at')), 'user_swipe_signals'),
  ])

  // list_games has no user_id — it inherits ownership from its parent list, so
  // fetch entries for the lists we just loaded, chunked to keep the `in(...)`
  // filter (and therefore the request URL) bounded.
  const listGames: any[] = []
  const listIds = (lists || []).map((l: any) => l.id).filter(Boolean)
  for (let i = 0; i < listIds.length; i += 200) {
    const chunk = listIds.slice(i, i + 200)
    listGames.push(...await fetchAll(
      () => db.from('list_games').select('list_id, igdb_game_id, added_at, game_title').in('list_id', chunk),
      'list_games',
    ))
  }

  const users = buildUserSignals({
    reviews, trackers, sessions, lists, listGames, events, swipes,
  })
  let userList = Array.from(users.values())
  if (opts.limit && opts.limit > 0) userList = userList.slice(0, opts.limit)

  // 2. Resolve tags for every signal game up front, in ONE shared cache pass
  // across all users and all signal sources. Widening the signal set (sessions,
  // lists and swipes now contribute ids) grows this id list but NOT the request
  // count materially: resolveTags reads game_tags first and only the cache
  // misses go to IGDB, chunked ID_CHUNK ids per sub-query and packed
  // MULTIQUERY_MAX_SUBQUERIES sub-queries per POST, under the global ≤4 req/s +
  // ≤8 concurrent throttle. 1000 previously-unseen games costs 1 POST.
  const allSignalIds = new Set<number>()
  for (const u of userList) for (const gid of u.games.keys()) allSignalIds.add(gid)
  const tags = await resolveTags(db, Array.from(allSignalIds))

  let vectorsWritten = 0

  for (const u of userList) {
    // 3. Build the normalized affinity vector from every behavioral signal.
    const genreBucket = new Map<string, GenreAccum>()
    const themeBucket = new Map<string, GenreAccum>()
    let signalCount = 0
    let hoursTotal = 0
    let lastSignalAt: number | null = null
    const signalTotals: Record<string, number> = {}
    const weightedGames: {
      gid: number; weight: number; title: string | null; tag?: GameTag
    }[] = []

    for (const [gid, g] of u.games) {
      const tag = tags.get(gid)
      // A game the user swiped on may not have resolved IGDB tags yet; the swipe
      // row carries the card's own genre names so the signal still lands in the
      // right bucket instead of being silently dropped.
      const genreNames = tag?.genre_names?.length ? tag.genre_names : g.fallbackGenres
      const themeNames = tag?.theme_names?.length ? tag.theme_names : g.fallbackThemes

      // This game's net decayed score, used for topRatedIds ranking.
      let decayedTotal = 0
      for (const c of g.contributions) {
        const decayed = c.points * recencyWeight(c.at, nowMs)
        decayedTotal += decayed
        signalTotals[c.kind] = (signalTotals[c.kind] || 0) + decayed
        if (c.at != null) lastSignalAt = latest(lastSignalAt, c.at)
      }

      hoursTotal += g.hours
      weightedGames.push({
        gid, weight: decayedTotal, title: g.title || tag?.name || null, tag,
      })

      if (genreNames.length === 0 && themeNames.length === 0) continue
      if (g.contributions.length === 0) continue
      signalCount++

      accumulate(genreBucket, genreNames, gid, g.contributions, nowMs)
      accumulate(themeBucket, themeNames, gid, g.contributions, nowMs)
    }

    if (signalCount === 0) continue // nothing real to store — skip (no fabrication)

    const { raw: rawGenre, signals: genreSignalDetail } = collapse(genreBucket)
    const { raw: rawTheme, signals: themeSignalDetail } = collapse(themeBucket)

    const genreWeights = l2normalize(rawGenre)
    const themeWeights = l2normalize(rawTheme)

    // Stitch the normalized affinity back into the provenance map so a caller
    // gets the score and its explanation in one read, and drop any genre that
    // didn't survive normalization so the two can never disagree.
    const genreSignals: Record<string, any> = {}
    for (const [name, detail] of Object.entries(genreSignalDetail)) {
      if (genreWeights[name] == null) continue
      genreSignals[name] = { affinity: genreWeights[name], ...detail }
    }
    const themeSignals: Record<string, any> = {}
    for (const [name, detail] of Object.entries(themeSignalDetail)) {
      if (themeWeights[name] == null) continue
      themeSignals[name] = { affinity: themeWeights[name], ...detail }
    }

    const confidence = Math.min(1, signalCount / CONFIDENCE_FULL)

    weightedGames.sort((a, b) => b.weight - a.weight)
    const topRatedIds = weightedGames.filter((g) => g.tag && g.weight > 0).slice(0, 8).map((g) => g.gid)

    const roundedTotals: Record<string, number> = {}
    for (const [k, v] of Object.entries(signalTotals)) roundedTotals[k] = round(v, 3)

    const { error: vErr } = await db.from('user_taste_vectors').upsert({
      user_id: u.userId,
      genre_weights: genreWeights,
      theme_weights: themeWeights,
      genre_signals: genreSignals,
      theme_signals: themeSignals,
      signal_totals: roundedTotals,
      top_rated_game_ids: topRatedIds,
      rated_game_count: u.ratedGames.size,
      tracked_game_count: u.knownIds.size,
      hours_total: round(hoursTotal, 2),
      session_count: u.sessionCount,
      reviewed_count: u.reviewedGames.size,
      list_game_count: u.listGames.size,
      lists_created: u.listsCreated,
      finished_count: u.finishedGames.size,
      backlog_count: u.backlogGames.size,
      swipe_right_count: u.swipeRight,
      swipe_left_count: u.swipeLeft,
      signal_count: signalCount,
      confidence: Math.round(confidence * 100) / 100,
      last_signal_at: lastSignalAt != null ? new Date(lastSignalAt).toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (vErr) { console.error('[taste-engine] vector upsert error:', vErr.message); continue }
    vectorsWritten++
  }

  return {
    users_processed: userList.length,
    vectors_written: vectorsWritten,
    // Rate-limit accounting: requests is total POSTs to IGDB (each carrying up
    // to MULTIQUERY_MAX_SUBQUERIES sub-queries), and the two peaks must stay
    // within RATE_MAX / MAX_CONCURRENCY.
    igdb_requests: igdbStats.requests,
    igdb_peak_per_second: igdbStats.peakPerSecond,
    igdb_peak_concurrency: igdbStats.peakConcurrency,
    igdb_limits: { max_per_second: RATE_MAX, max_concurrency: MAX_CONCURRENCY },
  }
}

// ── HTTP entrypoint ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders })
  }

  // Shared-secret gate (verify_jwt is off for this function).
  const provided = req.headers.get('x-engine-secret') || ''
  if (!ENGINE_SECRET || provided !== ENGINE_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Missing Supabase service configuration' }), { status: 500, headers: jsonHeaders })
  }

  let body: any = {}
  try { body = await req.json() } catch { /* empty body is fine */ }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  try {
    const summary = await refresh(db, { userId: body?.userId, limit: body?.limit })
    return new Response(JSON.stringify({ ok: true, ...summary }), { status: 200, headers: jsonHeaders })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[taste-engine] refresh failed:', message)
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500, headers: jsonHeaders })
  }
})

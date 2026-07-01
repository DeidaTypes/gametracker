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
// For every user with rating/tracking activity it:
//   1. Builds a NORMALIZED genre/theme affinity vector from their rated
//      games (weighted by rating) + tracked library → user_taste_vectors.
//   2. Selects the user's SEED SET: their top 10-15 highest-weighted
//      rated/tracked games (dynamic — fewer if they've rated fewer;
//      empty if none qualify) → user_recommendation_seeds.
//   3. For EACH seed independently: IGDB similar_games of that seed +
//      genre/theme matches sharing that seed's genres, filtered to
//      exclude owned titles + a quality bar, re-ranked by taste affinity
//      → that seed's own ~10-20-game list in user_recommendations, keyed
//      by (user, seed, game) so every seed's picks are cached and
//      retrievable independently.
//
// IGDB is reached through the existing `igdb-proxy` function's
// /multiquery endpoint so a user's whole batch of lookups (tag
// resolution across every seed + genre-candidate queries) rides in a
// small, bounded number of POSTs (~2-3/user) instead of one round trip
// per seed — see igdbMulti() below. All IGDB traffic is throttled to
// ≤4 req/s with ≤8 concurrent, batched via id lists (≤ ID_CHUNK per
// sub-query) and ≤ MULTIQUERY_MAX_SUBQUERIES sub-queries per POST.
//
// Auth: this function is deployed with verify_jwt=false and instead
// requires a shared `x-engine-secret` header matching the ENGINE_SECRET
// env var (set via `supabase secrets set`). pg_cron supplies it from Vault.
//
// Request  : POST { trigger?, userId?, limit? }
//   userId — optional: refresh a single user only (smoke tests).
//   limit  — optional cap on users processed (default: all).
// Response : 200 { ok, users_processed, vectors_written, seeds_written, recs_written }

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

// Vector weighting.
const STATUS_WEIGHT: Record<string, number> = {
  played: 3.0, completed: 3.0, finished: 3.0,
  currently: 2.5, playing: 2.5,
  want: 1.0,
  dropped: 0, // excluded from the positive vector (still excluded from recs)
}
const CONFIDENCE_FULL = 8 // signal games → confidence 1.0
const MIN_REC_SIGNAL = 2  // fewer tag-resolved signal games → no recs (empty)
const SEED_MIN_WEIGHT = 2.5 // "you played/loved" — honest attribution floor
const SEED_MAX = 15         // top 10-15 seeds — dynamic, scales down to however many qualify

// Recommendation quality bar + shaping.
const REC_MIN_RATING = 70
const REC_MIN_RATING_COUNT = 15
const REC_PER_SEED_MAX = 20 // each seed's OWN cached list, not a global merged top-N
const GENRE_CANDIDATE_LIMIT = 40

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

async function igdb(endpoint: string, query: string): Promise<any[]> {
  await throttle()
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

// ── IGDB /multiquery batching ────────────────────────────────────────────────
// Selecting 10-15 seeds per user (up from a single seed) means a naive
// implementation would fire one IGDB round trip per seed/genre lookup —
// 10-15+ requests per user, per day, across the whole user base. Instead
// every independent lookup (a tag-resolution chunk, a genre-candidate
// query, ...) becomes a named sub-query and gets packed, up to
// MULTIQUERY_MAX_SUBQUERIES at a time, into a single POST to IGDB's
// /multiquery endpoint — collapsing what would be N round trips into a
// small constant number (~2-3 per user for the full seed set).
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
function l2normalize(raw: Record<string, number>): Record<string, number> {
  const norm = Math.sqrt(Object.values(raw).reduce((s, v) => s + v * v, 0))
  if (norm === 0) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw)) out[k] = Math.round((v / norm) * 10000) / 10000
  return out
}

// Cosine of a candidate's binary tag set against a normalized user vector.
function tagCosine(tagNames: string[], userVec: Record<string, number>): number {
  if (tagNames.length === 0) return 0
  const invLen = 1 / Math.sqrt(tagNames.length) // candidate vector L2-normalized (binary)
  let dot = 0
  for (const name of tagNames) {
    const w = userVec[name]
    if (w) dot += w * invLen
  }
  return Math.max(0, Math.min(1, dot))
}

// ── Per-user data model ─────────────────────────────────────────────────────────
interface UserSignal {
  userId: string
  // gameId -> { weight, title } (weight = max of review/tracker signal)
  games: Map<number, { weight: number; title: string | null }>
  trackedIds: Set<number> // every game the user knows (any status) → exclude from recs
}

function buildUserSignals(reviews: any[], trackers: any[]): Map<string, UserSignal> {
  const users = new Map<string, UserSignal>()
  const ensure = (uid: string): UserSignal => {
    let u = users.get(uid)
    if (!u) { u = { userId: uid, games: new Map(), trackedIds: new Set() }; users.set(uid, u) }
    return u
  }
  const bump = (uid: string, gid: number, weight: number, title: string | null) => {
    const u = ensure(uid)
    const prev = u.games.get(gid)
    if (!prev || weight > prev.weight) u.games.set(gid, { weight, title: title ?? prev?.title ?? null })
    else if (prev && !prev.title && title) prev.title = title
  }

  for (const r of reviews) {
    const uid = r.user_id, gid = Number(r.igdb_game_id)
    if (!uid || !gid) continue
    ensure(uid).trackedIds.add(gid)
    const rating = Number(r.rating)
    if (Number.isFinite(rating) && rating > 0) bump(uid, gid, rating, r.game_title ?? null)
  }
  for (const t of trackers) {
    const uid = t.user_id, gid = Number(t.igdb_game_id)
    if (!uid || !gid) continue
    ensure(uid).trackedIds.add(gid)
    const status = String(t.status || '').toLowerCase()
    const tr = Number(t.rating)
    const weight = Number.isFinite(tr) && tr > 0 ? tr : (STATUS_WEIGHT[status] ?? 0)
    if (weight > 0) bump(uid, gid, weight, t.game_title ?? null)
  }
  return users
}

// ── Main refresh routine ──────────────────────────────────────────────────────
async function refresh(db: any, opts: { userId?: string; limit?: number }) {
  // 1. Load real rating + tracking data (service role bypasses RLS).
  const reviewQ = db.from('reviews').select('user_id, igdb_game_id, rating, game_title')
  const trackerQ = db.from('game_trackers').select('user_id, igdb_game_id, status, rating, game_title')
  if (opts.userId) { reviewQ.eq('user_id', opts.userId); trackerQ.eq('user_id', opts.userId) }
  const [{ data: reviews }, { data: trackers }] = await Promise.all([reviewQ, trackerQ])

  const users = buildUserSignals(reviews || [], trackers || [])
  let userList = Array.from(users.values())
  if (opts.limit && opts.limit > 0) userList = userList.slice(0, opts.limit)

  // 2. Resolve tags for every signal game up front (one shared cache pass).
  const allSignalIds = new Set<number>()
  for (const u of userList) for (const gid of u.games.keys()) allSignalIds.add(gid)
  const tags = await resolveTags(db, Array.from(allSignalIds))

  // Per-run cache of "top games in genre" candidate lists.
  const genreTopCache = new Map<number, GameTag[]>()

  let vectorsWritten = 0
  let seedsWritten = 0
  let recsWritten = 0

  for (const u of userList) {
    // 3. Build the normalized affinity vector.
    const rawGenre: Record<string, number> = {}
    const rawTheme: Record<string, number> = {}
    const genreIdWeight = new Map<number, number>()
    let signalCount = 0
    const weightedGames: { gid: number; weight: number; title: string | null; tag?: GameTag }[] = []

    for (const [gid, info] of u.games) {
      const tag = tags.get(gid)
      weightedGames.push({ gid, weight: info.weight, title: info.title, tag })
      if (!tag) continue
      if (tag.genre_names.length === 0 && tag.theme_names.length === 0) continue
      signalCount++
      for (const gn of tag.genre_names) rawGenre[gn] = (rawGenre[gn] || 0) + info.weight
      for (const tn of tag.theme_names) rawTheme[tn] = (rawTheme[tn] || 0) + info.weight
      for (const gid2 of tag.genre_ids) genreIdWeight.set(gid2, (genreIdWeight.get(gid2) || 0) + info.weight)
    }

    if (signalCount === 0) continue // nothing real to store — skip (no fabrication)

    const genreWeights = l2normalize(rawGenre)
    const themeWeights = l2normalize(rawTheme)
    const confidence = Math.min(1, signalCount / CONFIDENCE_FULL)

    weightedGames.sort((a, b) => b.weight - a.weight)
    const topRatedIds = weightedGames.filter((g) => g.tag).slice(0, 8).map((g) => g.gid)

    const trackedCount = u.trackedIds.size
    const ratedCount = (reviews || []).filter((r) => r.user_id === u.userId).length

    const { error: vErr } = await db.from('user_taste_vectors').upsert({
      user_id: u.userId,
      genre_weights: genreWeights,
      theme_weights: themeWeights,
      top_rated_game_ids: topRatedIds,
      rated_game_count: ratedCount,
      tracked_game_count: trackedCount,
      signal_count: signalCount,
      confidence: Math.round(confidence * 100) / 100,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (vErr) { console.error('[taste-engine] vector upsert error:', vErr.message); continue }
    vectorsWritten++

    // 4. Recommendations — only with enough signal (else leave both caches empty).
    if (signalCount < MIN_REC_SIGNAL) {
      await db.from('user_recommendations').delete().eq('user_id', u.userId)
      await db.from('user_recommendation_seeds').delete().eq('user_id', u.userId)
      continue
    }

    // Seed set: the user's top 10-15 highest-weighted games they genuinely
    // played/loved — dynamic, not a fixed count. Scales down to however
    // many qualify (min 1); empty when none clear the honesty floor.
    const seeds = weightedGames.filter((g) => g.tag && g.weight >= SEED_MIN_WEIGHT).slice(0, SEED_MAX)
    if (seeds.length === 0) {
      await db.from('user_recommendations').delete().eq('user_id', u.userId)
      await db.from('user_recommendation_seeds').delete().eq('user_id', u.userId)
      continue
    }

    // 4a. Genre/theme candidate pool — the user's top 3 genres overall
    // (shared across seeds so this stays a handful of queries regardless
    // of seed count), fetched via ONE /multiquery POST for whichever
    // genres this run hasn't already cached.
    const topGenreIds = Array.from(genreIdWeight.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id)
    const missingGenreIds = topGenreIds.filter((id) => !genreTopCache.has(id))
    if (missingGenreIds.length > 0) {
      const genreSubQueries: SubQuery[] = missingGenreIds.map((genreId) => ({
        name: `genre_${genreId}`,
        endpoint: 'games',
        body:
          `${TAG_FIELDS}; where genres = (${genreId}) & total_rating >= 75 & ` +
          `total_rating_count >= 25 & cover != null & version_parent = null; ` +
          `sort total_rating_count desc; limit ${GENRE_CANDIDATE_LIMIT};`,
      }))
      try {
        const resultsByName = await igdbMulti(genreSubQueries)
        const warmRows: GameTag[] = []
        for (const genreId of missingGenreIds) {
          const list = (resultsByName.get(`genre_${genreId}`) || []).map(shapeIgdbGame)
          genreTopCache.set(genreId, list)
          warmRows.push(...list)
        }
        // Opportunistically warm the tag cache with these rows.
        if (warmRows.length) {
          await db.from('game_tags').upsert(
            warmRows.map((t) => ({ ...t, fetched_at: new Date().toISOString() })),
            { onConflict: 'igdb_game_id' },
          )
        }
      } catch (err) {
        console.error('[taste-engine] genre candidate fetch failed:', String(err))
        for (const genreId of missingGenreIds) genreTopCache.set(genreId, [])
      }
    }

    // 4b. Build EACH seed's own candidate set independently: that seed's
    // similar_games (curated similarity) + genre candidates sharing one
    // of that seed's genres. The same candidate game can legitimately
    // appear under multiple seeds — every seed gets its own list.
    const seedCandidates = new Map<number, Map<number, boolean>>() // seedGid -> (candGid -> fromSimilar)
    for (const seed of seeds) {
      const m = new Map<number, boolean>()
      for (const simId of seed.tag?.similar_game_ids || []) {
        if (!u.trackedIds.has(simId)) m.set(simId, true)
      }
      for (const genreId of topGenreIds) {
        if (!seed.tag?.genre_ids.includes(genreId)) continue
        for (const cand of genreTopCache.get(genreId) || []) {
          if (u.trackedIds.has(cand.igdb_game_id)) continue
          if (!m.has(cand.igdb_game_id)) m.set(cand.igdb_game_id, false)
        }
      }
      seedCandidates.set(seed.gid, m)
    }

    // 5. Resolve tags for the UNION of every seed's candidates in one
    // batched pass (still just one /multiquery POST for the whole user,
    // regardless of how many seeds contributed candidates).
    const allCandidateIds = new Set<number>()
    for (const m of seedCandidates.values()) for (const gid of m.keys()) allCandidateIds.add(gid)
    const candTags = await resolveTags(db, Array.from(allCandidateIds))

    // 6. Score + rank each seed's candidates independently, then cache
    // that seed's own top ~10-20 list.
    const nowIso = new Date().toISOString()
    const recRows: any[] = []
    const seedRows: any[] = []

    seeds.forEach((seed, seedIdx) => {
      const seedTitle = seed.tag?.name || seed.title
      const candidates = seedCandidates.get(seed.gid) || new Map()

      const scored: any[] = []
      for (const [gid, fromSimilar] of candidates) {
        const tag = candTags.get(gid)
        if (!tag) continue
        // Quality bar + display requirements.
        if (tag.total_rating == null || tag.total_rating < REC_MIN_RATING) continue
        if (tag.total_rating_count == null || tag.total_rating_count < REC_MIN_RATING_COUNT) continue
        if (!tag.cover_image_id) continue

        const genreOverlap = tagCosine(tag.genre_names, genreWeights)
        const themeOverlap = tagCosine(tag.theme_names, themeWeights)
        const tasteBlend = 0.7 * genreOverlap + 0.3 * themeOverlap
        const qualityNorm = Math.max(0, Math.min(1, (tag.total_rating - REC_MIN_RATING) / 30))
        const base = 0.70 * tasteBlend + 0.15 * qualityNorm + (fromSimilar ? 0.15 : 0)
        const matchScore = Math.round(Math.max(0, Math.min(1, base)) * 100)

        scored.push({ gid, matchScore, tag })
      }

      scored.sort((a, b) => b.matchScore - a.matchScore)
      const top = scored.slice(0, REC_PER_SEED_MAX)

      for (const [i, s] of top.entries()) {
        recRows.push({
          user_id: u.userId,
          seed_game_id: seed.gid,
          seed_title: seedTitle,
          igdb_game_id: s.gid,
          match_score: s.matchScore,
          game_title: s.tag.name,
          game_image: s.tag.cover_image_id
            ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${s.tag.cover_image_id}.jpg`
            : null,
          genre_names: s.tag.genre_names,
          total_rating: s.tag.total_rating,
          total_rating_count: s.tag.total_rating_count,
          rank: i + 1,
          generated_at: nowIso,
        })
      }

      // Only keep the seed itself if it actually produced recommendations —
      // an empty seed shouldn't occupy a rotation slot client-side.
      if (top.length > 0) {
        seedRows.push({
          user_id: u.userId,
          seed_game_id: seed.gid,
          seed_title: seedTitle,
          seed_image: seed.tag?.cover_image_id
            ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${seed.tag.cover_image_id}.jpg`
            : null,
          seed_weight: seed.weight,
          seed_rank: seedIdx + 1,
          rec_count: top.length,
          generated_at: nowIso,
        })
      }
    })

    // Replace this user's seed set + recommendations atomically-ish
    // (delete then insert) so a shrinking seed set (fewer qualifying
    // games than yesterday) doesn't leave stale seeds/picks behind.
    await db.from('user_recommendations').delete().eq('user_id', u.userId)
    await db.from('user_recommendation_seeds').delete().eq('user_id', u.userId)

    if (seedRows.length > 0) {
      const { error: sErr } = await db.from('user_recommendation_seeds').insert(seedRows)
      if (sErr) console.error('[taste-engine] seeds insert error:', sErr.message)
      else seedsWritten += seedRows.length
    }
    if (recRows.length > 0) {
      const { error: rErr } = await db.from('user_recommendations').insert(recRows)
      if (rErr) console.error('[taste-engine] recs insert error:', rErr.message)
      else recsWritten += recRows.length
    }
  }

  return {
    users_processed: userList.length,
    vectors_written: vectorsWritten,
    seeds_written: seedsWritten,
    recs_written: recsWritten,
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

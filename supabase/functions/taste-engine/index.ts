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
//   2. Generates "Because you played X" recommendations: IGDB
//      similar_games of top-rated titles + genre matches, filtered to
//      exclude owned titles + a quality bar, re-ranked by taste affinity,
//      each attributed to its seed → user_recommendations.
//
// IGDB is reached through the existing `igdb-proxy` function so we REUSE
// its warm-instance Twitch token cache and /multiquery support. All IGDB
// traffic is throttled to ≤4 req/s with ≤8 concurrent, batched via id
// lists (≤ CHUNK per request).
//
// Auth: this function is deployed with verify_jwt=false and instead
// requires a shared `x-engine-secret` header matching the ENGINE_SECRET
// env var (set via `supabase secrets set`). pg_cron supplies it from Vault.
//
// Request  : POST { trigger?, userId?, limit? }
//   userId — optional: refresh a single user only (smoke tests).
//   limit  — optional cap on users processed (default: all).
// Response : 200 { ok, users_processed, vectors_written, recs_written }

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
const ID_CHUNK = 100 // ids per IGDB `where id = (...)` request

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

// Recommendation quality bar + shaping.
const REC_MIN_RATING = 70
const REC_MIN_RATING_COUNT = 15
const REC_TOP_N = 20
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

  // 2. IGDB fetch for the misses, chunked + throttled.
  const chunks: number[][] = []
  for (let i = 0; i < missing.length; i += ID_CHUNK) chunks.push(missing.slice(i, i + ID_CHUNK))

  const fetchedChunks = await mapPool(chunks, MAX_CONCURRENCY, async (chunk) => {
    try {
      const q = `${TAG_FIELDS}; where id = (${chunk.join(',')}); limit ${chunk.length};`
      return await igdb('games', q)
    } catch (err) {
      console.error('[taste-engine] tag fetch failed:', String(err))
      return []
    }
  })

  const toUpsert: GameTag[] = []
  for (const games of fetchedChunks) {
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

    // 4. Recommendations — only with enough signal (else leave empty).
    if (signalCount < MIN_REC_SIGNAL) {
      await db.from('user_recommendations').delete().eq('user_id', u.userId)
      continue
    }

    // Seeds: highest-weight games the user genuinely played/loved.
    const seeds = weightedGames.filter((g) => g.tag && g.weight >= SEED_MIN_WEIGHT).slice(0, 6)
    if (seeds.length === 0) {
      await db.from('user_recommendations').delete().eq('user_id', u.userId)
      continue
    }

    // Candidate map: gameId -> { seedId, seedTitle, fromSimilar }.
    const candidates = new Map<number, { seedId: number; seedTitle: string | null; fromSimilar: boolean }>()
    const addCandidate = (gid: number, seedId: number, seedTitle: string | null, fromSimilar: boolean) => {
      if (u.trackedIds.has(gid)) return
      if (!candidates.has(gid)) candidates.set(gid, { seedId, seedTitle, fromSimilar })
    }

    // 4a. IGDB similar_games of the seed titles (curated similarity).
    for (const seed of seeds) {
      const seedTitle = seed.tag?.name || seed.title
      for (const simId of seed.tag?.similar_game_ids || []) addCandidate(simId, seed.gid, seedTitle, true)
    }

    // 4b. Genre matches for the user's top genres (quality-gated).
    const topGenreIds = Array.from(genreIdWeight.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id)
    for (const genreId of topGenreIds) {
      let list = genreTopCache.get(genreId)
      if (!list) {
        try {
          const q =
            `${TAG_FIELDS}; where genres = (${genreId}) & total_rating >= 75 & ` +
            `total_rating_count >= 25 & cover != null & version_parent = null; ` +
            `sort total_rating_count desc; limit ${GENRE_CANDIDATE_LIMIT};`
          list = (await igdb('games', q)).map(shapeIgdbGame)
          genreTopCache.set(genreId, list)
          // Opportunistically warm the tag cache with these rows.
          if (list.length) {
            await db.from('game_tags').upsert(
              list.map((t) => ({ ...t, fetched_at: new Date().toISOString() })),
              { onConflict: 'igdb_game_id' },
            )
          }
        } catch (err) {
          console.error('[taste-engine] genre candidate fetch failed:', String(err))
          list = []
          genreTopCache.set(genreId, list)
        }
      }
      // Attribute genre candidates to the user's strongest seed sharing this genre.
      const seedForGenre = seeds.find((s) => s.tag?.genre_ids.includes(genreId)) || seeds[0]
      for (const cand of list) addCandidate(cand.igdb_game_id, seedForGenre.gid, seedForGenre.tag?.name || seedForGenre.title, false)
    }

    // 5. Resolve candidate tags + score.
    const candIds = Array.from(candidates.keys())
    const candTags = await resolveTags(db, candIds)

    const scored: any[] = []
    for (const [gid, attrib] of candidates) {
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
      const base = 0.70 * tasteBlend + 0.15 * qualityNorm + (attrib.fromSimilar ? 0.15 : 0)
      const matchScore = Math.round(Math.max(0, Math.min(1, base)) * 100)

      scored.push({
        user_id: u.userId,
        igdb_game_id: gid,
        match_score: matchScore,
        because_of_game_id: attrib.seedId,
        because_of_title: attrib.seedTitle,
        game_title: tag.name,
        game_image: tag.cover_image_id
          ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${tag.cover_image_id}.jpg`
          : null,
        genre_names: tag.genre_names,
        total_rating: tag.total_rating,
        total_rating_count: tag.total_rating_count,
      })
    }

    scored.sort((a, b) => b.match_score - a.match_score)
    const top = scored.slice(0, REC_TOP_N).map((row, i) => ({ ...row, rank: i + 1, generated_at: new Date().toISOString() }))

    // Replace this user's recommendations atomically-ish (delete then insert).
    await db.from('user_recommendations').delete().eq('user_id', u.userId)
    if (top.length > 0) {
      const { error: rErr } = await db.from('user_recommendations').insert(top)
      if (rErr) console.error('[taste-engine] recs insert error:', rErr.message)
      else recsWritten += top.length
    }
  }

  return { users_processed: userList.length, vectors_written: vectorsWritten, recs_written: recsWritten }
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

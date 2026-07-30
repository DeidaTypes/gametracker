// @ts-nocheck
// supabase/functions/themed-drops/pool.ts
//
// Candidate pool refresh — the ONLY part of Themed Drops that touches IGDB.
//
// Everything downstream (selection, activation, the read RPC) works purely
// against public.drop_candidate_pool. That separation is what lets a drop swap
// at exactly 00:00 and what keeps Explore free of live IGDB calls: by the time
// a window opens, its games were chosen days earlier from a local table.
//
// The pool holds ONLY games already clearing the engine-wide hard floor —
// ~4.3k rows, and it stays there. It is a pool, not a mirror of IGDB's
// catalog.
//
// IGDB budget per full refresh: ~4 POSTs via /multiquery (one carrying every
// game page, three carrying the time-to-beat lookups), throttled to <=4 req/s
// with <=8 concurrent. Compare ~31 POSTs doing it one query at a time.

import { HARD_FLOOR_RATING, HARD_FLOOR_RATING_COUNT } from './selection.ts'

const PAGE_SIZE = 500              // IGDB's max rows per query
const TTB_IDS_PER_SUBQUERY = 200   // ids per `where game_id = (...)` sub-query
const MULTIQUERY_MAX_SUBQUERIES = 10
const UPSERT_CHUNK = 500

// IGDB refuses offsets past ~5000. The floor currently yields ~4.3k games so
// this is headroom, not a limit we operate at — but if a future floor change
// pushes the pool past it, we would silently lose the tail. Loud instead.
const MAX_OFFSET = 5000

// ── Time-to-beat plausibility bounds ────────────────────────────────────────
// IGDB's completion times are crowd-sourced and unvalidated, and the raw feed
// contains two kinds of value that are not completion times at all:
//
//   1. Data-entry junk. World Cup 98 is recorded at 567,890 hours (64 years)
//      off a single submission; others carry obvious sentinels like 99999 and
//      50000 hours.
//   2. Endless games. League of Legends (14,451h), WoW (6,617h), Minecraft
//      (1,045h) are real averages of how long people PLAY, but those games have
//      no completion to time. Offering League of Legends under "you'll be up
//      till sunrise" is worse than offering nothing.
//
// Both are rejected by storing NULL, which the time_to_beat filter already
// treats as "no recorded time" — so an implausible value is handled exactly
// like a missing one, and is never estimated or clamped into range.
//
// 200h is deliberately generous: the longest legitimately-finishable games
// (big JRPGs, Persona-length campaigns) land near 100-150h. Measured cost of
// both bounds together: 38 of 1770 recorded times, ~2%.
//
// Submission count is deliberately NOT used as a filter — 896 of 1770 times
// rest on a single submission, so requiring more would halve coverage, and the
// ceiling already catches every absurd single-submission value.
const TTB_MIN_PLAUSIBLE_SECONDS = 15 * 60
const TTB_MAX_PLAUSIBLE_SECONDS = 200 * 3600

function plausibleTimeToBeat(normally: unknown): number | null {
  if (typeof normally !== 'number' || !Number.isFinite(normally)) return null
  if (normally < TTB_MIN_PLAUSIBLE_SECONDS) return null
  if (normally > TTB_MAX_PLAUSIBLE_SECONDS) return null
  return normally
}

const GAME_FIELDS = [
  'id',
  'name',
  'cover.image_id',
  'total_rating',
  'total_rating_count',
  'first_release_date',
  'genres.id',
  'genres.name',
  'themes.id',
  'themes.name',
  'game_modes',
  'collections',
].join(', ')

/** The engine-wide hard floor, as an IGDB where-clause. */
export function floorClause(): string {
  return (
    // game_type 0 = main game. NOTE: IGDB retired the old `category` field —
    // `category = 0` still parses but matches ZERO rows, silently emptying any
    // query that uses it. Do not "fix" this back to category.
    `game_type = 0 & version_parent = null & cover != null` +
    ` & total_rating >= ${HARD_FLOOR_RATING}` +
    ` & total_rating_count >= ${HARD_FLOOR_RATING_COUNT}`
  )
}

const idsOf = (arr: unknown): number[] =>
  Array.isArray(arr)
    ? arr.map((x) => (typeof x === 'number' ? x : x?.id)).filter((n) => typeof n === 'number')
    : []

const namesOf = (arr: unknown): string[] =>
  Array.isArray(arr)
    ? arr.map((x) => (typeof x === 'string' ? x : x?.name)).filter((s) => typeof s === 'string')
    : []

export interface PoolRefreshResult {
  pool_size: number
  with_time_to_beat: number
  ttb_coverage_pct: number
  removed: number
  igdb_requests: number
  truncated: boolean
}

/**
 * Rebuild drop_candidate_pool from IGDB.
 *
 * @param supabase  service-role client
 * @param igdbMulti bundles sub-queries into /multiquery POSTs
 * @param igdb      single-query escape hatch (used only for games/count)
 */
export async function refreshCandidatePool(
  supabase: any,
  igdbMulti: (subs: { endpoint: string; name: string; body: string }[]) => Promise<Map<string, any[]>>,
  igdb: (endpoint: string, query: string) => Promise<any>,
): Promise<PoolRefreshResult> {
  const where = floorClause()

  const countRes = await igdb('games/count', `where ${where};`)
  const total = Number(countRes?.count ?? 0)
  if (!total) throw new Error('Candidate pool refresh: IGDB returned a zero count for the floor query.')

  const truncated = total > MAX_OFFSET
  const reachable = Math.min(total, MAX_OFFSET)
  if (truncated) {
    console.warn(
      `[themed-drops] floor matches ${total} games but IGDB caps paging at ${MAX_OFFSET}. ` +
        `Tighten HARD_FLOOR_RATING/HARD_FLOOR_RATING_COUNT — the tail is being dropped.`,
    )
  }

  // ── 1. Page every qualifying game ─────────────────────────────────────────
  // Sorted by total_rating_count desc so paging is stable and popularity rank
  // falls out of the fetch order for free.
  const pageCount = Math.ceil(reachable / PAGE_SIZE)
  const pageSubs = Array.from({ length: pageCount }, (_, i) => ({
    endpoint: 'games',
    name: `pool_${i}`,
    body:
      `fields ${GAME_FIELDS}; where ${where}; ` +
      `sort total_rating_count desc; limit ${PAGE_SIZE}; offset ${i * PAGE_SIZE};`,
  }))

  const pageResults = await igdbMulti(pageSubs)
  const raw: any[] = []
  for (let i = 0; i < pageCount; i++) raw.push(...(pageResults.get(`pool_${i}`) ?? []))

  // IGDB paging can repeat a row across pages when the sort key ties; dedupe.
  const byId = new Map<number, any>()
  for (const g of raw) if (g?.id) byId.set(g.id, g)
  const games = [...byId.values()]

  if (!games.length) throw new Error('Candidate pool refresh: IGDB returned no rows for the floor query.')

  // ── 2. Real completion times ──────────────────────────────────────────────
  // Never estimated. A game with no IGDB entry gets NULL, which the
  // time_to_beat filter reads as "does not qualify" rather than guessing.
  const ids = games.map((g) => g.id)
  const ttbSubs: { endpoint: string; name: string; body: string }[] = []
  for (let i = 0; i < ids.length; i += TTB_IDS_PER_SUBQUERY) {
    const chunk = ids.slice(i, i + TTB_IDS_PER_SUBQUERY)
    ttbSubs.push({
      endpoint: 'game_time_to_beats',
      name: `ttb_${i}`,
      // The FK is `game_id`. `game` parses on some IGDB deployments and 400s on
      // others — verified against this proxy, game_id is the one that works.
      body: `fields game_id, normally, count; where game_id = (${chunk.join(',')}); limit ${PAGE_SIZE};`,
    })
  }

  const ttbResults = await igdbMulti(ttbSubs)
  const ttbById = new Map<number, { seconds: number | null; count: number | null }>()
  for (const rows of ttbResults.values()) {
    for (const r of rows ?? []) {
      const gid = Number(r.game_id)
      if (!gid) continue
      ttbById.set(gid, {
        seconds: plausibleTimeToBeat(r.normally),
        count: typeof r.count === 'number' ? r.count : null,
      })
    }
  }

  // ── 3. Popularity rank -> the balance lean's discovery term ───────────────
  // Precomputed and stored rather than derived at selection time so the lean
  // is a stable, inspectable number: two selections over the same pool lean
  // identically, and a QA query can see exactly why a game ranked where it did.
  const ordered = [...games].sort(
    (a, b) => (b.total_rating_count ?? 0) - (a.total_rating_count ?? 0),
  )
  const rankById = new Map<number, number>()
  ordered.forEach((g, i) => rankById.set(g.id, i + 1))
  const denom = Math.max(ordered.length - 1, 1)

  const rows = games.map((g) => {
    const rank = rankById.get(g.id) ?? ordered.length
    const ttb = ttbById.get(g.id)
    return {
      igdb_game_id: g.id,
      name: g.name ?? null,
      cover_image_id: g.cover?.image_id ?? null,
      total_rating: g.total_rating ?? null,
      total_rating_count: g.total_rating_count ?? null,
      release_year: g.first_release_date
        ? new Date(g.first_release_date * 1000).getUTCFullYear()
        : null,
      genre_ids: idsOf(g.genres),
      genre_names: namesOf(g.genres),
      theme_ids: idsOf(g.themes),
      theme_names: namesOf(g.themes),
      game_mode_ids: idsOf(g.game_modes),
      collection_ids: idsOf(g.collections),
      time_to_beat_seconds: ttb?.seconds ?? null,
      time_to_beat_count: ttb?.count ?? null,
      popularity_rank: rank,
      popularity_pct: (rank - 1) / denom,
      refreshed_at: new Date().toISOString(),
    }
  })

  // ── 4. Write ──────────────────────────────────────────────────────────────
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await supabase
      .from('drop_candidate_pool')
      .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: 'igdb_game_id' })
    if (error) throw new Error(`drop_candidate_pool upsert failed: ${error.message}`)
  }

  // Games that fell below the floor since the last refresh (a rating slipped,
  // or IGDB reclassified them) must leave the pool, or they would keep
  // surfacing in drops forever.
  const keep = new Set(rows.map((r) => r.igdb_game_id))
  const { data: existing, error: readErr } = await supabase
    .from('drop_candidate_pool')
    .select('igdb_game_id')
  if (readErr) throw new Error(`drop_candidate_pool read failed: ${readErr.message}`)

  const stale = (existing ?? [])
    .map((r: any) => Number(r.igdb_game_id))
    .filter((id: number) => !keep.has(id))

  for (let i = 0; i < stale.length; i += UPSERT_CHUNK) {
    const { error } = await supabase
      .from('drop_candidate_pool')
      .delete()
      .in('igdb_game_id', stale.slice(i, i + UPSERT_CHUNK))
    if (error) throw new Error(`drop_candidate_pool prune failed: ${error.message}`)
  }

  const withTtb = rows.filter((r) => r.time_to_beat_seconds !== null).length

  return {
    pool_size: rows.length,
    with_time_to_beat: withTtb,
    ttb_coverage_pct: Math.round((withTtb / rows.length) * 1000) / 10,
    removed: stale.length,
    igdb_requests:
      1 + Math.ceil(pageSubs.length / MULTIQUERY_MAX_SUBQUERIES) +
      Math.ceil(ttbSubs.length / MULTIQUERY_MAX_SUBQUERIES),
    truncated,
  }
}

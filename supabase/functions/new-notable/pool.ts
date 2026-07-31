// @ts-nocheck
// supabase/functions/new-notable/pool.ts
//
// Candidate pool refresh — the ONLY part of New & Notable that touches
// IGDB. Everything downstream (the rail RPC, the see-all grid) reads purely
// from public.new_notable_pool, which is what keeps Explore free of live
// IGDB calls — same separation as themed-drops/pool.ts.
//
// ── Window: RELEASED ONLY ─────────────────────────────────────────────────
// first_release_date in [now - LOOKBACK_DAYS, NOW]. There is NO lookahead.
// An upcoming game is not "new" — it isn't anything yet — so nothing
// scheduled for the future can enter the pool. The IGDB `where` upper bound
// is the first line of defence and isReleased() in lanes.ts is the
// guarantee; both are applied on every refresh.
//
// LOOKBACK_DAYS is the recency half of "recently released". Measured at 90
// days (run 2026-07-31): 4380 games in the window, 4310 after dropping
// past-dated-but-not-actually-released titles, 25 of which clear a lane.
// Widening to 180 days would yield 64 — a deeper see-all grid at the cost of
// calling a six-month-old game "new". Change this one constant to trade
// depth for recency; nothing else needs to move.
//
// IGDB budget per full refresh: one games/count plus three paged fan-outs
// bundled into /multiquery POSTs. Three sort orders, deduped by id, because
// a single sort can only be paged to IGDB's ~5000-offset ceiling: sorting by
// total_rating_count alone would bury the high-score/low-count games Lane B
// exists for, and the fresh high-hype ones Lane A's support rule catches, in
// an arbitrary tie order among thousands of zero-count rows.

import { classifyLane, curateRail, isReleased, summarizeLanes } from './lanes.ts'
import { hasRecognizedPublisher } from './publishers.ts'

const DAY = 86400
export const LOOKBACK_DAYS = 90

const PAGE_SIZE = 500
const UPSERT_CHUNK = 500
// IGDB refuses offsets past ~5000, same ceiling themed-drops/pool.ts hits.
const MAX_OFFSET = 5000

const RAIL_PER_LANE = 8 // -> rail cap of up to 16 (2 lanes x 8)

const GAME_FIELDS = [
  'id',
  'name',
  'cover.image_id',
  'first_release_date',
  // Release status: past-dated is not the same as released — see
  // UNRELEASED_GAME_STATUSES in lanes.ts.
  'game_status',
  'total_rating',
  'total_rating_count',
  'hypes',
  'involved_companies.company.name',
  'involved_companies.publisher',
  'genres.id',
  'genres.name',
].join(', ')

// `follows` is deliberately absent: IGDB never populates it (0 of 4310 games
// in the measured window), so requesting it would only add response weight.
function baseWhere(nowSec) {
  const since = nowSec - LOOKBACK_DAYS * DAY
  return (
    // game_type 0 = main game. IGDB retired `category`; it still parses but
    // matches zero rows — do not "fix" this back (see themed-drops/pool.ts).
    `first_release_date >= ${since} & first_release_date <= ${nowSec}` +
    ` & cover != null & game_type = 0 & version_parent = null`
  )
}

const idsOf = (arr) =>
  Array.isArray(arr) ? arr.map((x) => (typeof x === 'number' ? x : x?.id)).filter((n) => typeof n === 'number') : []
const namesOf = (arr) =>
  Array.isArray(arr) ? arr.map((x) => (typeof x === 'string' ? x : x?.name)).filter((s) => typeof s === 'string') : []

export interface PoolRefreshResult {
  window_size: number
  not_yet_released_rejected: number
  classified: number
  lanes: { total: number; aaa: number; indie: number }
  rail_size: number
  removed: number
  igdb_requests: number
}

/**
 * Rebuild new_notable_pool from IGDB.
 *
 * @param supabase  service-role client
 * @param igdbMulti bundles sub-queries into /multiquery POSTs
 * @param igdb      single-query escape hatch (used for games/count)
 */
export async function refreshNewNotablePool(
  supabase: any,
  igdbMulti: (subs: { endpoint: string; name: string; body: string }[]) => Promise<Map<string, any[]>>,
  igdb: (endpoint: string, query: string) => Promise<any>,
): Promise<PoolRefreshResult> {
  const nowSec = Math.floor(Date.now() / 1000)
  const where = baseWhere(nowSec)

  const countRes = await igdb('games/count', `where ${where};`)
  const total = Number(countRes?.count ?? 0)
  if (!total) throw new Error('New & Notable pool refresh: IGDB returned a zero count for the window.')

  async function pageBy(sortClause: string, cap: number) {
    const reachable = Math.min(total, cap, MAX_OFFSET)
    const pageCount = Math.ceil(reachable / PAGE_SIZE)
    const subs = Array.from({ length: pageCount }, (_, i) => ({
      endpoint: 'games',
      name: `p_${sortClause.replace(/\W+/g, '')}_${i}`,
      body: `fields ${GAME_FIELDS}; where ${where}; sort ${sortClause}; limit ${PAGE_SIZE}; offset ${i * PAGE_SIZE};`,
    }))
    const results = await igdbMulti(subs)
    const out: any[] = []
    for (const sub of subs) out.push(...(results.get(sub.name) ?? []))
    return out
  }

  // One sort per signal a lane can qualify on, so no qualifier is unreachable
  // past the offset cap: volume (Lane A), score (Lane B), buzz (Lane A's
  // fresh-release support rule).
  const [byCount, byRating, byHypes] = await Promise.all([
    pageBy('total_rating_count desc', MAX_OFFSET),
    pageBy('total_rating desc', 1000),
    pageBy('hypes desc', 1000),
  ])

  const byId = new Map<number, any>()
  for (const g of [...byCount, ...byRating, ...byHypes]) if (g?.id) byId.set(g.id, g)
  const windowGames = [...byId.values()]
  if (!windowGames.length) throw new Error('New & Notable pool refresh: IGDB returned no rows for the window.')

  // ── Release gate, then lanes ────────────────────────────────────────────
  // Counted separately so the daily response reports how many rows the
  // release gate rejected — the number that must stay non-zero for us to
  // know the gate is actually doing something.
  let notYetReleased = 0
  const classified = []
  for (const g of windowGames) {
    if (!isReleased(g, nowSec)) { notYetReleased++; continue }

    const recognized = hasRecognizedPublisher(g.involved_companies)
    const result = classifyLane(g, recognized, nowSec)
    if (!result) continue
    classified.push({
      igdb_game_id: g.id,
      name: g.name ?? null,
      cover_image_id: g.cover?.image_id ?? null,
      release_date: new Date(g.first_release_date * 1000),
      total_rating: g.total_rating ?? null,
      total_rating_count: g.total_rating_count ?? null,
      hypes: g.hypes ?? null,
      genre_ids: idsOf(g.genres),
      genre_names: namesOf(g.genres),
      lane: result.lane,
      lane_score: result.lane_score,
      has_recognized_publisher: result.has_recognized_publisher,
    })
  }

  // Rail curation needs release_date as a sortable number.
  const forCuration = classified.map((g) => ({ ...g, release_date: g.release_date.getTime() }))
  const railPicks = curateRail(forCuration, RAIL_PER_LANE)
  const railRankById = new Map(railPicks.map((g) => [g.igdb_game_id, g.rail_rank]))

  const rows = classified.map((g) => ({
    ...g,
    release_date: g.release_date.toISOString(),
    rail_rank: railRankById.get(g.igdb_game_id) ?? null,
    refreshed_at: new Date().toISOString(),
  }))

  // ── Write ─────────────────────────────────────────────────────────────
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await supabase
      .from('new_notable_pool')
      .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: 'igdb_game_id' })
    if (error) throw new Error(`new_notable_pool upsert failed: ${error.message}`)
  }

  // Prune anything that fell out of the window or no longer clears a lane
  // since the last refresh (a rating count moved, or it aged out). This is
  // also what evicts rows left over from the old lookahead pool: an upcoming
  // game can never be re-upserted, so it is stale by definition.
  const keep = new Set(rows.map((r) => r.igdb_game_id))
  const { data: existing, error: readErr } = await supabase
    .from('new_notable_pool')
    .select('igdb_game_id')
  if (readErr) throw new Error(`new_notable_pool read failed: ${readErr.message}`)

  const stale = (existing ?? [])
    .map((r: any) => Number(r.igdb_game_id))
    .filter((id: number) => !keep.has(id))

  for (let i = 0; i < stale.length; i += UPSERT_CHUNK) {
    const { error } = await supabase
      .from('new_notable_pool')
      .delete()
      .in('igdb_game_id', stale.slice(i, i + UPSERT_CHUNK))
    if (error) throw new Error(`new_notable_pool prune failed: ${error.message}`)
  }

  return {
    window_size: windowGames.length,
    not_yet_released_rejected: notYetReleased,
    classified: rows.length,
    lanes: summarizeLanes(rows),
    rail_size: railPicks.length,
    removed: stale.length,
    igdb_requests: 1 + 3, // count + 3 paged fan-outs (bundled into multiquery internally)
  }
}

// @ts-nocheck
// supabase/functions/new-notable/pool.ts
//
// Candidate pool refresh — the ONLY part of New & Notable that touches
// IGDB. Everything downstream (the rail RPC, the see-all grid) reads purely
// from public.new_notable_pool, which is what keeps Explore free of live
// IGDB calls — same separation as themed-drops/pool.ts.
//
// Window: RELEASED games back to LOOKBACK_DAYS ago, plus UPCOMING games out
// to LOOKAHEAD_DAYS from now. The lookahead half is what makes Lane C
// ("anticipated") possible at all — a not-yet-released game with real hype
// and zero ratings is exactly the case that lane exists for (a major
// upcoming sequel, not just "just launched, too new to be rated").
//
// IGDB budget per full refresh: two /multiquery fan-outs (sorted by
// total_rating_count desc and by hypes desc, then deduped) — mirrors the
// two-sort strategy in scripts/diagnose-new-notable.mjs, which exists
// because a SINGLE sort by total_rating_count desc buries every zero-count,
// high-hype upcoming title in an arbitrary tie order and risks never paging
// far enough to reach them.

import { classifyLane, curateRail, summarizeLanes } from './lanes.ts'
import { hasRecognizedPublisher } from './publishers.ts'

const DAY = 86400
export const LOOKBACK_DAYS = 180
export const LOOKAHEAD_DAYS = 120

const PAGE_SIZE = 500
const MULTIQUERY_MAX_SUBQUERIES = 10
const UPSERT_CHUNK = 500
// IGDB refuses offsets past ~5000, same ceiling themed-drops/pool.ts hits.
// The window's real count runs a few thousand — see MAX_OFFSET note there.
const MAX_OFFSET = 5000

const RAIL_PER_LANE = 8 // -> rail cap of up to 24 (3 lanes x 8)

const GAME_FIELDS = [
  'id',
  'name',
  'cover.image_id',
  'first_release_date',
  'total_rating',
  'total_rating_count',
  'hypes',
  'involved_companies.company.name',
  'involved_companies.publisher',
  'genres.id',
  'genres.name',
].join(', ')

function baseWhere(nowSec) {
  const since = nowSec - LOOKBACK_DAYS * DAY
  const until = nowSec + LOOKAHEAD_DAYS * DAY
  return (
    // game_type 0 = main game. IGDB retired `category`; it still parses but
    // matches zero rows — do not "fix" this back (see themed-drops/pool.ts).
    `first_release_date >= ${since} & first_release_date <= ${until}` +
    ` & cover != null & game_type = 0 & version_parent = null`
  )
}

const idsOf = (arr) =>
  Array.isArray(arr) ? arr.map((x) => (typeof x === 'number' ? x : x?.id)).filter((n) => typeof n === 'number') : []
const namesOf = (arr) =>
  Array.isArray(arr) ? arr.map((x) => (typeof x === 'string' ? x : x?.name)).filter((s) => typeof s === 'string') : []

export interface PoolRefreshResult {
  window_size: number
  classified: number
  lanes: { total: number; aaa: number; indie: number; anticipated: number }
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

  // Two sort orders so a zero-rating-count/high-hype anticipated title can
  // never be lost past the offset cap under a rating_count-only sort.
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

  const [byCount, byHypes] = await Promise.all([
    pageBy('total_rating_count desc', 3000),
    pageBy('hypes desc', 1000),
  ])

  const byId = new Map<number, any>()
  for (const g of [...byCount, ...byHypes]) if (g?.id) byId.set(g.id, g)
  const windowGames = [...byId.values()]
  if (!windowGames.length) throw new Error('New & Notable pool refresh: IGDB returned no rows for the window.')

  // ── Classify into lanes ─────────────────────────────────────────────────
  const classified = []
  for (const g of windowGames) {
    const recognized = hasRecognizedPublisher(g.involved_companies)
    const result = classifyLane(g, recognized)
    if (!result) continue
    classified.push({
      igdb_game_id: g.id,
      name: g.name ?? null,
      cover_image_id: g.cover?.image_id ?? null,
      release_date: g.first_release_date ? new Date(g.first_release_date * 1000) : null,
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
  const forCuration = classified.map((g) => ({
    ...g,
    release_date: g.release_date ? g.release_date.getTime() : 0,
  }))
  const railPicks = curateRail(forCuration, RAIL_PER_LANE)
  const railRankById = new Map(railPicks.map((g) => [g.igdb_game_id, g.rail_rank]))

  const rows = classified.map((g) => ({
    ...g,
    release_date: g.release_date ? g.release_date.toISOString() : null,
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
  // since the last refresh (a rating/hype count moved, or it aged out).
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
    classified: rows.length,
    lanes: summarizeLanes(rows),
    rail_size: railPicks.length,
    removed: stale.length,
    igdb_requests: 1 + 2, // count + 2 pageBy multiquery fan-outs (bundled internally)
  }
}

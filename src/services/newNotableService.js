import { supabase } from './supabase'

/**
 * New & Notable — read layer.
 *
 * ALREADY-RELEASED GAMES ONLY. "New & Notable" means recently released and
 * worth attention; an upcoming title never appears here, however anticipated
 * it is. The gate lives in supabase/functions/new-notable/lanes.ts: a hard
 * release check, then one of two notability lanes (aaa = volume of
 * attention, indie = quality above audience size).
 *
 * NO IGDB ON A READ. The new-notable Edge Function is the only place IGDB is
 * touched — it applies both gates once a day and writes survivors to
 * public.new_notable_pool. This module only ever reads that cache.
 *
 * Two read shapes, matching the two surfaces:
 *   - getNewNotableRail()   the curated ~16-game rail, taste-ordered via the
 *                           get_new_notable() RPC (order only — see the RPC
 *                           for why no lane/genre can be taste-filtered out)
 *   - getNewNotablePage()   the full gated pool, plain chronological pages
 *                           for the see-all grid — no taste reordering, no
 *                           RPC, just a direct table read by release date.
 *
 * Both apply a release guard of their own (the RPC in SQL, the page read
 * below via `release_date <= now`). The pool should never hold a
 * future-dated row; if a refresh ever regressed and wrote one, neither
 * surface would show it.
 */

const COVER_BASE = 'https://images.igdb.com/igdb/image/upload/t_cover_big'

// Mirrors themedDropsService's short in-memory memo: Explore can mount more
// than once per session, and the rail changes at most once a day.
const CACHE_TTL_MS = 5 * 60 * 1000
let railCache = null

function coverUrlFromImageId(imageId) {
  if (!imageId) return null
  return `${COVER_BASE}/${imageId}.jpg`
}

/**
 * Small pill label reflecting WHY a game is here — never a score. Chosen
 * per lane so the client never has to re-derive lane meaning from raw
 * signals; ratings still never appear under a Discover cover.
 *
 * There is no "Hyped" tag any more: hype is no longer a reason a game
 * appears, only a supporting signal for a release too new to be rated.
 */
export function laneTag(lane) {
  if (lane === 'aaa') return 'Popular'
  if (lane === 'indie') return 'Acclaimed'
  return null
}

function shapeRailRow(row) {
  const releaseDate = row.release_date ? new Date(row.release_date) : null
  return {
    id: Number(row.igdb_game_id),
    title: row.title ?? null,
    image: coverUrlFromImageId(row.cover_image_id),
    releaseDate,
    year: releaseDate ? releaseDate.getFullYear() : null,
    lane: row.lane ?? null,
    tag: laneTag(row.lane),
    // Diagnostic, not for display.
    tasteScore: row.taste_score ?? null,
  }
}

function shapePageRow(row) {
  const releaseDate = row.release_date ? new Date(row.release_date) : null
  return {
    id: Number(row.igdb_game_id),
    title: row.name ?? null,
    image: coverUrlFromImageId(row.cover_image_id),
    releaseDate,
    year: releaseDate ? releaseDate.getFullYear() : null,
    lane: row.lane ?? null,
    tag: laneTag(row.lane),
  }
}

/**
 * The curated New & Notable rail: released, two-lane-gated recent games,
 * reordered by the viewer's taste vector (order only).
 *
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<Array<object>>}
 */
export async function getNewNotableRail(options = {}) {
  const { force = false } = options

  if (!force && railCache && Date.now() - railCache.fetchedAt < CACHE_TTL_MS) {
    return railCache.value
  }

  const { data, error } = await supabase.rpc('get_new_notable')

  if (error) {
    console.warn('[newNotable] get_new_notable failed:', error.message)
    return []
  }

  const games = (data?.games || []).map(shapeRailRow)
  railCache = { value: games, fetchedAt: Date.now() }
  return games
}

/** Drop the rail memo — called after a status change if ever needed. */
export function invalidateNewNotableCache() {
  railCache = null
}

/**
 * One page of the full gated pool, newest release first — the see-all
 * behind the New & Notable rail. Same two gates as the rail (row presence in
 * new_notable_pool IS the gate), no taste reordering, no IGDB call.
 *
 * Newest-first by release date is the whole point of this surface: the most
 * recent release sits at the top and history runs downward. The explicit
 * `release_date <= now` filter mirrors the RPC's guard so the grid can never
 * lead with a game that isn't out yet.
 *
 * @param {{ limit?: number, offset?: number }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function getNewNotablePage({ limit = 36, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from('new_notable_pool')
    .select('igdb_game_id, name, cover_image_id, release_date, lane')
    .lte('release_date', new Date().toISOString())
    .order('release_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.warn('[newNotable] getNewNotablePage failed:', error.message)
    return []
  }

  return (data || []).map(shapePageRow)
}

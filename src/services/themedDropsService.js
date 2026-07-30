import { supabase } from './supabase'
import { getAllLists } from './libraryService'

/**
 * Themed Drops — read layer.
 *
 * ONE drop is live at a time, on a fully automatic two-cycle weekly rotation:
 *
 *   Thu 00:00 -> Mon 00:00 UTC   WEEKEND slot, fixed theme
 *   Mon 00:00 -> Thu 00:00 UTC   WEEKDAY slot, rotates through a theme pool
 *
 * NO IGDB ON A READ. Not "rarely" — never. Opening Explore is a single RPC
 * against tables the themed-drops job filled days ago. The whole engine is
 * built around that: the candidate pool is cached, selection runs ahead of
 * time, and which drop is live is derived from the clock rather than from a
 * job having fired. See supabase/functions/themed-drops/ for the writer.
 *
 * THEMES ARE DATA. The names, subtitles and filters below do not exist in this
 * file, or anywhere in src/. They live in public.drop_themes and are composed
 * from the filter library in public.drop_filter_types. Adding a theme is an
 * INSERT — no code here changes.
 *
 * TWO EXCLUSION PASSES, and why there have to be two:
 * The RPC drops anything in the viewer's `game_trackers`, but the library's
 * primary store is localStorage (setGameStatus never writes game_trackers), so
 * the server literally cannot see most of a user's library. This module runs
 * the second pass locally — the same split gamingMapService.js lives with.
 * That is also why a drop selects more games than a shelf shows: every viewer
 * loses a different subset.
 */

const COVER_BASE = 'https://images.igdb.com/igdb/image/upload/t_cover_big'

// Reads are cheap but Explore can mount several times in a session; a short
// in-memory cache keeps a tab change from re-querying. Deliberately NOT
// persisted: the drop expires at a known instant and a stale localStorage copy
// would outlive it.
const CACHE_TTL_MS = 5 * 60 * 1000
let cache = null

function coverUrlFromImageId(imageId) {
  if (!imageId) return null
  return `${COVER_BASE}/${imageId}.jpg`
}

/**
 * IGDB stores completion time in seconds. Round to a readable hour figure —
 * under 10 hours keep one decimal, since 2.5h vs 3h is a real difference when
 * the whole point of the theme is how long the game takes.
 */
function formatHours(seconds) {
  if (!seconds || seconds <= 0) return null
  const hours = seconds / 3600
  if (hours < 10) return Math.round(hours * 10) / 10
  return Math.round(hours)
}

function shapeGame(row) {
  return {
    id: Number(row.igdb_game_id),
    igdbId: Number(row.igdb_game_id),
    title: row.title ?? null,
    image: coverUrlFromImageId(row.cover_image_id),
    coverImageId: row.cover_image_id ?? null,
    rating: row.total_rating ?? null,
    ratingCount: row.total_rating_count ?? null,
    releaseYear: row.release_year ?? null,
    genres: Array.isArray(row.genre_names) ? row.genre_names : [],
    themes: Array.isArray(row.theme_names) ? row.theme_names : [],
    timeToBeatSeconds: row.time_to_beat_seconds ?? null,
    timeToBeatHours: formatHours(row.time_to_beat_seconds),
    // Diagnostic, not for display: lets QA confirm the balance lean is doing
    // something without re-deriving it.
    selectionScore: row.selection_score ?? null,
    tasteScore: row.taste_score ?? null,
  }
}

/** Every IGDB id the user already has in a local list, in any status. */
function locallyTrackedIds() {
  try {
    const lists = getAllLists() || {}
    const ids = new Set()
    for (const games of Object.values(lists)) {
      if (!Array.isArray(games)) continue
      for (const g of games) {
        const id = Number(g?.id ?? g?.igdbId ?? g?.igdb_game_id)
        if (id) ids.add(id)
      }
    }
    return ids
  } catch {
    // A malformed localStorage library must not take the drop down with it —
    // the server-side exclusion still applies.
    return new Set()
  }
}

/**
 * The live themed drop: theme, cached games, and the expiry the UI counts
 * down to.
 *
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{
 *   active: boolean,
 *   theme: { slug: string, displayName: string, subtitle: string|null }|null,
 *   slot: 'weekend'|'weekday'|null,
 *   games: Array<object>,
 *   startsAt: Date|null,
 *   expiresAt: Date|null,
 *   msRemaining: number|null,
 *   reason?: string
 * }>}
 */
export async function getActiveThemedDrop(options = {}) {
  const { force = false } = options

  if (!force && cache && Date.now() < cache.expiresAtMs && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.value
  }

  const { data, error } = await supabase.rpc('get_active_themed_drop')

  if (error) {
    console.warn('[themedDrops] get_active_themed_drop failed:', error.message)
    return emptyDrop('rpc_error')
  }
  if (!data || !data.theme) {
    return emptyDrop(data?.reason || 'no_active_drop')
  }

  const localIds = locallyTrackedIds()
  const games = (data.games || [])
    .map(shapeGame)
    .filter((g) => !localIds.has(g.id))

  const startsAt = data.starts_at ? new Date(data.starts_at) : null
  const expiresAt = data.expires_at ? new Date(data.expires_at) : null

  const value = {
    active: Boolean(data.active),
    scheduleId: data.schedule_id ?? null,
    slot: data.slot ?? null,
    theme: {
      slug: data.theme.slug,
      displayName: data.theme.display_name,
      subtitle: data.theme.subtitle ?? null,
    },
    games,
    startsAt,
    expiresAt,
    msRemaining: expiresAt ? Math.max(0, expiresAt.getTime() - Date.now()) : null,
  }

  cache = {
    value,
    fetchedAt: Date.now(),
    // Never serve a cached drop past its own expiry, however short the TTL is.
    expiresAtMs: expiresAt ? expiresAt.getTime() : Date.now() + CACHE_TTL_MS,
  }

  return value
}

function emptyDrop(reason) {
  return {
    active: false,
    scheduleId: null,
    slot: null,
    theme: null,
    games: [],
    startsAt: null,
    expiresAt: null,
    msRemaining: null,
    reason,
  }
}

/** Drop the memo — call after a status change so an added game disappears. */
export function invalidateThemedDropCache() {
  cache = null
}

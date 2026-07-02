import { supabase } from './supabase'
import { getLibrary, initializeLibrary } from './libraryService'
import { getAllReviews } from './reviewService'

/**
 * Stats Service — aggregates data for the /stats screen.
 *
 * Local data (lists, progress) lives in localStorage and is read
 * synchronously. Activity-derived data (streak, heatmap) lives in
 * Supabase and is fetched on demand.
 *
 * The local-side helpers mirror profileStatsService but are scoped to
 * the richer "year in games" view: only Played games count toward
 * total hours and the genre breakdown, since the spec frames Stats as
 * a retrospective on completed work, not a backlog summary.
 */

const PROGRESS_STORAGE_KEY = 'gameProgress'

function getAllProgress() {
  const stored = localStorage.getItem(PROGRESS_STORAGE_KEY)
  return stored ? JSON.parse(stored) : {}
}

function getListGames(library, listId) {
  return library?.lists?.[listId]?.games || []
}

/**
 * Snapshot of every Stats number we derive from local-only state.
 * Synchronous; safe to call in a render path.
 *
 * Shape:
 *   {
 *     playedCount, playingCount, hoursPlayed (Played only),
 *     reviewCount,
 *     hoursByGenre: { [genre]: hours },
 *     topByHours:   Array<{ id, title, image, hours }>
 *   }
 */
export function getStatsLocalSync() {
  const library = getLibrary() || initializeLibrary()
  const progress = getAllProgress()
  const reviews = getAllReviews()

  const playedGames = getListGames(library, 'played')
  const playingGames = getListGames(library, 'currently-playing')

  // Hours played — sum hours_played ONLY for Played games. Hours on
  // currently-playing games are real but conceptually belong to the
  // "in progress" tile, not the "lifetime hours" tile.
  let hoursPlayed = 0
  for (const g of playedGames) {
    const p = progress[String(g.id)]
    if (p && p.hoursPlayed != null) {
      hoursPlayed += parseFloat(p.hoursPlayed) || 0
    }
  }

  // Hours by genre — split each game's hours evenly across its genres
  // so a game tagged "Action, RPG" with 30 h contributes 15 h to each.
  // Untagged games fall into the "Other" bucket.
  const hoursByGenre = {}
  for (const g of playedGames) {
    const p = progress[String(g.id)]
    const hrs = p && p.hoursPlayed != null ? parseFloat(p.hoursPlayed) || 0 : 0
    if (hrs <= 0) continue

    const genres = Array.isArray(g.genres) && g.genres.length > 0
      ? g.genres.filter(Boolean)
      : (typeof g.genre === 'string' && g.genre
          ? g.genre.split(',').map((s) => s.trim()).filter(Boolean)
          : [])

    if (genres.length === 0) {
      hoursByGenre['Other'] = (hoursByGenre['Other'] || 0) + hrs
      continue
    }
    const share = hrs / genres.length
    for (const genre of genres) {
      hoursByGenre[genre] = (hoursByGenre[genre] || 0) + share
    }
  }

  // Top by hours — every tracked game (any status) with hours > 0,
  // descending. The bar chart caps to 10 in the UI; we hand back up to
  // 20 so consumers can show more if they want.
  const allTracked = [...playedGames, ...playingGames]
  const seen = new Set()
  const enriched = []
  for (const g of allTracked) {
    const key = String(g.id)
    if (seen.has(key)) continue
    seen.add(key)
    const p = progress[key]
    const hrs = p && p.hoursPlayed != null ? parseFloat(p.hoursPlayed) || 0 : 0
    if (hrs <= 0) continue
    enriched.push({
      id: g.id,
      title: g.title || 'Untitled',
      image: g.image || g.imageHD || null,
      hours: Math.round(hrs * 10) / 10,
    })
  }
  const topByHours = enriched
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 20)

  return {
    playedCount: playedGames.length,
    playingCount: playingGames.length,
    hoursPlayed: Math.round(hoursPlayed),
    reviewCount: reviews.length,
    hoursByGenre,
    topByHours,
  }
}

/**
 * Fetch every activity created_at for `userId` in the last `daysBack`
 * days (default 400 — covers the heatmap window plus a buffer for
 * computing the longest streak that might extend before YTD).
 *
 * Returns a Map<'YYYY-MM-DD', count> keyed by local-time day. We use
 * local time deliberately: the heatmap is a personal calendar, and a
 * user logging from PT shouldn't see Sunday's session showing up on
 * Monday because UTC rolled over.
 *
 * Performance note: per the Stats spec the heatmap aggregation should
 * happen in a single SQL `GROUP BY date(created_at)` query rather than
 * grouped in JS. The recommended Postgres function is:
 *
 *   create or replace function activity_buckets(uid uuid, since timestamptz)
 *   returns table (day date, count int) language sql stable as $$
 *     select date(created_at at time zone 'UTC'), count(*)::int
 *     from activities
 *     where user_id = uid and created_at >= since
 *     group by 1
 *     order by 1;
 *   $$;
 *
 * If `supabase.rpc('activity_buckets', ...)` succeeds we use it; if
 * the RPC isn't deployed yet we fall back to the client-side group-by
 * so the page keeps working. At ≤500 rows/year the JS pass is < 1 ms,
 * so the fallback isn't a real perf problem — it just trades a single
 * indexed aggregate query for a slightly fatter network payload.
 *
 * @param {string} userId
 * @param {number} [daysBack=400]
 * @returns {Promise<Map<string, number>>}
 */
export async function fetchActivityCalendar(userId, daysBack = 400) {
  if (!userId) return new Map()

  const since = new Date()
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - daysBack)
  const sinceIso = since.toISOString()

  // Preferred path — a single GROUP BY in Postgres.
  try {
    const { data, error } = await supabase.rpc('activity_buckets', {
      uid: userId,
      since: sinceIso,
    })
    if (!error && Array.isArray(data)) {
      const counts = new Map()
      for (const row of data) {
        if (!row?.day) continue
        // The RPC keys days in UTC; re-key into local time so the
        // heatmap matches the user's calendar instead of UTC's.
        const localKey = toLocalDateKey(new Date(`${row.day}T00:00:00Z`))
        counts.set(localKey, (counts.get(localKey) || 0) + (row.count || 0))
      }
      return counts
    }
  } catch (rpcErr) {
    // RPC not deployed yet — fall through to client-side group-by.
    if (rpcErr?.message) {
      console.debug('[stats] activity_buckets RPC unavailable, falling back:', rpcErr.message)
    }
  }

  const { data, error } = await supabase
    .from('activities')
    .select('created_at')
    .eq('user_id', userId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[stats] fetchActivityCalendar failed:', error.message)
    return new Map()
  }

  const counts = new Map()
  for (const row of data || []) {
    const key = toLocalDateKey(new Date(row.created_at))
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

/* ============================================================
   In-memory cache for the activity calendar.

   Stats numbers don't change moment-to-moment. The page can be
   opened several times in a session (Profile tile → Stats → back
   → another tile → Stats); without a cache that's an extra
   round-trip every visit, which is wasteful for a 400-row read.

   TTL: 5 minutes per spec. Cache is keyed by (userId, daysBack)
   and is invalidated explicitly by `invalidateActivityCache()`,
   which the Stats page wires to `activityUpdated`/`reviewAdded`/
   `libraryUpdated` window events so a fresh status change shows
   up immediately on the heatmap rather than waiting for TTL.
   ============================================================ */

const CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000
const calendarCache = new Map() // key -> { value: Map, expiresAt: number, promise?: Promise }

function calendarCacheKey(userId, daysBack) {
  return `${userId}::${daysBack}`
}

/**
 * Cached wrapper around fetchActivityCalendar. Returns the same
 * Map<'YYYY-MM-DD', number> shape but reuses the result for up to
 * 5 minutes. Concurrent callers share a single in-flight promise
 * so back-to-back navigations don't trigger duplicate fetches.
 */
export async function getCachedActivityCalendar(userId, daysBack = 400) {
  if (!userId) return new Map()

  const key = calendarCacheKey(userId, daysBack)
  const now = Date.now()
  const hit = calendarCache.get(key)

  if (hit) {
    if (hit.value && hit.expiresAt > now) {
      return hit.value
    }
    if (hit.promise) {
      return hit.promise
    }
  }

  const promise = fetchActivityCalendar(userId, daysBack)
    .then((value) => {
      calendarCache.set(key, {
        value,
        expiresAt: Date.now() + CALENDAR_CACHE_TTL_MS,
      })
      return value
    })
    .catch((err) => {
      calendarCache.delete(key)
      throw err
    })

  calendarCache.set(key, { promise, expiresAt: 0 })
  return promise
}

/**
 * Drop every cached activity calendar entry. Called when an event
 * fires that should change the heatmap (status change, review,
 * list edit) so the next render sees fresh numbers.
 */
export function invalidateActivityCache() {
  calendarCache.clear()
}

/**
 * Compute current and longest streaks from a Map<'YYYY-MM-DD', count>.
 *
 * "Current streak" walks backward from today; if today has no activity
 * it falls back to walking from yesterday so the streak doesn't break
 * mid-day. (Many tracker apps use this nuance — Strava, GitHub, Duolingo —
 * because resetting at midnight UTC is hostile to global users.)
 *
 * "Longest streak" scans the entire date set for the longest unbroken run.
 *
 * @param {Map<string, number>} dateCounts
 * @returns {{ current: number, longest: number }}
 */
export function computeStreaks(dateCounts) {
  if (!dateCounts || dateCounts.size === 0) {
    return { current: 0, longest: 0 }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  // Current streak — start from today (or yesterday if today is blank
  // and yesterday is hot) and walk backward day-by-day.
  let cursor = new Date(today)
  if (!dateCounts.has(toLocalDateKey(cursor))) {
    if (dateCounts.has(toLocalDateKey(yesterday))) {
      cursor = yesterday
    } else {
      cursor = null
    }
  }
  let current = 0
  while (cursor && dateCounts.has(toLocalDateKey(cursor))) {
    current += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  // Longest streak — sort the unique dates ascending and run a linear
  // sweep counting consecutive-day chains.
  const sortedKeys = [...dateCounts.keys()].sort()
  let longest = 0
  let run = 0
  let prev = null
  for (const key of sortedKeys) {
    const day = parseLocalDateKey(key)
    if (prev && (day.getTime() - prev.getTime()) === 86400000) {
      run += 1
    } else {
      run = 1
    }
    if (run > longest) longest = run
    prev = day
  }

  return { current, longest: Math.max(longest, current) }
}

/**
 * Build the 53×7 heatmap grid for the year-to-date heatmap.
 *
 * The grid is a flat Array<{ date: 'YYYY-MM-DD', count: number,
 * inFuture: boolean }> ordered week-major, day-of-week-minor. The first
 * column starts with the Sunday on or before (today - 52 weeks) so the
 * graph reads left-to-right oldest-to-newest, just like GitHub's.
 *
 * Cells AFTER today are flagged `inFuture: true` so the UI can blank
 * them out instead of rendering them as zero-activity days.
 *
 * @param {Map<string, number>} dateCounts
 * @returns {Array<{ date: string, count: number, inFuture: boolean }>}
 */
export function buildHeatmapGrid(dateCounts) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Find the Sunday that anchors column 0. We want exactly 53 columns,
  // ending with the column that contains today.
  const lastSunday = new Date(today)
  lastSunday.setDate(today.getDate() - today.getDay())
  const start = new Date(lastSunday)
  start.setDate(start.getDate() - 52 * 7)

  const cells = []
  const cursor = new Date(start)
  for (let week = 0; week < 53; week++) {
    for (let day = 0; day < 7; day++) {
      const key = toLocalDateKey(cursor)
      const inFuture = cursor.getTime() > today.getTime()
      cells.push({
        date: key,
        count: dateCounts.get(key) || 0,
        inFuture,
      })
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  return cells
}

/**
 * Map an activity count to a 0–4 intensity step for heatmap coloring.
 * Per spec:
 *   0      → surface gray   (level 0)
 *   1–2    → light amber    (level 1)
 *   3–5    → mid amber      (level 2)
 *   6+     → full amber     (level 3)
 * We surface 4 levels (with an optional level 4 reserved) so the CSS
 * scale has headroom for a future "extreme" tier.
 */
export function activityIntensity(count) {
  if (!count || count <= 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  return 3
}

/* ============================================================
   Date helpers — local-time, ISO-style key strings.
   ============================================================ */

export function toLocalDateKey(d) {
  const yr = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${yr}-${mo}-${da}`
}

export function parseLocalDateKey(key) {
  const [y, m, d] = key.split('-').map((s) => parseInt(s, 10))
  return new Date(y, m - 1, d)
}

/**
 * Total tracked-games count for ANY user, sourced from `game_trackers`
 * (RLS: publicly readable — see trackers_select_all). Used for the
 * "games" stat numeral on visitor profiles, where the local-device-only
 * `getStatsLocalSync`/`getProfileStats` counters aren't reachable (those
 * only reflect the signed-in device's own localStorage library).
 *
 * Own profile continues to use the localStorage-derived count so
 * behaviour there is unchanged — this is strictly additive for visitors.
 *
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function getTrackedGamesCountForUser(userId) {
  if (!userId) return 0
  const { count, error } = await supabase
    .from('game_trackers')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (error) {
    console.error('[stats] getTrackedGamesCountForUser failed:', error.message)
    return 0
  }
  return count || 0
}

/**
 * Fetch current streaks for users that `userId` follows, using the
 * `get_circle_streaks` Postgres function.
 *
 * Only users with `streak_share_opt_in = true` (default) are included.
 * Only followers who have an active streak (≥ 1) are returned, sorted
 * highest-streak first.
 *
 * @param {string} userId  The viewer's auth UUID.
 * @returns {Promise<Array<{ user_id: string, username: string, avatar_url: string, current_streak: number }>>}
 */
export async function getCircleStreaks(userId) {
  if (!userId) return []
  try {
    const { data, error } = await supabase.rpc('get_circle_streaks', {
      viewer_id: userId,
    })
    if (error) {
      console.error('[stats] getCircleStreaks failed:', error.message)
      return []
    }
    return data ?? []
  } catch (err) {
    console.error('[stats] getCircleStreaks crashed:', err)
    return []
  }
}

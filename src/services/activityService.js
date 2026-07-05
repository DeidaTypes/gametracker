import { supabase } from './supabase'
import { applyBlockFilter, isMutuallyBlocked, loadBlockedIds } from './blockService'
import { updateStreak } from './streakMilestoneService'
import { dispatchStreakUpdated } from '../components/MilestoneCelebration'

/**
 * Activity Service — Supabase-backed activity feed.
 *
 * Activity events are written automatically by the mutation services
 * (libraryService, reviewService, listService) AFTER their primary write
 * succeeds. They are NEVER awaited inline with the primary mutation, and
 * a failure to log an activity NEVER rolls back the primary write — see
 * the try/catch inside `logActivity` below.
 *
 * Schema (matches BACKEND_SCHEMA.md, mirrored here for reference):
 *
 *   create type activity_type as enum (
 *     'status_changed',
 *     'review_posted',
 *     'list_created',
 *     'game_added_to_list'
 *   );
 *
 *   create table activities (
 *     id            uuid primary key default gen_random_uuid(),
 *     user_id       uuid not null references users(id) on delete cascade,
 *     activity_type activity_type not null,
 *     igdb_game_id  bigint,
 *     target_id     uuid,                       -- review id OR list id (polymorphic)
 *     metadata      jsonb not null default '{}'::jsonb,
 *     created_at    timestamptz not null default now()
 *   );
 *
 *   -- Required for fast Profile → Activity tab queries:
 *   create index if not exists idx_activities_user_created
 *     on activities (user_id, created_at desc);
 *
 *   -- RLS:
 *   --   read:   anyone authenticated (cross-user feeds may be added later)
 *   --   write:  user_id = auth.uid()
 *
 * The `target_id` column is intentionally polymorphic (no FK) — it points
 * at either a review or a list depending on `activity_type`. We resolve
 * it client-side via two batched lookups in `getActivitiesForUser` so the
 * timeline never makes N+1 queries.
 */

const TABLE = 'activities'

/* ============================================================
   Activity types — must match the Postgres enum values exactly.
   ============================================================ */

export const ACTIVITY_TYPES = Object.freeze({
  STATUS_CHANGED: 'status_changed',
  REVIEW_POSTED: 'review_posted',
  LIST_CREATED: 'list_created',
  GAME_ADDED_TO_LIST: 'game_added_to_list',
  SESSION_LOGGED: 'session_logged',
  JOURNAL_WRITTEN: 'journal_written',
})

/* ============================================================
   logActivity
   ============================================================ */

/**
 * INSERT a single activity row for the currently-signed-in user.
 *
 * IMPORTANT: this function NEVER throws. All errors are swallowed and
 * logged to the console so that an activity-log failure can never roll
 * back the primary mutation that triggered it. Callers should fire-and-
 * forget (no await) when the surrounding logic is synchronous.
 *
 * @param {{
 *   activityType: 'status_changed'|'review_posted'|'list_created'|'game_added_to_list',
 *   igdbGameId?: number|string|null,
 *   targetId?: string|null,                      // review id or list id
 *   metadata?: Record<string, any>,
 * }} args
 * @returns {Promise<object|null>}                inserted row, or null on failure
 */
export async function logActivity({
  activityType,
  igdbGameId = null,
  targetId = null,
  metadata = {},
} = {}) {
  try {
    if (!activityType) {
      console.warn('[activity] logActivity called without activityType')
      return null
    }

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser()
    if (userErr || !user) {
      // Not signed in — silently skip. The local-storage-only tracker
      // can still mutate without an auth session; we just don't have a
      // user_id to attribute the activity to.
      return null
    }

    const insert = {
      user_id: user.id,
      activity_type: activityType,
      igdb_game_id: igdbGameId != null ? Number(igdbGameId) : null,
      target_id: targetId || null,
      metadata: metadata || {},
    }

    const { data, error } = await supabase
      .from(TABLE)
      .insert(insert)
      .select('*')
      .single()
    if (error) {
      console.error('[activity] logActivity insert failed:', error.message)
      return null
    }

    try {
      window.dispatchEvent(new Event('activityUpdated'))
    } catch {
      // SSR / no-window — best effort
    }

    // Update the streak for every logged activity. Fire-and-forget so a
    // streak failure never blocks the primary activity write. Dispatches
    // 'streakUpdated' so MilestoneCelebration can check thresholds.
    updateStreak(user.id)
      .then((row) => { if (row) dispatchStreakUpdated(row.current_streak) })
      .catch(() => {})

    return data
  } catch (err) {
    console.error('[activity] logActivity crashed:', err)
    return null
  }
}

/* ============================================================
   getActivitiesForUser
   ============================================================ */

/**
 * Fetch a page of activities for a user, enriched with the JOINed list
 * name (for list_created / game_added_to_list) and review rating + game
 * title (for review_posted).
 *
 * The "JOIN" is implemented as 1 + 2 batched queries (one for activities,
 * one IN-list for lists, one IN-list for reviews). This is O(1) round-
 * trips regardless of page size — NOT N+1.
 *
 * @param {string} userId
 * @param {{ limit?: number, offset?: number }} opts
 * @returns {Promise<Array<{
 *   id: string,
 *   activityType: string,
 *   igdbGameId: number|null,
 *   targetId: string|null,
 *   metadata: Record<string, any>,
 *   createdAt: string,
 *   listName: string|null,
 *   reviewRating: number|null,
 *   reviewGameTitle: string|null,
 *   gameTitle: string|null,
 * }>>}
 */
export async function getActivitiesForUser(userId, { limit = 50, offset = 0 } = {}) {
  if (!userId) return []

  // Sprint 7 — short-circuit if the requested user is blocked in
  // either direction. The activities table feed for one user is a
  // self-contained slice (only their own rows), so the block check
  // is at the user level rather than per-row.
  await loadBlockedIds()
  if (isMutuallyBlocked(userId)) return []

  let query = supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  // Defence-in-depth: applyBlockFilter is a no-op when only one user
  // is in scope and they aren't blocked, so this is essentially a
  // future-proof guard for any cross-user feed code that might land
  // here later.
  query = await applyBlockFilter(query, 'user_id')
  const { data: rows, error } = await query
  if (error) {
    console.error('[activity] getActivitiesForUser failed:', error.message)
    return []
  }
  if (!rows || rows.length === 0) return []

  // Collect target_ids by type for the two batched lookups.
  const listTargetIds = new Set()
  const reviewTargetIds = new Set()
  for (const r of rows) {
    if (!r.target_id) continue
    if (r.activity_type === 'list_created' || r.activity_type === 'game_added_to_list') {
      listTargetIds.add(r.target_id)
    } else if (r.activity_type === 'review_posted') {
      reviewTargetIds.add(r.target_id)
    }
  }

  // Run both secondary lookups in parallel — they are independent and were
  // previously sequential (a waterfall that doubled the round-trip time on
  // profiles with both list and review activity).
  const [listResult, reviewResult] = await Promise.all([
    listTargetIds.size > 0
      ? supabase.from('lists').select('id, name').in('id', [...listTargetIds])
      : Promise.resolve({ data: [], error: null }),
    reviewTargetIds.size > 0
      ? supabase.from('reviews').select('id, rating, game_title, igdb_game_id').in('id', [...reviewTargetIds])
      : Promise.resolve({ data: [], error: null }),
  ])

  const listMap = new Map()
  if (listResult.error) {
    console.error('[activity] list-name lookup failed:', listResult.error.message)
  } else {
    for (const l of listResult.data || []) listMap.set(l.id, l)
  }

  const reviewMap = new Map()
  if (reviewResult.error) {
    console.error('[activity] review-rating lookup failed:', reviewResult.error.message)
  } else {
    for (const r of reviewResult.data || []) reviewMap.set(r.id, r)
  }

  return rows.map((r) => {
    const meta = r.metadata || {}
    const listRow = r.target_id ? listMap.get(r.target_id) : null
    const reviewRow = r.target_id ? reviewMap.get(r.target_id) : null
    return {
      id: r.id,
      activityType: r.activity_type,
      igdbGameId: r.igdb_game_id != null ? Number(r.igdb_game_id) : null,
      targetId: r.target_id || null,
      metadata: meta,
      createdAt: r.created_at,
      listName: listRow?.name || null,
      reviewRating: reviewRow?.rating != null ? Number(reviewRow.rating) : null,
      reviewGameTitle: reviewRow?.game_title || null,
      // game_title is denormalised into metadata at write-time so the
      // timeline can render the sentence without round-tripping IGDB.
      gameTitle: meta.game_title || reviewRow?.game_title || null,
    }
  })
}

/* ============================================================
   Sentence formatting
   ============================================================ */

const STATUS_DISPLAY = {
  want: 'Want to Play',
  currently: 'Playing',
  played: 'Played',
  dropped: 'Dropped',
}

function statusDisplay(value) {
  if (!value) return ''
  return STATUS_DISPLAY[value] || value
}

/**
 * Build the human-readable sentence for an activity row, per spec.
 *
 * status_changed:        "Marked Persona 5 Royal as Played"
 *                        (or "Dropped Persona 5 Royal" when to_status === 'dropped')
 * review_posted:         "Reviewed XCOM 2 (4 stars)"
 * list_created:          "Created the list 'JRPG's'"
 * game_added_to_list:    "Added Persona 5 Royal to 'JRPG's'"
 */
export function formatActivityMessage(activity) {
  if (!activity) return ''
  const meta = activity.metadata || {}
  const gameTitle = activity.gameTitle || meta.game_title || 'a game'

  switch (activity.activityType) {
    case 'status_changed': {
      const to = meta.to_status
      if (to === 'dropped') return `Dropped ${gameTitle}`
      return `Marked ${gameTitle} as ${statusDisplay(to)}`
    }
    case 'review_posted': {
      const rating = activity.reviewRating
      const title = activity.reviewGameTitle || gameTitle
      if (rating == null) return `Reviewed ${title}`
      const rounded = Number.isInteger(rating) ? rating : Number(rating).toFixed(1)
      return `Reviewed ${title} (${rounded} ${rating === 1 ? 'star' : 'stars'})`
    }
    case 'list_created':
      return `Created the list '${activity.listName || 'Untitled list'}'`
    case 'game_added_to_list':
      return `Added ${gameTitle} to '${activity.listName || 'a list'}'`
    case 'session_logged': {
      const addedHrs = activity.metadata?.added_hours
      if (addedHrs != null && addedHrs >= 1 / 60) {
        const totalMins = Math.round(addedHrs * 60)
        const h = Math.floor(totalMins / 60)
        const m = totalMins % 60
        const timeStr = h > 0 && m > 0 ? `${h}h ${m}m` : h > 0 ? `${h}h` : `${m}m`
        return `Played ${gameTitle} for ${timeStr}`
      }
      return `Played ${gameTitle}`
    }
    case 'journal_written':
      return `Wrote a journal entry for ${gameTitle}`
    default:
      return `Activity on ${gameTitle}`
  }
}

/**
 * Fetch all activities for `userId` that fall on the given local-calendar
 * day (`dateKey` = 'YYYY-MM-DD'), enriched with list/review metadata the
 * same way `getActivitiesForUser` is.
 *
 * @param {string} userId
 * @param {string} dateKey  'YYYY-MM-DD'
 * @returns {Promise<Array>}  same shape as getActivitiesForUser rows
 */
export async function fetchActivitiesForDay(userId, dateKey) {
  if (!userId || !dateKey) return []

  const [y, mo, da] = dateKey.split('-').map(Number)
  const dayStart = new Date(y, mo - 1, da)
  const dayEnd   = new Date(y, mo - 1, da + 1)

  const { data: rows, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', dayStart.toISOString())
    .lt('created_at', dayEnd.toISOString())
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[activity] fetchActivitiesForDay failed:', error.message)
    return []
  }
  if (!rows || rows.length === 0) return []

  // Enrich with list / review details (same 2-pass batched lookup).
  const listTargetIds  = new Set()
  const reviewTargetIds = new Set()
  for (const r of rows) {
    if (!r.target_id) continue
    if (r.activity_type === 'list_created' || r.activity_type === 'game_added_to_list') {
      listTargetIds.add(r.target_id)
    } else if (r.activity_type === 'review_posted') {
      reviewTargetIds.add(r.target_id)
    }
  }

  // list_games ids to resolve cover art for 'game_added_to_list' rows —
  // metadata only denormalises game_title at write time, not the image,
  // so a real (cheap, own-list) lookup is needed rather than fabricating
  // a cover. Reviews already carry game_image on the row itself.
  const listGameLookups = rows
    .filter((r) => r.activity_type === 'game_added_to_list' && r.target_id && r.igdb_game_id != null)
    .map((r) => ({ listId: r.target_id, igdbGameId: Number(r.igdb_game_id) }))

  const [listResult, reviewResult, listGameResult] = await Promise.all([
    listTargetIds.size > 0
      ? supabase.from('lists').select('id, name').in('id', [...listTargetIds])
      : Promise.resolve({ data: [], error: null }),
    reviewTargetIds.size > 0
      ? supabase.from('reviews').select('id, rating, game_title, game_image, igdb_game_id').in('id', [...reviewTargetIds])
      : Promise.resolve({ data: [], error: null }),
    listGameLookups.length > 0
      ? supabase
          .from('list_games')
          .select('list_id, igdb_game_id, game_image')
          .in('list_id', [...new Set(listGameLookups.map((l) => l.listId))])
      : Promise.resolve({ data: [], error: null }),
  ])

  const listMap   = new Map((listResult.data   || []).map((l) => [l.id, l]))
  const reviewMap = new Map((reviewResult.data || []).map((r) => [r.id, r]))
  const listGameImageMap = new Map()
  for (const lg of listGameResult.data || []) {
    if (!lg.game_image) continue
    listGameImageMap.set(`${lg.list_id}::${lg.igdb_game_id}`, lg.game_image)
  }

  return rows.map((r) => {
    const meta      = r.metadata || {}
    const listRow   = r.target_id ? listMap.get(r.target_id)   : null
    const reviewRow = r.target_id ? reviewMap.get(r.target_id) : null
    const listGameImage =
      r.activity_type === 'game_added_to_list' && r.target_id && r.igdb_game_id != null
        ? listGameImageMap.get(`${r.target_id}::${Number(r.igdb_game_id)}`)
        : null
    return {
      id:               r.id,
      activityType:     r.activity_type,
      igdbGameId:       r.igdb_game_id != null ? Number(r.igdb_game_id) : null,
      targetId:         r.target_id || null,
      metadata:         meta,
      createdAt:        r.created_at,
      listName:         listRow?.name || null,
      reviewRating:     reviewRow?.rating != null ? Number(reviewRow.rating) : null,
      reviewGameTitle:  reviewRow?.game_title || null,
      gameTitle:        meta.game_title || reviewRow?.game_title || null,
      gameImage:        meta.game_image || reviewRow?.game_image || listGameImage || null,
    }
  })
}

/**
 * Suggested route for tapping an activity row. Reviews and status
 * changes go to the relevant Game Detail page; list events go to the
 * list page.
 */
export function getActivityHref(activity) {
  if (!activity) return null
  switch (activity.activityType) {
    case 'status_changed':
      return activity.igdbGameId ? `/game/${activity.igdbGameId}` : null
    case 'review_posted':
      if (!activity.igdbGameId) return null
      return activity.targetId
        ? `/game/${activity.igdbGameId}?review=${encodeURIComponent(activity.targetId)}`
        : `/game/${activity.igdbGameId}`
    case 'list_created':
      return activity.targetId ? `/list/${activity.targetId}` : null
    case 'game_added_to_list':
      // Game side is more interesting than list side for "added X to Y",
      // since the list is named in the sentence already.
      if (activity.igdbGameId) return `/game/${activity.igdbGameId}`
      return activity.targetId ? `/list/${activity.targetId}` : null
    case 'session_logged':
      return activity.igdbGameId ? `/game/${activity.igdbGameId}` : null
    case 'journal_written':
      return activity.igdbGameId ? `/game/${activity.igdbGameId}` : null
    default:
      return null
  }
}

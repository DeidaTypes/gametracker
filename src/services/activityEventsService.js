import { supabase } from './supabase'
import { applyBlockFilter } from './blockService'

/**
 * Activity Events Service — Pulse foundation.
 *
 * Source of truth for the new `activity_events` table (see
 * supabase/activity_events.sql for schema + RLS). Every existing
 * mutation service (libraryService, reviewService, sessionService,
 * listService, userService, streakMilestoneService) writes a single
 * event via `logActivityEvent` AFTER its primary write succeeds.
 *
 * Why a new table rather than reusing `activities`?
 *   - The legacy `activities` table predates the follow graph and
 *     ships with a smaller enum (status_changed, review_posted,
 *     list_created, game_added_to_list, session_logged,
 *     journal_written). It has no privacy column on its RLS and is
 *     read by Profile / streak features that depend on the existing
 *     shape — we don't want to break those.
 *   - The Pulse spec calls for a uniform event type enum
 *     (played, rated, reviewed, favorited, listed, started,
 *     completed, dropped, goal_hit) and RLS that honors the
 *     `activity_privacy` setting on `users`.
 *   - Keeping the two tables side by side means we can deprecate
 *     `activities` later without a flag-day migration.
 *
 * Contract for every `log*` call site:
 *   - Fire-and-forget (no await unless the caller actually needs the
 *     returned row). Failures NEVER roll back the primary mutation.
 *   - Single event per user-visible action. `postReview` writes one
 *     'reviewed' event with the rating in metadata, not separate
 *     'reviewed' + 'rated' rows. The 'rated' enum value is reserved
 *     for a future rating-without-review feature.
 */

const TABLE = 'activity_events'

/**
 * Canonical event types. Must match the Postgres `activity_event_type`
 * enum exactly. Code referencing event types should always go through
 * this object so a future enum rename surfaces as a static error rather
 * than a silent runtime no-op.
 */
export const ACTIVITY_EVENT_TYPES = Object.freeze({
  PLAYED: 'played',
  RATED: 'rated',
  REVIEWED: 'reviewed',
  FAVORITED: 'favorited',
  LISTED: 'listed',
  STARTED: 'started',
  COMPLETED: 'completed',
  DROPPED: 'dropped',
  GOAL_HIT: 'goal_hit',
  // Home-feed-hub sprint: "added to backlog" is Pulse-worthy for the
  // viewer's own Home feed even though it stays excluded from
  // Explore/Collections (see libraryService.STATUS_TO_EVENT_TYPE and
  // supabase/migrations/20260704222000_activity_events_backlogged_type.sql,
  // which adds this literal to the Postgres enum).
  BACKLOGGED: 'backlogged',
})

const VALID_TYPES = new Set(Object.values(ACTIVITY_EVENT_TYPES))

/**
 * Window event broadcast right after a local write so the
 * useCircleActivity hook can optimistically reflect the actor's own
 * event without waiting for the realtime echo. Only the actor's own
 * events are surfaced this way; cross-actor events arrive via the
 * realtime postgres_changes subscription.
 */
export const ACTIVITY_EVENT_LOGGED = 'activityEventLogged'

function emitLogged(row) {
  try {
    window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT_LOGGED, { detail: row }))
  } catch {
    // SSR / no-window — best effort.
  }
}

/* ============================================================
   logActivityEvent
   ============================================================ */

/**
 * INSERT a single activity_events row attributed to the current user.
 *
 * Never throws. Returns the inserted row on success, null on any
 * failure (no auth, no signed-in user, RLS rejection, network error).
 * Call sites fire-and-forget so an event-log failure cannot roll back
 * the primary mutation that triggered it.
 *
 * @param {{
 *   type: 'played'|'rated'|'reviewed'|'favorited'|'listed'|
 *         'started'|'completed'|'dropped'|'goal_hit',
 *   entityId?: string|number|null,
 *   metadata?: Record<string, any>,
 * }} args
 * @returns {Promise<object|null>}
 */
export async function logActivityEvent({
  type,
  entityId = null,
  metadata = {},
} = {}) {
  try {
    if (!type || !VALID_TYPES.has(type)) {
      if (type) {
        console.warn('[pulse] logActivityEvent unknown type:', type)
      }
      return null
    }

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser()
    if (userErr || !user) {
      // Not signed in — the local-storage-only tracker still works;
      // we just don't have an actor to attribute the event to.
      return null
    }

    const insert = {
      actor_user_id: user.id,
      type,
      entity_id: entityId != null ? String(entityId) : null,
      metadata: metadata || {},
    }

    const { data, error } = await supabase
      .from(TABLE)
      .insert(insert)
      .select('*')
      .single()
    if (error) {
      // Most common failure here is the migration not having been run
      // yet (relation "activity_events" does not exist). Log once at
      // debug so dev consoles stay readable.
      console.debug('[pulse] logActivityEvent skipped:', error.message)
      return null
    }

    emitLogged(data)
    return data
  } catch (err) {
    console.error('[pulse] logActivityEvent crashed:', err)
    return null
  }
}

/* ============================================================
   getCircleActivityEvents
   ============================================================ */

/**
 * Fetch a page of activity_events authored by users the current user
 * follows. RLS already filters by per-actor privacy + the follow graph,
 * but we still scope the IN() clause by followee ids so an actor with
 * `activity_privacy = 'everyone'` doesn't leak into the feed of users
 * who don't follow them.
 *
 * The PostgREST FK hint `users!activity_events_actor_user_id_fkey`
 * disambiguates the join (matches the implicit FK name Postgres assigns
 * when `actor_user_id REFERENCES users(id)`).
 *
 * Pagination contract:
 *   - Newest-first by `created_at DESC`.
 *   - `before` is the previous page's tail `created_at` (exclusive
 *     `<` so we never duplicate the boundary row).
 *   - Callers should consider the page exhausted when `rows.length < limit`.
 *
 * Block filter: any followee who blocks (or is blocked by) the current
 * user is excluded via `applyBlockFilter` on `actor_user_id`. RLS still
 * enforces this server-side, but the client filter also collapses any
 * row that arrived via the realtime cache before the block was applied.
 *
 * @param {{ limit?: number, before?: string|null }} opts
 * @returns {Promise<Array<{
 *   id: string,
 *   actor_user_id: string,
 *   type: string,
 *   entity_id: string|null,
 *   metadata: Record<string, any>,
 *   created_at: string,
 *   actor: { id: string, username: string|null, display_name: string|null, avatar_url: string|null }|null,
 * }>>}
 */
export async function getCircleActivityEvents({ limit = 50, before = null } = {}) {
  try {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser()
    if (userErr || !user) return []

    const { data: followRows, error: followErr } = await supabase
      .from('follows')
      .select('followee_id')
      .eq('follower_id', user.id)
    if (followErr) {
      console.error('[pulse] getCircleActivityEvents follows failed:', followErr.message)
      return []
    }
    const followeeIds = (followRows || []).map((r) => r.followee_id)
    if (followeeIds.length === 0) return []

    let query = supabase
      .from(TABLE)
      .select(
        'id, actor_user_id, type, entity_id, metadata, created_at,' +
          ' actor:users!activity_events_actor_user_id_fkey(id, username, display_name, avatar_url)'
      )
      .in('actor_user_id', followeeIds)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(100, limit)))

    if (before) {
      query = query.lt('created_at', before)
    }

    query = await applyBlockFilter(query, 'actor_user_id')

    const { data, error } = await query
    if (error) {
      console.error('[pulse] getCircleActivityEvents query failed:', error.message)
      return []
    }
    return data || []
  } catch (err) {
    console.error('[pulse] getCircleActivityEvents crashed:', err)
    return []
  }
}

/* ============================================================
   getRecentGlobalActivityEvents
   ============================================================ */

/**
 * Fetch a page of recent activity_events from ANY user (global scope).
 * Used as a community-activity fallback when the current user follows
 * people who have no recent events, so "Followers' Picks" is never a
 * blank island.
 *
 * Exclusions applied:
 *   - Block filter on actor_user_id (same as circle feed)
 *   - Excludes the current user's own events (self-events belong on
 *     the Profile timeline, not the social card)
 *
 * RLS on `activity_events` allows authenticated reads of public-privacy
 * rows cross-user, which is the same permission used by trending/explore.
 *
 * @param {{ limit?: number, before?: string|null }} opts
 * @returns {Promise<Array>}  Same shape as getCircleActivityEvents rows.
 */
export async function getRecentGlobalActivityEvents({ limit = 10, before = null } = {}) {
  try {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser()
    if (userErr || !user) return []

    let query = supabase
      .from(TABLE)
      .select(
        'id, actor_user_id, type, entity_id, metadata, created_at,' +
          ' actor:users!activity_events_actor_user_id_fkey(id, username, display_name, avatar_url)'
      )
      .neq('actor_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(50, limit)))

    if (before) {
      query = query.lt('created_at', before)
    }

    query = await applyBlockFilter(query, 'actor_user_id')

    const { data, error } = await query
    if (error) {
      console.error('[pulse] getRecentGlobalActivityEvents query failed:', error.message)
      return []
    }
    return data || []
  } catch (err) {
    console.error('[pulse] getRecentGlobalActivityEvents crashed:', err)
    return []
  }
}

/* ============================================================
   Worded sentence + deep-link helpers
   ============================================================ */

/**
 * Returns the actor's preferred display name for the timeline:
 * display_name > username > "Someone". Never returns an empty string.
 */
function actorName(event) {
  const a = event?.actor || {}
  return a.display_name || a.username || 'Someone'
}

/**
 * Returns the game title from the event metadata, with a friendly
 * fallback when the writer didn't denormalise it.
 */
function gameTitle(event) {
  return event?.metadata?.game_title || 'a game'
}

/**
 * Formats `seconds` as "45m", "2h", or "2h 30m" — matches the same
 * idiom used by the rest of the app (SocialActivityCard.formatDuration).
 * Returns null for non-positive / missing values so callers can skip
 * the qualifier rather than rendering an empty "for".
 */
function formatDurationFromSeconds(seconds) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s < 60) return null
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/**
 * Formats `hours` as "2h", "30m", or "2h 30m" for the `dropped`
 * sentence's "after Xh" qualifier. Returns null when the writer
 * didn't supply hours.
 */
function formatHoursQualifier(hours) {
  const h = Number(hours)
  if (!Number.isFinite(h) || h <= 0) return null
  return formatDurationFromSeconds(Math.round(h * 3600))
}

/**
 * Build the human-readable sentence for one `activity_events` row.
 *
 * Examples (matching the spec):
 *   "elvis dropped FIFA after 2h"
 *   "Hayakawa 100%'d Hollow Knight"
 *
 * Per-type templates:
 *   played      → "{actor} played {game} for {duration}"
 *                 (collapses to "{actor} played {game}" when no
 *                 duration is in metadata)
 *   started     → "{actor} started {game}"
 *   completed   → "{actor} 100%'d {game}"
 *   dropped     → "{actor} dropped {game}"
 *                 + " after {hours}" when metadata.hours_played > 0
 *   reviewed    → "{actor} reviewed {game}"
 *                 + " ({rating}\u2605)" when rating is present
 *   favorited   → "{actor} favorited {game}"
 *   listed      → kind === 'list_created':
 *                   "{actor} created the list '{list_name}'"
 *                 kind === 'game_added_to_list':
 *                   "{actor} added {game} to '{list_name}'"
 *   goal_hit    → kind === 'streak':
 *                   "{actor} hit a {milestone}-day streak"
 *                 anything else: "{actor} hit a milestone"
 *   rated       → "{actor} rated {game}"
 *                 (reserved enum value — no writers today)
 *
 * Unknown types fall back to "{actor} did something" rather than
 * throwing, so an enum addition never crashes the feed.
 */
export function formatActivityEventMessage(event) {
  if (!event) return ''
  const actor = actorName(event)
  const game = gameTitle(event)
  const meta = event.metadata || {}

  switch (event.type) {
    case 'played': {
      const duration = formatDurationFromSeconds(meta.seconds)
      return duration ? `${actor} played ${game} for ${duration}` : `${actor} played ${game}`
    }
    case 'started':
      return `${actor} started ${game}`
    case 'completed':
      return `${actor} 100%'d ${game}`
    case 'dropped': {
      const after = formatHoursQualifier(meta.hours_played)
      return after ? `${actor} dropped ${game} after ${after}` : `${actor} dropped ${game}`
    }
    case 'reviewed': {
      const r = Number(meta.rating)
      if (Number.isFinite(r) && r > 0) {
        const rounded = Number.isInteger(r) ? r : r.toFixed(1)
        return `${actor} reviewed ${game} (${rounded}\u2605)`
      }
      return `${actor} reviewed ${game}`
    }
    case 'favorited':
      return `${actor} favorited ${game}`
    case 'backlogged':
      return `${actor} added ${game} to their backlog`
    case 'listed': {
      const listName = meta.list_name || 'a list'
      if (meta.kind === 'list_created') {
        return `${actor} created the list '${listName}'`
      }
      // game_added_to_list — game is the named entity
      return `${actor} added ${game} to '${listName}'`
    }
    case 'goal_hit': {
      if (meta.kind === 'streak' && meta.milestone) {
        return `${actor} hit a ${meta.milestone}-day streak`
      }
      return `${actor} hit a milestone`
    }
    case 'rated': {
      const r = Number(meta.rating)
      if (Number.isFinite(r) && r > 0) {
        const rounded = Number.isInteger(r) ? r : r.toFixed(1)
        return `${actor} rated ${game} (${rounded}\u2605)`
      }
      return `${actor} rated ${game}`
    }
    default:
      return `${actor} did something`
  }
}

/**
 * Returns the in-app route for tapping an activity event row, or null
 * when there's no useful destination (e.g. goal_hit, which only
 * belongs on the actor's own profile and isn't a deep link target).
 *
 * Routing rules:
 *   played/started/completed/dropped/favorited/rated  → /game/:entityId
 *   reviewed                                          → /game/:entityId
 *                                                       (?review=:reviewId
 *                                                        when metadata
 *                                                        carries it)
 *   listed kind=list_created                          → /list/:entityId
 *   listed kind=game_added_to_list                    → /game/:entityId
 *                                                       (game side is
 *                                                        named in the
 *                                                        sentence; falls
 *                                                        back to /list/
 *                                                        if no game id)
 *   goal_hit                                          → null
 *
 * Returns null for any event whose entity_id is missing AND whose
 * fallback target is also missing — the consumer should render the
 * sentence non-tappable rather than navigating to a 404.
 */
export function getActivityEventHref(event) {
  if (!event) return null
  const id = event.entity_id || null
  const meta = event.metadata || {}

  switch (event.type) {
    case 'played':
    case 'started':
    case 'completed':
    case 'dropped':
    case 'favorited':
    case 'rated':
    case 'backlogged':
      return id ? `/game/${id}` : null
    case 'reviewed': {
      if (!id) return null
      return meta.review_id
        ? `/game/${id}?review=${encodeURIComponent(meta.review_id)}`
        : `/game/${id}`
    }
    case 'listed': {
      if (meta.kind === 'list_created') {
        return id ? `/list/${id}` : null
      }
      if (id) return `/game/${id}`
      return meta.list_id ? `/list/${meta.list_id}` : null
    }
    case 'goal_hit':
    default:
      return null
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../contexts/AuthContext'
import {
  ACTIVITY_EVENT_LOGGED,
  getCircleActivityEvents,
} from '../services/activityEventsService'
import { APP_RESUMED_EVENT } from './useAppResume'
import { subscribeWithRecovery } from '../services/realtimeRecovery'

/**
 * Pulse — useCircleActivity()
 *
 * The single source of truth for follow-graph activity. Every later
 * Pulse-driven UI feature (timeline, "what's happening" digests, deep
 * link cards, etc.) reads from this hook so we never re-query raw
 * `activity_events` from multiple places.
 *
 * What it does
 * ------------
 * 1. Fetches the most recent `activity_events` authored by users the
 *    current user follows (RLS already filters by per-actor privacy).
 * 2. Subscribes to INSERT events on `activity_events` via Realtime
 *    postgres_changes — when a followee posts new activity it shows
 *    up here without polling.
 * 3. Listens for the local `activityEventLogged` window event so the
 *    actor's OWN events appear instantly without waiting for the
 *    realtime echo. (postgres_changes also delivers to the actor, but
 *    the echo is observed-after-write, not before, so the local event
 *    makes the optimistic feel right.)
 * 4. Reloads the page on `app:resumed` so a backgrounded session
 *    doesn't show a stale feed when the WebView wakes back up.
 *
 * What it intentionally does NOT do
 * ---------------------------------
 * No UI. No formatting. No deep-link routing. UI features render the
 * raw shape exposed here.
 *
 * @param {{ limit?: number, pageSize?: number }} opts
 *   limit     initial page size (also the page size for loadMore)
 *   pageSize  alias for limit kept for call-site readability
 * @returns {{
 *   events: Array,
 *   loading: boolean,
 *   loadingMore: boolean,
 *   hasMore: boolean,
 *   error: Error|null,
 *   refresh: () => Promise<void>,
 *   loadMore: () => Promise<void>,
 * }}
 */
export function useCircleActivity({ limit = 50, pageSize } = {}) {
  const effectiveLimit = pageSize ?? limit
  const { user } = useAuth()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState(null)
  // Bumped on app resume so the realtime effect below tears down the dead
  // (post-suspend) channel and re-subscribes onto a fresh socket — same
  // pattern as UnreadMessagesContext / NotificationsContext.
  const [resumeKey, setResumeKey] = useState(0)

  // Track the follow-graph in a ref so the realtime listener can
  // synchronously filter incoming INSERTs without re-creating the
  // subscription whenever the follow set changes.
  const followeeIdsRef = useRef(/** @type {Set<string>} */ (new Set()))

  // ── Follow graph hydration ──────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) {
      followeeIdsRef.current = new Set()
      return
    }
    let cancelled = false

    async function load() {
      const { data, error: followErr } = await supabase
        .from('follows')
        .select('followee_id')
        .eq('follower_id', user.id)
      if (cancelled) return
      if (followErr) {
        // Non-fatal — feed will be empty but we won't crash.
        followeeIdsRef.current = new Set()
        return
      }
      followeeIdsRef.current = new Set((data || []).map((r) => r.followee_id))
    }
    load()

    function onFollowChanged() {
      if (!cancelled) load()
    }
    window.addEventListener('followChanged', onFollowChanged)
    return () => {
      cancelled = true
      window.removeEventListener('followChanged', onFollowChanged)
    }
  }, [user?.id])

  // ── Initial fetch + refresh ─────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!user?.id) {
      setEvents([])
      setHasMore(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const rows = await getCircleActivityEvents({ limit: effectiveLimit })
      setEvents(rows)
      // Page exhausted only when we got fewer rows than asked for —
      // a short first page means there's nothing older to load.
      setHasMore(rows.length === effectiveLimit)
    } catch (err) {
      setError(err)
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [user?.id, effectiveLimit])

  // ── Pagination (newest-first cursor on created_at) ──────────────────
  //
  // We page using the previous tail's `created_at` rather than offset to
  // stay correct when realtime inserts arrive between pages: an offset
  // would shift the window and we'd skip rows. `lt('created_at', tail)`
  // is monotonic regardless of what landed at the top.
  const loadMore = useCallback(async () => {
    if (!user?.id) return
    if (loadingMore || !hasMore) return
    const tail = events[events.length - 1]
    if (!tail?.created_at) return
    setLoadingMore(true)
    try {
      const older = await getCircleActivityEvents({
        limit: effectiveLimit,
        before: tail.created_at,
      })
      setEvents((prev) => {
        // De-dupe on id in case a realtime echo for an older row raced
        // the manual paginated fetch.
        const seen = new Set(prev.map((e) => e.id))
        const merged = [...prev]
        for (const row of older) {
          if (!seen.has(row.id)) merged.push(row)
        }
        return merged
      })
      if (older.length < effectiveLimit) setHasMore(false)
    } catch (err) {
      setError(err)
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }, [user?.id, events, effectiveLimit, loadingMore, hasMore])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    function onResume() {
      setResumeKey((k) => k + 1)
      refresh()
    }
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [refresh])

  // ── Realtime subscription ───────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return undefined

    const channel = supabase
      .channel(`pulse:activity:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_events',
        },
        async (payload) => {
          const row = payload?.new
          if (!row) return
          // RLS will already have filtered cross-actor INSERTs the
          // current user isn't allowed to see, but postgres_changes
          // delivers the actor's own row too. We only want followee
          // rows here — the local `activityEventLogged` event handles
          // the actor's own optimistic insert.
          if (row.actor_user_id === user.id) return
          if (!followeeIdsRef.current.has(row.actor_user_id)) return

          // Hydrate the actor profile so cards can render avatar +
          // display_name without a second round-trip.
          let actor = null
          try {
            const { data } = await supabase
              .from('users')
              .select('id, username, display_name, avatar_url')
              .eq('id', row.actor_user_id)
              .maybeSingle()
            actor = data || null
          } catch {
            // No-op — `actor` stays null; consumers handle that gracefully.
          }

          setEvents((prev) => {
            // De-dupe on id in case the row also arrives via a manual
            // refresh racing with the realtime callback. Realtime
            // inserts are unbounded on the new-side: we never slice the
            // tail off here so existing paginated rows aren't dropped.
            if (prev.some((e) => e.id === row.id)) return prev
            return [{ ...row, actor }, ...prev]
          })
        }
      )

    const disposeSubscribe = subscribeWithRecovery(channel)

    return () => {
      disposeSubscribe()
      supabase.removeChannel(channel)
    }
  }, [user?.id, resumeKey])

  // ── Local optimistic insert for the actor's own events ──────────────
  useEffect(() => {
    if (!user?.id) return undefined

    function onLocalLogged(e) {
      const row = e?.detail
      if (!row || row.actor_user_id !== user.id) return
      // The actor doesn't follow themselves, so we don't surface their
      // own events in the *circle* feed here. Consumers that need the
      // actor's own activity can read from their profile timeline.
      // No-op kept for symmetry / future extension.
    }

    window.addEventListener(ACTIVITY_EVENT_LOGGED, onLocalLogged)
    return () => window.removeEventListener(ACTIVITY_EVENT_LOGGED, onLocalLogged)
  }, [user?.id])

  const value = useMemo(
    () => ({ events, loading, loadingMore, hasMore, error, refresh, loadMore }),
    [events, loading, loadingMore, hasMore, error, refresh, loadMore]
  )
  return value
}

export default useCircleActivity

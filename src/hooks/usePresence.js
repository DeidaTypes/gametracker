import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSession } from '../contexts/SessionContext'
import {
  SETTINGS_CHANGED_EVENT,
  getSettings,
} from '../services/userSettingsService'
import { APP_RESUMED_EVENT } from './useAppResume'
import { subscribeWithRecovery } from '../services/realtimeRecovery'

/**
 * Pulse — usePresence()
 *
 * Realtime presence over the follow graph. Returns an array of users
 * the current user follows who are *currently* playing something, plus
 * the game they're playing on.
 *
 * Architecture
 * ------------
 * A single global Realtime presence channel ('pulse:presence:v1') is
 * shared by every opted-in user. Each member joins with a payload
 * carrying their own active game (read from SessionContext). The
 * `presenceState` keyed by user id makes the channel effectively a
 * live key/value store of "who is playing what right now".
 *
 * We fan out membership server-side (one channel) but filter the
 * surfaced state client-side to only the user ids in the current
 * user's follow graph — that's cheaper than a channel-per-user (which
 * scales with follow count) and means a follow/unfollow doesn't
 * require leaving and rejoining a channel.
 *
 * Singleton channel
 * ------------------
 * This hook is mounted from five separate places (NudgesProvider,
 * CoopSignalCard, Profile, FindFriendsModal, FollowsListPage). They're
 * all the same signed-in user, so joining the channel once per mount
 * used to create up to five duplicate subscriptions to the exact same
 * topic — wasted sockets, and `supabase.realtime.channels.find(...)`
 * lookups elsewhere had no way to know which duplicate they'd get back.
 *
 * `presenceStore` below is a module-level, ref-counted singleton: the
 * first mount joins the channel, every subsequent mount just registers
 * as a listener on the shared state, and the channel is only left when
 * the last mount unmounts (ref count hits zero). There is at most one
 * `pulse:presence:v1` subscription for the whole app at any time.
 *
 * Privacy / opt-in
 * ----------------
 * The hook is a no-op unless the local presence opt-in setting is
 * true. That setting is mirrored to `users.presence_opt_in` so
 * presence is honored across devices on the same account. When
 * presence is off:
 *   - the channel is never joined,
 *   - the returned `playingNow` array is empty,
 *   - and there's no observable broadcast for this user.
 *
 * Liveness
 * --------
 * Hybrid model: this hook (presence channel) provides instant updates
 * for the follow graph; the activity_events table provides
 * near-real-time fan-out for everything else (see useCircleActivity).
 *
 * Resume handling
 * ---------------
 * On `app:resumed` we explicitly re-track our current state — the
 * `track()` payload is what other members read, so the rejoin must
 * restate it or the channel will show us as having joined without a
 * game. CHANNEL_ERROR / TIMED_OUT / CLOSED are additionally handled by
 * the shared subscribeWithRecovery() backoff, independent of resume.
 *
 * @returns {{
 *   enabled: boolean,            // is presence opt-in on
 *   playingNow: Array<{
 *     userId: string,
 *     gameId: number|null,
 *     gameTitle: string|null,
 *     gameImage: string|null,
 *     startedAt: string|null,
 *   }>,
 * }}
 */
const CHANNEL = 'pulse:presence:v1'

/**
 * Module-level singleton — one channel, ref-counted across every mounted
 * usePresence() consumer. Nothing here is React state; consumers read it
 * via useSyncExternalStore so each still re-renders on its own schedule.
 */
const presenceStore = {
  refCount: 0,
  userId: null,
  channel: null,
  disposeSubscribe: null,
  presenceMap: /** @type {Record<string, any>} */ ({}),
  latestPayload: null,
  lastTrackedKey: null,
  listeners: /** @type {Set<() => void>} */ (new Set()),
}

function notifyPresenceListeners() {
  for (const listener of presenceStore.listeners) listener()
}

function subscribeToPresenceStore(listener) {
  presenceStore.listeners.add(listener)
  return () => presenceStore.listeners.delete(listener)
}

function getPresenceSnapshot() {
  return presenceStore.presenceMap
}

function refreshPresenceMap() {
  const state = presenceStore.channel?.presenceState() || {}
  // Each value is an array of metas; we only care about the most
  // recent one per user id (same key collapses to one entry).
  const flat = {}
  for (const [key, metas] of Object.entries(state)) {
    if (!Array.isArray(metas) || metas.length === 0) continue
    flat[key] = metas[metas.length - 1]
  }
  presenceStore.presenceMap = flat
  notifyPresenceListeners()
}

function trackLatestPayload() {
  const channel = presenceStore.channel
  const payload = presenceStore.latestPayload
  if (!channel || !payload) return
  const key = JSON.stringify(payload)
  if (key === presenceStore.lastTrackedKey) return
  presenceStore.lastTrackedKey = key
  channel.track(payload).catch(() => {})
}

function teardownPresenceChannel() {
  presenceStore.disposeSubscribe?.()
  presenceStore.disposeSubscribe = null
  if (presenceStore.channel) {
    try {
      presenceStore.channel.untrack().catch(() => {})
    } catch {
      // best effort
    }
    supabase.removeChannel(presenceStore.channel)
  }
  presenceStore.channel = null
  presenceStore.userId = null
  presenceStore.presenceMap = {}
  presenceStore.lastTrackedKey = null
  notifyPresenceListeners()
}

function ensurePresenceChannel(userId) {
  if (presenceStore.channel && presenceStore.userId === userId) return
  // Identity changed underneath an open channel (rare — account switch) —
  // drop the old one before joining as the new user.
  if (presenceStore.channel) teardownPresenceChannel()

  presenceStore.userId = userId
  const channel = supabase.channel(CHANNEL, {
    config: { presence: { key: userId } },
  })

  channel
    .on('presence', { event: 'sync' }, refreshPresenceMap)
    .on('presence', { event: 'join' }, refreshPresenceMap)
    .on('presence', { event: 'leave' }, refreshPresenceMap)

  presenceStore.disposeSubscribe = subscribeWithRecovery(channel, (status) => {
    if (status === 'SUBSCRIBED') trackLatestPayload()
  })
  presenceStore.channel = channel
}

/** Called by every mounted hook whenever its inputs change; idempotent. */
function retrackPresence(payload) {
  presenceStore.latestPayload = payload
  trackLatestPayload()
}

function acquirePresence(userId, payload) {
  presenceStore.refCount += 1
  ensurePresenceChannel(userId)
  retrackPresence(payload)
}

function releasePresence() {
  presenceStore.refCount = Math.max(0, presenceStore.refCount - 1)
  if (presenceStore.refCount === 0) teardownPresenceChannel()
}

// Module-level (not per-mount) resume handler — restates the join payload
// so other members don't see us as present-but-gameless after a resume.
// Registered once for the lifetime of the module, matching the channel's
// own singleton lifetime.
if (typeof window !== 'undefined') {
  window.addEventListener(APP_RESUMED_EVENT, () => {
    if (!presenceStore.channel || !presenceStore.latestPayload) return
    // Resume may have handed us a dead channel object; re-track
    // unconditionally rather than relying on the lastTrackedKey dedupe.
    presenceStore.lastTrackedKey = null
    trackLatestPayload()
  })
}

function buildPresencePayload({ userId, profile, session }) {
  return {
    user_id: userId,
    display_name: profile?.display_name || profile?.username || null,
    game_id: session?.igdb_game_id != null ? Number(session.igdb_game_id) : null,
    game_title: session?.game_title ?? null,
    game_image: session?.game_image ?? null,
    started_at: session?.started_at ?? null,
    // online_at lets the server-side prune stale ghosts.
    online_at: new Date().toISOString(),
  }
}

export function usePresence() {
  const { user, profile } = useAuth()
  const { session } = useSession()
  const [enabled, setEnabled] = useState(() => !!getSettings().presenceOptIn)
  const [followeeIds, setFolloweeIds] = useState(/** @type {Set<string>} */ (new Set()))

  const presenceMap = useSyncExternalStore(
    subscribeToPresenceStore,
    getPresenceSnapshot
  )

  // ── Sync `enabled` with the user settings event bus ─────────────────
  useEffect(() => {
    function onSettings(e) {
      const next = e?.detail
      if (next && typeof next.presenceOptIn === 'boolean') {
        setEnabled(next.presenceOptIn)
      } else {
        setEnabled(!!getSettings().presenceOptIn)
      }
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettings)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettings)
  }, [])

  // ── Load the follow graph (and reload on follow/unfollow) ───────────
  useEffect(() => {
    if (!user?.id) {
      setFolloweeIds(new Set())
      return
    }
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('follows')
        .select('followee_id')
        .eq('follower_id', user.id)
      if (cancelled) return
      if (error) {
        console.error('[pulse] usePresence follows load failed:', error.message)
        return
      }
      setFolloweeIds(new Set((data || []).map((r) => r.followee_id)))
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

  // ── Acquire / release the shared presence channel ───────────────────
  useEffect(() => {
    if (!enabled || !user?.id) return undefined
    acquirePresence(user.id, buildPresencePayload({ userId: user.id, profile, session }))
    return () => releasePresence()
    // Only join/leave on opt-in or identity change — payload updates are
    // handled by the retrack effect below without touching ref counting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, user?.id])

  // ── Re-track when the active session or profile changes ─────────────
  useEffect(() => {
    if (!enabled || !user?.id) return undefined
    retrackPresence(buildPresencePayload({ userId: user.id, profile, session }))
    return undefined
  }, [
    enabled,
    user?.id,
    profile?.display_name,
    profile?.username,
    session?.id,
    session?.igdb_game_id,
    session?.game_title,
    session?.game_image,
    session?.started_at,
  ])

  // ── Derive the surfaced list ────────────────────────────────────────
  const playingNow = useMemo(() => {
    if (!enabled) return []
    const out = []
    for (const [key, meta] of Object.entries(presenceMap)) {
      if (!followeeIds.has(key)) continue
      if (!meta || meta.game_id == null) continue
      out.push({
        userId: key,
        displayName: meta.display_name || null,
        gameId: Number(meta.game_id),
        gameTitle: meta.game_title || null,
        gameImage: meta.game_image || null,
        startedAt: meta.started_at || null,
      })
    }
    return out
  }, [enabled, followeeIds, presenceMap])

  return { enabled, playingNow }
}

export default usePresence

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSession } from '../contexts/SessionContext'
import {
  SETTINGS_CHANGED_EVENT,
  getSettings,
} from '../services/userSettingsService'
import { APP_RESUMED_EVENT } from './useAppResume'

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
 * On `app:resumed` (fired by appLifecycle on iOS / the visibilitychange
 * fallback on web) we explicitly re-track our current state — the
 * `track()` payload is what other members read, so the rejoin must
 * restate it or the channel will show us as having joined without a
 * game.
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

export function usePresence() {
  const { user } = useAuth()
  const { session } = useSession()
  const [enabled, setEnabled] = useState(() => !!getSettings().presenceOptIn)
  const [followeeIds, setFolloweeIds] = useState(/** @type {Set<string>} */ (new Set()))
  const [presenceMap, setPresenceMap] = useState(/** @type {Record<string, any>} */ ({}))

  // Track the latest session payload in a ref so the channel listener
  // can always read the current game without re-creating the channel
  // every time the session changes.
  const sessionRef = useRef(session)
  useEffect(() => {
    sessionRef.current = session
  }, [session])

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

  // ── Join the presence channel ───────────────────────────────────────
  useEffect(() => {
    if (!enabled || !user?.id) {
      setPresenceMap({})
      return undefined
    }

    function buildPayload() {
      const active = sessionRef.current
      return {
        user_id: user.id,
        game_id: active?.igdb_game_id != null ? Number(active.igdb_game_id) : null,
        game_title: active?.game_title ?? null,
        game_image: active?.game_image ?? null,
        started_at: active?.started_at ?? null,
        // online_at lets the server-side prune stale ghosts.
        online_at: new Date().toISOString(),
      }
    }

    const channel = supabase.channel(CHANNEL, {
      config: { presence: { key: user.id } },
    })

    function refreshState() {
      const state = channel.presenceState() || {}
      // Each value is an array of metas; we only care about the most
      // recent one per user id (same key collapses to one entry).
      const flat = {}
      for (const [key, metas] of Object.entries(state)) {
        if (!Array.isArray(metas) || metas.length === 0) continue
        flat[key] = metas[metas.length - 1]
      }
      setPresenceMap(flat)
    }

    channel
      .on('presence', { event: 'sync' }, refreshState)
      .on('presence', { event: 'join' }, refreshState)
      .on('presence', { event: 'leave' }, refreshState)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.track(buildPayload()).catch(() => {})
        }
      })

    function reTrack() {
      // Called when our own session changes or the app resumes — the
      // channel itself is fine, we just need to publish a fresh payload.
      channel.track(buildPayload()).catch(() => {})
    }

    window.addEventListener(APP_RESUMED_EVENT, reTrack)

    return () => {
      window.removeEventListener(APP_RESUMED_EVENT, reTrack)
      try {
        channel.untrack().catch(() => {})
      } catch {
        // best effort
      }
      supabase.removeChannel(channel)
    }
    // We intentionally rebuild the channel only when opt-in or user
    // changes. Session changes are handled via sessionRef + the
    // separate `reTrack on session change` effect below.
  }, [enabled, user?.id])

  // ── Re-track when the active session changes ────────────────────────
  useEffect(() => {
    if (!enabled || !user?.id) return undefined
    // Find the live channel by name. Cheaper than rebuilding the
    // subscription on every session tick.
    const channel = supabase.realtime.channels?.find(
      (c) => c.topic === `realtime:${CHANNEL}` || c.topic === CHANNEL
    )
    if (!channel) return undefined
    const payload = {
      user_id: user.id,
      game_id: session?.igdb_game_id != null ? Number(session.igdb_game_id) : null,
      game_title: session?.game_title ?? null,
      game_image: session?.game_image ?? null,
      started_at: session?.started_at ?? null,
      online_at: new Date().toISOString(),
    }
    channel.track(payload).catch(() => {})
    return undefined
  }, [enabled, user?.id, session?.id, session?.igdb_game_id])

  // ── Derive the surfaced list ────────────────────────────────────────
  const playingNow = useMemo(() => {
    if (!enabled) return []
    const out = []
    for (const [key, meta] of Object.entries(presenceMap)) {
      if (!followeeIds.has(key)) continue
      if (!meta || meta.game_id == null) continue
      out.push({
        userId: key,
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

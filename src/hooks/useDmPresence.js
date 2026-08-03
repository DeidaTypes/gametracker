import { useEffect, useRef, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../contexts/AuthContext'
import { subscribeWithRecovery } from '../services/realtimeRecovery'
import { APP_RESUMED_EVENT } from './useAppResume'

/**
 * F1 — DM-thread online presence, extended with a `typing` flag.
 *
 * Joins a per-conversation Supabase Realtime presence channel that is
 * keyed on the canonical (sorted) pair of user IDs. Both participants
 * land on the same channel name regardless of who opened the thread
 * first.
 *
 * When this user has the thread open, they `track()` onto the channel
 * with `{ online_at, typing }`. When the partner is also tracking,
 * `partnerOnline` becomes true; when the partner's tracked payload has
 * `typing: true`, `partnerTyping` becomes true — this is a real signal
 * carried over the existing presence channel, not a simulated one.
 *
 * The channel is removed and both flags reset to false when the
 * component unmounts (thread closed / navigated away).
 *
 * Resume handling
 * ---------------
 * This channel is per-conversation and has exactly one mount site
 * (MessagesThread), unlike Pulse's app-wide presence (usePresence.js),
 * which is mounted from five places and therefore needs a ref-counted
 * singleton so concurrent mounts share one channel and resume just
 * re-tracks the existing join. There's nothing to ref-count here, so on
 * `app:resumed` we follow the *other* established pattern instead — the
 * resumeKey used by MessagesThread's own message channel and by
 * MessagesInbox / UnreadMessagesContext: bump a counter that's a
 * dependency of the join effect below, so the dead post-suspend channel
 * is torn down (cleanup) and rejoined on a fresh socket, rather than
 * left relying on a naive re-subscribe of the same dead channel object.
 *
 * @param {string|null} partnerId  UUID of the conversation partner.
 * @param {boolean} isTyping  Whether the current user is actively
 *   composing a message — re-tracked (without rejoining the channel)
 *   whenever this changes.
 * @returns {{ partnerOnline: boolean, partnerTyping: boolean }}
 */
export function useDmPresence(partnerId, isTyping = false) {
  const { user } = useAuth()
  const [partnerOnline, setPartnerOnline] = useState(false)
  const [partnerTyping, setPartnerTyping] = useState(false)
  const channelRef = useRef(null)
  // See "Resume handling" above — bumped on app resume so the join effect
  // below tears down the dead (post-suspend) channel and rejoins fresh.
  const [resumeKey, setResumeKey] = useState(0)

  useEffect(() => {
    const onResume = () => setResumeKey((k) => k + 1)
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [])

  useEffect(() => {
    const myId = user?.id
    if (!myId || !partnerId || myId === partnerId) return undefined

    // Canonical channel name — order-independent so both users share one channel.
    const pair = [myId, partnerId].sort().join(':')
    const channelName = `dm:presence:${pair}`

    const channel = supabase.channel(channelName, {
      config: { presence: { key: myId } },
    })
    channelRef.current = channel

    function refreshState() {
      const state = channel.presenceState() || {}
      const metas = state[partnerId]
      const online = Array.isArray(metas) && metas.length > 0
      setPartnerOnline(online)
      const latest = online ? metas[metas.length - 1] : null
      setPartnerTyping(!!latest?.typing)
    }

    channel
      .on('presence', { event: 'sync' }, refreshState)
      .on('presence', { event: 'join' }, refreshState)
      .on('presence', { event: 'leave' }, refreshState)

    const disposeSubscribe = subscribeWithRecovery(channel, (status) => {
      if (status === 'SUBSCRIBED') {
        channel
          .track({ online_at: new Date().toISOString(), typing: false })
          .catch(() => {})
      }
    })

    return () => {
      disposeSubscribe()
      try {
        channel.untrack().catch(() => {})
      } catch {
        // best effort
      }
      supabase.removeChannel(channel)
      channelRef.current = null
      setPartnerOnline(false)
      setPartnerTyping(false)
    }
  }, [user?.id, partnerId, resumeKey])

  // Re-track (without rejoining) whenever our own typing state flips —
  // keeps the channel subscription stable while the composer is live.
  useEffect(() => {
    const channel = channelRef.current
    if (!channel) return
    channel
      .track({ online_at: new Date().toISOString(), typing: isTyping })
      .catch(() => {})
  }, [isTyping])

  return { partnerOnline, partnerTyping }
}

export default useDmPresence

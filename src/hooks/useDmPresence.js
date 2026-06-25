import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../contexts/AuthContext'

/**
 * F1 — DM-thread online presence.
 *
 * Joins a per-conversation Supabase Realtime presence channel that is
 * keyed on the canonical (sorted) pair of user IDs. Both participants
 * land on the same channel name regardless of who opened the thread
 * first.
 *
 * When this user has the thread open, they `track()` onto the channel.
 * When the partner is also tracking, `partnerOnline` becomes true and
 * the thread header shows the "Online" dot.
 *
 * The channel is removed and `partnerOnline` is reset to false when
 * the component unmounts (thread closed / navigated away).
 *
 * @param {string|null} partnerId  UUID of the conversation partner.
 * @returns {{ partnerOnline: boolean }}
 */
export function useDmPresence(partnerId) {
  const { user } = useAuth()
  const [partnerOnline, setPartnerOnline] = useState(false)

  useEffect(() => {
    const myId = user?.id
    if (!myId || !partnerId || myId === partnerId) return undefined

    // Canonical channel name — order-independent so both users share one channel.
    const pair = [myId, partnerId].sort().join(':')
    const channelName = `dm:presence:${pair}`

    const channel = supabase.channel(channelName, {
      config: { presence: { key: myId } },
    })

    function refreshState() {
      const state = channel.presenceState() || {}
      setPartnerOnline(partnerId in state)
    }

    channel
      .on('presence', { event: 'sync' }, refreshState)
      .on('presence', { event: 'join' }, refreshState)
      .on('presence', { event: 'leave' }, refreshState)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.track({ online_at: new Date().toISOString() }).catch(() => {})
        }
      })

    return () => {
      try {
        channel.untrack().catch(() => {})
      } catch {
        // best effort
      }
      supabase.removeChannel(channel)
      setPartnerOnline(false)
    }
  }, [user?.id, partnerId])

  return { partnerOnline }
}

export default useDmPresence

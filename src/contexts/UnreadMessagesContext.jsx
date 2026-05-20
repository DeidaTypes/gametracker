import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useAuth } from './AuthContext'
import { supabase } from '../services/supabase'
import {
  getUnreadCount,
  MESSAGES_CHANGED_EVENT,
} from '../services/messageService'

const UnreadMessagesContext = createContext({ unreadCount: 0, refresh: () => {} })

/**
 * Sprint 6 P2 — Unread DM count provider.
 *
 * Wraps the app inside <AuthProvider> so it can read the current user
 * and exposes a single number (`unreadCount`) plus a manual `refresh`
 * callback. The number drives the small copper dot on the Profile tab
 * in the bottom nav.
 *
 * Update sources:
 *   1. On mount and on user change, fetch once via getUnreadCount().
 *   2. Subscribe to realtime INSERTs on direct_messages where
 *      recipient_id = current user, refetch on every event.
 *   3. Subscribe to realtime UPDATEs on direct_messages where
 *      recipient_id = current user, refetch (recipient flipping
 *      read_at zeroes out a contribution to the count).
 *   4. Listen for the in-app `MESSAGES_CHANGED_EVENT` so optimistic
 *      mark-as-read flows clear the dot without waiting for the
 *      realtime echo (which can lag 50-200ms).
 *
 * The component renders nothing of its own — it's a context provider.
 */
export function UnreadMessagesProvider({ children }) {
  const { user } = useAuth()
  const userId = user?.id || null
  const [unreadCount, setUnreadCount] = useState(0)

  const refresh = useCallback(async () => {
    if (!userId) {
      setUnreadCount(0)
      return
    }
    try {
      const next = await getUnreadCount()
      setUnreadCount(next)
    } catch (err) {
      console.error('[unread-messages] refresh failed:', err)
    }
  }, [userId])

  // Initial + identity-change refresh.
  useEffect(() => {
    if (!userId) {
      setUnreadCount(0)
      return
    }
    refresh()
  }, [userId, refresh])

  // Realtime subscription — refetch on any DM mutation that affects me.
  useEffect(() => {
    if (!userId) return undefined
    const channel = supabase
      .channel(`unread-dm:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `recipient_id=eq.${userId}`,
        },
        () => refresh()
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'direct_messages',
          filter: `recipient_id=eq.${userId}`,
        },
        () => refresh()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, refresh])

  // In-app event — sendMessage / markThreadAsRead emit this so the
  // dot updates instantly even before the realtime echo arrives.
  useEffect(() => {
    if (!userId) return undefined
    const onChange = () => refresh()
    window.addEventListener(MESSAGES_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(MESSAGES_CHANGED_EVENT, onChange)
  }, [userId, refresh])

  const value = useMemo(
    () => ({ unreadCount, refresh }),
    [unreadCount, refresh]
  )

  return (
    <UnreadMessagesContext.Provider value={value}>
      {children}
    </UnreadMessagesContext.Provider>
  )
}

export function useUnreadMessages() {
  return useContext(UnreadMessagesContext)
}

export default UnreadMessagesContext

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
  fetchNotifications,
  getUnreadNotificationCount,
  markNotificationsRead,
} from '../services/notificationService'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import { subscribeWithRecovery } from '../services/realtimeRecovery'

const NotificationsContext = createContext({
  notifications: [],
  unreadCount: 0,
  refresh: () => {},
  markRead: () => Promise.resolve(),
})

/**
 * NotificationsProvider — realtime-backed in-app notification feed.
 *
 * Update sources:
 *   1. Initial fetch on mount / user change.
 *   2. Supabase realtime INSERT on notifications WHERE recipient_user_id = me.
 *   3. App resume — tears down the dead suspended channel and re-subscribes.
 *
 * Exposes:
 *   notifications   — sorted newest-first array, each with actor profile join
 *   unreadCount     — integer badge value (every type, from the server count)
 *   refresh()       — manual refetch (e.g. after pull-to-refresh)
 *   markRead(ids)   — marks those rows read + optimistically lowers unreadCount
 */
export function NotificationsProvider({ children }) {
  const { user } = useAuth()
  const userId = user?.id || null

  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  // Bumped on app resume so the realtime effect recreates the channel.
  const [resumeKey, setResumeKey] = useState(0)

  const refresh = useCallback(async () => {
    if (!userId) {
      setNotifications([])
      setUnreadCount(0)
      return
    }
    try {
      const [rows, count] = await Promise.all([
        fetchNotifications(),
        getUnreadNotificationCount(),
      ])
      setNotifications(rows)
      setUnreadCount(count)
    } catch (err) {
      console.error('[notifications] refresh failed:', err)
    }
  }, [userId])

  // Initial fetch + identity change.
  useEffect(() => {
    if (!userId) {
      setNotifications([])
      setUnreadCount(0)
      return
    }
    refresh()
  }, [userId, refresh])

  // Reconnect on app resume (suspended WebSocket is dead).
  useEffect(() => {
    const onResume = () => {
      setResumeKey((k) => k + 1)
      refresh()
    }
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [refresh])

  // Realtime — prepend incoming notification + bump unread count.
  useEffect(() => {
    if (!userId) return undefined

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_user_id=eq.${userId}`,
        },
        () => {
          // Refetch rather than stitch — ensures actor join data is present.
          refresh()
        }
      )

    const disposeSubscribe = subscribeWithRecovery(channel)

    return () => {
      disposeSubscribe()
      supabase.removeChannel(channel)
    }
  }, [userId, refresh, resumeKey])

  const markRead = useCallback(
    async (ids) => {
      if (!userId || !ids || ids.length === 0) return
      const target = new Set(ids)
      // Optimistic so the badge drops the moment the rows are on screen.
      setUnreadCount((c) => Math.max(0, c - target.size))
      setNotifications((prev) => prev.map((n) => (target.has(n.id) ? { ...n, read: true } : n)))
      await markNotificationsRead(ids)
      const count = await getUnreadNotificationCount()
      setUnreadCount(count)
    },
    [userId]
  )

  const value = useMemo(
    () => ({ notifications, unreadCount, refresh, markRead }),
    [notifications, unreadCount, refresh, markRead]
  )

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  return useContext(NotificationsContext)
}

export default NotificationsContext

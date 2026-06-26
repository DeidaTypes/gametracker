import { supabase } from './supabase'

/**
 * Notification Service — Supabase-backed.
 *
 * Schema (applied via migration 20260626161400):
 *
 *   notifications (
 *     id                uuid PK,
 *     recipient_user_id uuid → users(id) ON DELETE CASCADE,
 *     actor_user_id     uuid → users(id) ON DELETE CASCADE,
 *     type              notification_type ENUM ('follow','reaction','comment','friend_started'),
 *     entity_id         text  -- review_id for reaction/comment, igdb_game_id for friend_started, null for follow
 *     read              boolean DEFAULT false,
 *     created_at        timestamptz DEFAULT now()
 *   )
 *
 * RLS: recipient_user_id = auth.uid() for SELECT and UPDATE.
 * Rows are written exclusively by SECURITY DEFINER triggers.
 *
 * All reads fail-soft (return [] / 0) so UI never blocks on a
 * notification error.
 */

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error) {
    console.error('[notifications] auth.getUser failed:', error.message)
    return null
  }
  return user?.id || null
}

/**
 * Fetch the signed-in user's notifications, newest first.
 * Each row is joined to the actor's profile (username, display_name,
 * avatar_url) so the inbox can render without extra round-trips.
 *
 * @param {number} [limit=40]
 * @returns {Promise<Array>}
 */
export async function fetchNotifications(limit = 40) {
  const userId = await getCurrentUserId()
  if (!userId) return []

  const { data, error } = await supabase
    .from('notifications')
    .select(
      'id, type, entity_id, read, created_at, ' +
        'actor:users!actor_user_id(id, username, display_name, avatar_url)'
    )
    .eq('recipient_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[notifications] fetchNotifications failed:', error.message)
    return []
  }
  return data || []
}

/**
 * Count of unread notifications for the signed-in user.
 * Used for the badge in the header / nav.
 *
 * @returns {Promise<number>}
 */
export async function getUnreadNotificationCount() {
  const userId = await getCurrentUserId()
  if (!userId) return 0

  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('recipient_user_id', userId)
    .eq('read', false)

  if (error) {
    console.error('[notifications] getUnreadNotificationCount failed:', error.message)
    return 0
  }
  return count || 0
}

/**
 * Mark a single notification as read.
 *
 * @param {string} notificationId
 */
export async function markNotificationRead(notificationId) {
  if (!notificationId) return

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', notificationId)

  if (error) {
    console.error('[notifications] markNotificationRead failed:', error.message)
  }
}

/**
 * Mark all unread notifications as read for the signed-in user.
 * Called when the inbox mounts so the badge clears on view.
 *
 * @returns {Promise<void>}
 */
export async function markAllNotificationsRead() {
  const userId = await getCurrentUserId()
  if (!userId) return

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('recipient_user_id', userId)
    .eq('read', false)

  if (error) {
    console.error('[notifications] markAllNotificationsRead failed:', error.message)
  }
}

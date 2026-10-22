import { supabase } from './supabase'

/**
 * Notification Service — Supabase-backed.
 *
 * Schema (migrations 20260626161400 + 20261022170000):
 *
 *   notifications (
 *     id                uuid PK,
 *     recipient_user_id uuid → users(id) ON DELETE CASCADE,
 *     actor_user_id     uuid → users(id) ON DELETE CASCADE,
 *     type              notification_type ENUM ('follow','reaction','comment',
 *                         'friend_started','review_like','list_comment','mention',
 *                         'qa_answer','qa_best','qa_stuck_answered','admin_report'),
 *     entity_id         text,
 *     payload           jsonb  -- ids + short title snapshots for render/route
 *     read              boolean DEFAULT false,
 *     created_at        timestamptz DEFAULT now()
 *   )
 *
 * RLS: recipient_user_id = auth.uid() for SELECT and UPDATE; clients may
 * only UPDATE the read column. Rows are written exclusively by SECURITY
 * DEFINER triggers — the client never inserts.
 *
 * user_notification_prefs holds PUSH switches only (N-2 reads them).
 * In-app rows are created regardless.
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
      'id, type, entity_id, payload, read, created_at, ' +
        'actor:users!notifications_actor_user_id_fkey(id, username, display_name, avatar_url)'
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
 * Mark specific notifications read — the rows the inbox is showing.
 *
 * @param {string[]} ids
 */
export async function markNotificationsRead(ids) {
  if (!ids || ids.length === 0) return

  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .in('id', ids)
    .eq('read', false)

  if (error) {
    console.error('[notifications] markNotificationsRead failed:', error.message)
  }
}

/* ============================================================
   Push preferences (user_notification_prefs)
   ============================================================ */

/** Switch key → column. No row means every switch is on. */
export const PUSH_PREF_COLUMNS = {
  follows: 'push_follows',
  likes: 'push_likes',
  commentsMentions: 'push_comments_mentions',
  qa: 'push_qa',
  friendsActivity: 'push_friends_activity',
  admin: 'push_admin',
}

const DEFAULT_PUSH_PREFS = Object.freeze(
  Object.fromEntries(Object.keys(PUSH_PREF_COLUMNS).map((key) => [key, true]))
)

function rowToPrefs(row) {
  const prefs = { ...DEFAULT_PUSH_PREFS }
  if (!row) return prefs
  for (const [key, column] of Object.entries(PUSH_PREF_COLUMNS)) {
    if (typeof row[column] === 'boolean') prefs[key] = row[column]
  }
  return prefs
}

/**
 * The signed-in user's push switches. Returns null when the read fails so
 * the screen can say so instead of showing defaults it never loaded.
 *
 * @returns {Promise<Object|null>}
 */
export async function getPushPrefs() {
  const userId = await getCurrentUserId()
  if (!userId) return null

  const { data, error } = await supabase
    .from('user_notification_prefs')
    .select(Object.values(PUSH_PREF_COLUMNS).join(', '))
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[notifications] getPushPrefs failed:', error.message)
    return null
  }
  return rowToPrefs(data)
}

/**
 * Set one push switch. Update first, insert when the row does not exist
 * yet — the client has no UPDATE grant on user_id, so an upsert (which
 * rewrites every sent column on conflict) is not available.
 *
 * @param {keyof PUSH_PREF_COLUMNS} key
 * @param {boolean} value
 */
export async function setPushPref(key, value) {
  const column = PUSH_PREF_COLUMNS[key]
  if (!column) throw new Error(`Unknown push preference: ${key}`)
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to change notifications.')

  const { data, error } = await supabase
    .from('user_notification_prefs')
    .update({ [column]: value })
    .eq('user_id', userId)
    .select('user_id')

  if (error) {
    console.error('[notifications] setPushPref failed:', error.message)
    throw new Error(error.message)
  }
  if (data && data.length > 0) return

  const { error: insertErr } = await supabase
    .from('user_notification_prefs')
    .insert({ user_id: userId, [column]: value })

  if (insertErr) {
    // Another device created the row in between — apply as an update.
    if (insertErr.code === '23505') return setPushPref(key, value)
    console.error('[notifications] setPushPref insert failed:', insertErr.message)
    throw new Error(insertErr.message)
  }
}

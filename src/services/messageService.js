import { supabase } from './supabase'
import { loadBlockedIds, isMutuallyBlocked } from './blockService'

/**
 * Direct Messages Service — Supabase-backed.
 *
 * Sprint 6 P2: powers the /messages inbox, the /messages/:username
 * thread page, the unread-dot badge on the Profile tab in the bottom
 * nav, and the mark-as-read flow when a recipient opens a thread.
 *
 * Schema (mirrored from supabase/direct_messages.sql — run that file
 * in the Supabase SQL editor before this code is exercised):
 *
 *   CREATE TABLE direct_messages (
 *     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     sender_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *     recipient_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *     body          text CHECK (length(body) BETWEEN 1 AND 4000),
 *     attachment    jsonb DEFAULT NULL,
 *     read_at       timestamptz,
 *     created_at    timestamptz NOT NULL DEFAULT now(),
 *     CHECK (sender_id != recipient_id),
 *     CONSTRAINT dm_body_or_attachment CHECK (body IS NOT NULL OR attachment IS NOT NULL)
 *   );
 *
 * Attachment shape (when present):
 *   {
 *     type:      'game' | 'review' | 'list',
 *     id:        string,
 *     title:     string,
 *     cover_url: string | null,
 *     subtitle:  string | null,   // developer / "@user's review" / "N games"
 *     url_path:  string,          // e.g. /game/123, /reviews/abc, /list/xyz
 *   }
 *
 *   CREATE INDEX dm_recipient_idx ON direct_messages(recipient_id, created_at DESC);
 *   CREATE INDEX dm_thread_idx ON direct_messages(
 *     LEAST(sender_id, recipient_id),
 *     GREATEST(sender_id, recipient_id),
 *     created_at
 *   );
 *
 *   ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY dm_select_participant ON direct_messages
 *     FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);
 *   CREATE POLICY dm_insert_self ON direct_messages
 *     FOR INSERT WITH CHECK (auth.uid() = sender_id);
 *   CREATE POLICY dm_update_recipient ON direct_messages
 *     FOR UPDATE USING (auth.uid() = recipient_id);
 *
 * Mirrors src/services/commentService.js + likeService.js:
 *   - all writes resolve auth.uid() from supabase.auth.getUser()
 *   - mutation errors are logged via console.error and re-thrown so
 *     callers can roll back optimistic UI
 *   - reads fail soft (return [] / 0) so a flaky network never blocks
 *     render; participants who can't be resolved show "Unknown user"
 *
 * RLS doubles as the authorisation model: a user trying to read a
 * thread they aren't part of via direct URL gets back zero rows.
 */

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error) {
    console.error('[messages] auth.getUser failed:', error.message)
    return null
  }
  return user?.id || null
}

/* ============================================================
   Reads
   ============================================================ */

/**
 * One row per conversation partner with the latest message preview
 * and unread count.
 *
 * Implementation note: Postgres has DISTINCT ON, but PostgREST exposes
 * it only via custom RPCs. To stay schema-only we issue a single
 * SELECT for every message the current user is part of (already
 * filtered by RLS) and collapse the rows client-side. For Sprint 6
 * scale (a small handful of conversations per user) this is well
 * inside the round-trip budget; once a user has thousands of
 * conversations we should swap this for an RPC that runs DISTINCT ON
 * (LEAST/GREATEST(sender_id, recipient_id)) ORDER BY created_at DESC.
 *
 * Each returned row is shaped for direct render in MessagesInbox:
 *
 *   {
 *     partnerId: string,
 *     partner: { id, username, display_name, avatar_url },
 *     lastMessage: {
 *       id, body, sender_id, recipient_id, read_at, created_at,
 *     },
 *     unreadCount: number,   // messages from partner with read_at IS NULL
 *   }
 *
 * Sorted newest-first by lastMessage.created_at.
 */
export async function getInbox() {
  const userId = await getCurrentUserId()
  if (!userId) return []

  // Sprint 7 — hydrate the block cache so the post-fetch filter
  // below has the latest blocked-set. Inbox rows come back joined
  // on BOTH sender + recipient via embedded selects so a server-side
  // not.in is awkward (we'd need to filter the joined column, not
  // the row column). Post-filtering once on `partnerId` is cheaper
  // and keeps the surrounding query identical.
  await loadBlockedIds()

  // Pull every message the current user can see (RLS already scopes
  // this to "I'm sender or I'm recipient"). Joined twice on users so
  // we have both ends without a follow-up round-trip.
  const { data, error } = await supabase
    .from('direct_messages')
    .select(
      `
        id,
        sender_id,
        recipient_id,
        body,
        attachment,
        read_at,
        created_at,
        sender:users!sender_id(id, username, display_name, avatar_url),
        recipient:users!recipient_id(id, username, display_name, avatar_url)
      `
    )
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[messages] getInbox failed:', error.message)
    return []
  }

  const conversations = new Map()
  for (const row of data || []) {
    const partnerId = row.sender_id === userId ? row.recipient_id : row.sender_id
    const partner = row.sender_id === userId ? row.recipient : row.sender
    let entry = conversations.get(partnerId)
    if (!entry) {
      entry = {
        partnerId,
        partner: partner || {
          id: partnerId,
          username: '',
          display_name: '',
          avatar_url: null,
        },
        lastMessage: row,
        unreadCount: 0,
      }
      conversations.set(partnerId, entry)
    }
    // The query is sorted DESC, so the first row we see for a partner
    // is the latest — keep it as the preview.
    if (!entry.lastMessage || new Date(row.created_at) > new Date(entry.lastMessage.created_at)) {
      entry.lastMessage = row
    }
    // Unread = sent BY partner TO me, not yet marked read.
    if (row.recipient_id === userId && row.sender_id === partnerId && !row.read_at) {
      entry.unreadCount += 1
    }
  }

  // Sprint 7 — hide entire conversations whose partner is blocked
  // (either direction). Done after the conversation rollup so the
  // unread counts we keep are still accurate for the visible threads.
  const all = Array.from(conversations.values()).filter(
    (c) => !isMutuallyBlocked(c.partnerId)
  )

  return all.sort(
    (a, b) =>
      new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at)
  )
}

/**
 * Every message between the current user and `otherUserId`, ordered
 * created_at ASC so the thread page reads top→bottom in posting
 * order. Includes both directions of the conversation.
 *
 * Joins each row to its sender so the bubble can render the avatar
 * + display name without a follow-up round-trip — important for the
 * realtime subscription which appends rows one at a time.
 *
 * @param {string} otherUserId
 * @returns {Promise<Array<{
 *   id: string,
 *   sender_id: string,
 *   recipient_id: string,
 *   body: string,
 *   read_at: string | null,
 *   created_at: string,
 *   sender: { id: string, username: string, display_name: string, avatar_url: string } | null,
 * }>>}
 */
export async function getThread(otherUserId) {
  if (!otherUserId) return []
  const userId = await getCurrentUserId()
  if (!userId) return []

  // Sprint 7 — refuse to load a thread with a blocked partner. The
  // server-side filter is moot here because both participants are
  // by definition allowed to see the thread (via RLS), so we do the
  // policy-level block check client-side.
  await loadBlockedIds()
  if (isMutuallyBlocked(otherUserId)) return []

  // Match both directions of the pair. RLS enforces the participant
  // check too, but filtering server-side here keeps the wire payload
  // lean.
  const { data, error } = await supabase
    .from('direct_messages')
    .select(
      `
        id,
        sender_id,
        recipient_id,
        body,
        attachment,
        read_at,
        created_at,
        sender:users!sender_id(id, username, display_name, avatar_url)
      `
    )
    .or(
      `and(sender_id.eq.${userId},recipient_id.eq.${otherUserId}),` +
        `and(sender_id.eq.${otherUserId},recipient_id.eq.${userId})`
    )
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[messages] getThread failed:', error.message)
    return []
  }
  return data || []
}

/**
 * Total number of unread messages addressed to the current user.
 * Drives the copper dot on the Profile bottom-nav tab via the
 * UnreadMessagesProvider. Soft-fails to 0.
 */
export async function getUnreadCount() {
  const userId = await getCurrentUserId()
  if (!userId) return 0
  const { count, error } = await supabase
    .from('direct_messages')
    .select('*', { count: 'exact', head: true })
    .eq('recipient_id', userId)
    .is('read_at', null)
  if (error) {
    console.error('[messages] getUnreadCount failed:', error.message)
    return 0
  }
  return count || 0
}

/* ============================================================
   Mutations
   ============================================================ */

/**
 * INSERT a new message from the current user to `recipientId`.
 *
 * Accepts either a plain-text `body`, a rich `attachment` object, or
 * both (body becomes a caption shown above the card). At least one of
 * the two must be supplied — the table CHECK constraint enforces this
 * server-side as well.
 *
 * Returns the inserted row joined with the sender's user fields so
 * the caller can append it to its in-memory thread with the avatar +
 * display name already populated.
 *
 * @param {{
 *   recipientId: string,
 *   body?: string,
 *   attachment?: {
 *     type: 'game'|'review'|'list',
 *     id: string,
 *     title: string,
 *     cover_url: string|null,
 *     subtitle: string|null,
 *     url_path: string,
 *   }|null,
 * }} args
 * @returns {Promise<{
 *   id: string,
 *   sender_id: string,
 *   recipient_id: string,
 *   body: string|null,
 *   attachment: object|null,
 *   read_at: string|null,
 *   created_at: string,
 *   sender: { id: string, username: string, display_name: string, avatar_url: string }|null,
 * }>}
 */
export async function sendMessage({ recipientId, body, attachment = null }) {
  if (!recipientId) throw new Error('recipientId is required')
  const trimmed = (body || '').trim() || null
  if (trimmed && trimmed.length > 4000) {
    throw new Error('Message is too long (max 4000 characters).')
  }
  if (!trimmed && !attachment) {
    throw new Error('Message cannot be empty.')
  }

  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to send a message.')
  if (userId === recipientId) {
    throw new Error("You can't message yourself.")
  }

  // Sprint 7 — refuse to send a message to a blocked user (either
  // direction). The block table is hidden via RLS for the recipient
  // so the canonical enforcement is on the read side, but failing
  // fast here gives the sender a friendlier error than waiting for
  // the message to be silently filtered out at receive time.
  await loadBlockedIds()
  if (isMutuallyBlocked(recipientId)) {
    throw new Error("You can't message this user.")
  }

  const insert = {
    sender_id: userId,
    recipient_id: recipientId,
    ...(trimmed ? { body: trimmed } : {}),
    ...(attachment ? { attachment } : {}),
  }

  const { data, error } = await supabase
    .from('direct_messages')
    .insert(insert)
    .select(
      `
        id,
        sender_id,
        recipient_id,
        body,
        attachment,
        read_at,
        created_at,
        sender:users!sender_id(id, username, display_name, avatar_url)
      `
    )
    .single()

  if (error) {
    console.error('[messages] sendMessage failed:', error.message)
    // The isMutuallyBlocked() pre-check above is a fast-path — it only
    // catches blocks already reflected in our locally-cached block set.
    // If the partner blocked us (or we blocked them) on another device
    // since our cache last hydrated, the insert reaches Postgres and the
    // dm_insert_self RLS policy (block check added in 20260801010205)
    // rejects it with 42501 (insufficient_privilege —
    // PostgREST's shape for a WITH CHECK failure). Map that to the same
    // friendly copy as the pre-check instead of surfacing the raw
    // "new row violates row-level security policy" text in the toast.
    if (error.code === '42501') {
      throw new Error("You can't message this user.")
    }
    throw new Error(error.message)
  }

  // Tell the rest of the app a new message exists so the unread-count
  // provider, the inbox, and any other surface stays in lockstep
  // without each having to subscribe to realtime independently.
  emitMessagesChanged()

  return data
}

/**
 * Mark every message in the thread between the current user and
 * `otherUserId` (where the current user is the recipient) as read.
 *
 * Idempotent — re-running on an already-read thread is a no-op
 * because the WHERE filters by `read_at IS NULL`. RLS additionally
 * enforces that only the recipient may flip the field.
 */
export async function markThreadAsRead(otherUserId) {
  if (!otherUserId) return
  const userId = await getCurrentUserId()
  if (!userId) return

  const { error } = await supabase
    .from('direct_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', userId)
    .eq('sender_id', otherUserId)
    .is('read_at', null)

  if (error) {
    console.error('[messages] markThreadAsRead failed:', error.message)
    return
  }

  emitMessagesChanged()
}

/* ============================================================
   Shared-game context
   ============================================================ */

/**
 * Returns the first game that both `uid1` and `uid2` have in their
 * Supabase-backed tracker (any status except 'want'). Used to show
 * the "you both played <game>" context line in the DM thread header.
 *
 * Soft-fails to null — a failed query never blocks render.
 *
 * @param {string} uid1
 * @param {string} uid2
 * @returns {Promise<{ gameId: number, gameTitle: string|null, gameImage: string|null }|null>}
 */
export async function getSharedGame(uid1, uid2) {
  if (!uid1 || !uid2 || uid1 === uid2) return null

  const [r1, r2] = await Promise.all([
    supabase
      .from('game_trackers')
      .select('igdb_game_id, game_title, game_image, status')
      .eq('user_id', uid1)
      .neq('status', 'want'),
    supabase
      .from('game_trackers')
      .select('igdb_game_id')
      .eq('user_id', uid2)
      .neq('status', 'want'),
  ])

  if (r1.error || r2.error) return null

  const partnerSet = new Set((r2.data || []).map((r) => String(r.igdb_game_id)))
  const shared = (r1.data || []).find((r) => partnerSet.has(String(r.igdb_game_id)))
  if (!shared) return null

  return {
    gameId: shared.igdb_game_id,
    gameTitle: shared.game_title || null,
    gameImage: shared.game_image || null,
  }
}

/**
 * Small identity-forward stats surfaced on the DM thread's empty state
 * ("142 games · follows you"). Both fields are independently optional —
 * this never fabricates a number or a relationship; a failed/absent
 * value comes back as `null`/`false` so the caller can omit that half
 * of the line rather than render a guess.
 *
 * `games_trackers` is publicly readable (mirrors the Profile stat
 * card's `getTrackedGamesCountForUser`), and `follows` has an
 * open SELECT policy, so both reads work for any signed-in viewer.
 *
 * @param {string} partnerId
 * @returns {Promise<{ gamesCount: number|null, followsYou: boolean }>}
 */
export async function getPartnerHighlights(partnerId) {
  const empty = { gamesCount: null, followsYou: false }
  if (!partnerId) return empty
  const userId = await getCurrentUserId()
  if (!userId || userId === partnerId) return empty

  const [gamesRes, followRes] = await Promise.all([
    supabase
      .from('game_trackers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', partnerId),
    supabase
      .from('follows')
      .select('follower_id')
      .eq('follower_id', partnerId)
      .eq('followee_id', userId)
      .maybeSingle(),
  ])

  if (gamesRes.error) {
    console.error('[messages] getPartnerHighlights (games) failed:', gamesRes.error.message)
  }
  if (followRes.error) {
    console.error('[messages] getPartnerHighlights (follow) failed:', followRes.error.message)
  }

  return {
    gamesCount: gamesRes.error ? null : gamesRes.count ?? 0,
    followsYou: !followRes.error && !!followRes.data,
  }
}

/* ============================================================
   Cross-surface change event
   ============================================================ */

/**
 * Fired whenever the current user sends a message or marks a thread
 * as read. The UnreadMessagesProvider listens for this so the unread
 * dot on the Profile bottom-nav tab updates without waiting for the
 * realtime echo (which can arrive 50-200ms later).
 *
 *   detail: { kind: 'sent' | 'read' }
 */
export const MESSAGES_CHANGED_EVENT = 'messagesChanged'

function emitMessagesChanged(kind = 'changed') {
  try {
    window.dispatchEvent(
      new CustomEvent(MESSAGES_CHANGED_EVENT, { detail: { kind } })
    )
  } catch {
    // SSR / no-window — best effort.
  }
}

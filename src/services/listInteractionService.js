import { supabase } from './supabase'
import { applyBlockFilter, filterBlockedRows } from './blockService'

/**
 * List Interaction Service — comments + saves on custom lists.
 *
 * Schema (run supabase/list_interactions.sql before exercising this):
 *
 *   list_comments (
 *     id         uuid PK,
 *     list_id    uuid NOT NULL → lists(id) CASCADE,
 *     user_id    uuid NOT NULL → users(id) CASCADE,
 *     body       text CHECK(length 1–2000),
 *     created_at timestamptz,
 *     updated_at timestamptz
 *   )
 *
 *   list_saves (
 *     id         uuid PK,
 *     list_id    uuid NOT NULL → lists(id) CASCADE,
 *     user_id    uuid NOT NULL → users(id) CASCADE,
 *     created_at timestamptz,
 *     UNIQUE(list_id, user_id)
 *   )
 *
 * Blocked-user exclusion is applied client-side via applyBlockFilter /
 * filterBlockedRows (same pattern as commentService.js).
 */

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error) {
    console.error('[list-interactions] auth.getUser failed:', error.message)
    return null
  }
  return user?.id || null
}

/* ============================================================
   Comments — reads
   ============================================================ */

/**
 * Fetch all comments for a list, newest-last, joined with the author's
 * user fields. Blocked authors are excluded client-side.
 *
 * @param {string} listId
 * @returns {Promise<Array>}
 */
export async function getListComments(listId) {
  if (!listId) return []
  let query = supabase
    .from('list_comments')
    .select('*, users(username, display_name, avatar_url)')
    .eq('list_id', listId)
    .order('created_at', { ascending: true })
  query = await applyBlockFilter(query, 'user_id')
  const { data, error } = await query
  if (error) {
    console.error('[list-interactions] getListComments failed:', error.message)
    return []
  }
  return filterBlockedRows(data || [], 'user_id')
}

/**
 * Count of comments on a list (excluding blocked users).
 *
 * @param {string} listId
 * @returns {Promise<number>}
 */
export async function getListCommentCount(listId) {
  if (!listId) return 0
  let query = supabase
    .from('list_comments')
    .select('*', { count: 'exact', head: true })
    .eq('list_id', listId)
  query = await applyBlockFilter(query, 'user_id')
  const { count, error } = await query
  if (error) {
    console.error('[list-interactions] getListCommentCount failed:', error.message)
    return 0
  }
  return count || 0
}

/* ============================================================
   Comments — mutations
   ============================================================ */

/**
 * POST a comment on a list. Returns the inserted row with author fields.
 *
 * @param {{ listId: string, body: string }} args
 */
export async function postListComment({ listId, body }) {
  if (!listId) throw new Error('listId is required')
  const trimmed = (body || '').trim()
  if (!trimmed) throw new Error('Comment cannot be empty.')
  if (trimmed.length > 2000) throw new Error('Comment is too long (max 2000 characters).')

  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to comment.')

  const { data, error } = await supabase
    .from('list_comments')
    .insert({ list_id: listId, user_id: userId, body: trimmed })
    .select('*, users(username, display_name, avatar_url)')
    .single()

  if (error) {
    console.error('[list-interactions] postListComment failed:', error.message)
    throw new Error(error.message)
  }
  return data
}

/**
 * DELETE a comment. Author or list owner may call this (RLS enforces
 * the correct server-side check). No-ops when the row is already gone.
 *
 * @param {string} commentId
 */
export async function deleteListComment(commentId) {
  if (!commentId) throw new Error('commentId is required')
  const { error } = await supabase
    .from('list_comments')
    .delete()
    .eq('id', commentId)
  if (error) {
    console.error('[list-interactions] deleteListComment failed:', error.message)
    throw new Error(error.message)
  }
}

/* ============================================================
   Saves — reads
   ============================================================ */

/**
 * Returns the save count + whether the current user has saved the list.
 *
 * @param {string} listId
 * @param {string|null} userId  Current user's id (or null when signed-out)
 * @returns {Promise<{ count: number, saved: boolean }>}
 */
export async function getListSaveState(listId, userId) {
  if (!listId) return { count: 0, saved: false }
  const { data, error } = await supabase
    .from('list_saves')
    .select('user_id')
    .eq('list_id', listId)
  if (error) {
    console.error('[list-interactions] getListSaveState failed:', error.message)
    return { count: 0, saved: false }
  }
  const rows = data || []
  return {
    count: rows.length,
    saved: userId ? rows.some((r) => r.user_id === userId) : false,
  }
}

/* ============================================================
   Saves — mutations
   ============================================================ */

/**
 * Save a list. Idempotent — a duplicate (23505) is swallowed so
 * optimistic UI races don't surface as errors.
 *
 * @param {string} listId
 */
export async function saveList(listId) {
  if (!listId) throw new Error('listId is required')
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to save a list.')
  const { error } = await supabase
    .from('list_saves')
    .insert({ list_id: listId, user_id: userId })
  if (error) {
    if (error.code === '23505') return
    console.error('[list-interactions] saveList failed:', error.message)
    throw new Error(error.message)
  }
}

/**
 * Un-save a list. No-op when no row exists.
 *
 * @param {string} listId
 */
export async function unsaveList(listId) {
  if (!listId) throw new Error('listId is required')
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to unsave a list.')
  const { error } = await supabase
    .from('list_saves')
    .delete()
    .eq('list_id', listId)
    .eq('user_id', userId)
  if (error) {
    console.error('[list-interactions] unsaveList failed:', error.message)
    throw new Error(error.message)
  }
}

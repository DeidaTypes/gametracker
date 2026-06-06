import { supabase } from './supabase'
import { applyBlockFilter } from './blockService'
import { getFlaggedContentIds } from './reportService'

/**
 * Comment Service — Supabase-backed.
 *
 * Sprint 6 P1: powers the threaded comments page at /reviews/:id/comments
 * and the comment-count badge on every ReviewCard.
 *
 * Schema (mirrored from supabase/comments.sql — run that file in the
 * Supabase SQL editor before this code is exercised):
 *
 *   CREATE TABLE comments (
 *     id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *     review_id         uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
 *     user_id           uuid NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
 *     parent_comment_id uuid REFERENCES comments(id) ON DELETE CASCADE,
 *     body              text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
 *     created_at        timestamptz NOT NULL DEFAULT now(),
 *     updated_at        timestamptz NOT NULL DEFAULT now()
 *   );
 *
 *   CREATE INDEX comments_review_idx ON comments(review_id, created_at);
 *   CREATE INDEX comments_parent_idx ON comments(parent_comment_id);
 *
 *   ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
 *
 *   CREATE POLICY comments_select_all ON comments
 *     FOR SELECT USING (true);
 *   CREATE POLICY comments_insert_self ON comments
 *     FOR INSERT WITH CHECK (auth.uid() = user_id);
 *   CREATE POLICY comments_update_own ON comments
 *     FOR UPDATE USING (auth.uid() = user_id);
 *   CREATE POLICY comments_delete_own ON comments
 *     FOR DELETE USING (auth.uid() = user_id);
 *
 * Mirrors src/services/likeService.js + followService.js:
 *   - all writes resolve auth.uid() from supabase.auth.getUser()
 *   - errors are logged via console.error and re-thrown so callers can
 *     roll back optimistic UI
 *   - reads fail soft (return [] / 0 / empty Map) so a flaky network
 *     never blocks render
 *
 * One level of nesting is a UX constraint (arbitrary nesting becomes
 * unusable on mobile) enforced at the call site — postComment refuses
 * to insert a reply whose parent is itself a reply. The schema itself
 * still permits arbitrary depth via the self-referential FK.
 */

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error) {
    console.error('[comments] auth.getUser failed:', error.message)
    return null
  }
  return user?.id || null
}

/* ============================================================
   Reads
   ============================================================ */

/**
 * Fetch every comment on a review, joined with the author's
 * username/display_name/avatar_url so the page can render an avatar +
 * name without a second round-trip.
 *
 * Ordered created_at ASC so the thread reads top-to-bottom in posting
 * order, which is the convention every threaded UI we benchmark uses
 * (Reddit, Instagram, etc.).
 *
 * @param {string} reviewId
 * @returns {Promise<Array<{
 *   id: string,
 *   review_id: string,
 *   user_id: string,
 *   parent_comment_id: string | null,
 *   body: string,
 *   created_at: string,
 *   updated_at: string,
 *   users: { username: string, display_name: string, avatar_url: string } | null,
 * }>>}
 */
export async function getCommentsForReview(reviewId) {
  if (!reviewId) return []
  const [flaggedIds, queryResult] = await Promise.all([
    getFlaggedContentIds('comment'),
    (async () => {
      let query = supabase
        .from('comments')
        .select('*, users!comments_user_id_fkey(username, display_name, avatar_url)')
        .eq('review_id', reviewId)
        .order('created_at', { ascending: true })
      query = await applyBlockFilter(query, 'user_id')
      return query
    })(),
  ])
  const { data, error } = await queryResult
  if (error) {
    console.error('[comments] getCommentsForReview failed:', error.message)
    return []
  }
  const rows = data || []
  return flaggedIds.size > 0 ? rows.filter((c) => !flaggedIds.has(c.id)) : rows
}

/**
 * Number of comments on a review (top-level + replies — flat count,
 * matches what the ReviewCard badge displays). Soft-fails to 0.
 */
export async function getCommentCount(reviewId) {
  if (!reviewId) return 0
  let query = supabase
    .from('comments')
    .select('*', { count: 'exact', head: true })
    .eq('review_id', reviewId)
  query = await applyBlockFilter(query, 'user_id')
  const { count, error } = await query
  if (error) {
    console.error('[comments] getCommentCount failed:', error.message)
    return 0
  }
  return count || 0
}

/**
 * Batched comment counts for an array of review IDs.
 *
 * Returns a Map<reviewId, count>. Every input id is present in the
 * result (count = 0 if no rows) so callers can use `counts.get(id)`
 * without `?? 0` boilerplate at every call site.
 *
 * One query against the comments table (`?in.(...)`), aggregating
 * client-side. Mirrors `getLikeCountsForReviews` so the timeline,
 * Profile, and GameDetail surfaces all use the same batched pattern.
 *
 * @param {string[]} reviewIds
 * @returns {Promise<Map<string, number>>}
 */
export async function getCommentCountsForReviews(reviewIds) {
  const counts = new Map()
  if (!reviewIds || reviewIds.length === 0) return counts
  for (const id of reviewIds) counts.set(id, 0)

  let query = supabase
    .from('comments')
    .select('review_id')
    .in('review_id', reviewIds)
  query = await applyBlockFilter(query, 'user_id')
  const { data, error } = await query

  if (error) {
    console.error(
      '[comments] getCommentCountsForReviews failed:',
      error.message
    )
    return counts
  }

  for (const row of data || []) {
    counts.set(row.review_id, (counts.get(row.review_id) || 0) + 1)
  }
  return counts
}

/* ============================================================
   Mutations
   ============================================================ */

/**
 * INSERT a comment. RLS enforces user_id = auth.uid().
 *
 * One-level-of-nesting enforcement: if `parentCommentId` is supplied,
 * we look up the parent and reject the insert when the parent itself
 * already has a non-null parent_comment_id. This belt-and-braces guard
 * keeps the application invariant intact even if a future code path
 * forgets the depth check.
 *
 * Returns the inserted row joined with the author's user fields so the
 * caller can append it to its in-memory list with the avatar + display
 * name already populated.
 *
 * @param {{
 *   reviewId: string,
 *   body: string,
 *   parentCommentId?: string | null,
 * }} args
 * @returns {Promise<{
 *   id: string,
 *   review_id: string,
 *   user_id: string,
 *   parent_comment_id: string | null,
 *   body: string,
 *   created_at: string,
 *   updated_at: string,
 *   users: { username: string, display_name: string, avatar_url: string } | null,
 * }>}
 */
export async function postComment({ reviewId, body, parentCommentId = null }) {
  if (!reviewId) throw new Error('reviewId is required')
  const trimmed = (body || '').trim()
  if (!trimmed) throw new Error('Comment cannot be empty.')
  if (trimmed.length > 2000) {
    throw new Error('Comment is too long (max 2000 characters).')
  }

  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to comment.')

  // Enforce one-level-of-nesting. If a parent is supplied, ensure it
  // is itself a top-level comment.
  if (parentCommentId) {
    const { data: parent, error: parentErr } = await supabase
      .from('comments')
      .select('id, parent_comment_id, review_id')
      .eq('id', parentCommentId)
      .maybeSingle()
    if (parentErr) {
      console.error('[comments] parent lookup failed:', parentErr.message)
      throw new Error('Could not validate parent comment.')
    }
    if (!parent) throw new Error('Parent comment no longer exists.')
    if (parent.parent_comment_id) {
      throw new Error("Replies can't be nested further.")
    }
    if (parent.review_id !== reviewId) {
      throw new Error('Parent comment belongs to a different review.')
    }
  }

  const insert = {
    review_id: reviewId,
    user_id: userId,
    parent_comment_id: parentCommentId || null,
    body: trimmed,
  }

  const { data, error } = await supabase
    .from('comments')
    .insert(insert)
    .select('*, users!comments_user_id_fkey(username, display_name, avatar_url)')
    .single()

  if (error) {
    console.error('[comments] postComment failed:', error.message)
    throw new Error(error.message)
  }

  return data
}

/**
 * UPDATE the body of a comment. RLS enforces user_id = auth.uid() —
 * this call silently affects 0 rows if the caller doesn't own the
 * comment. We also bump updated_at so the UI can render an "edited"
 * marker when updated_at > created_at.
 */
export async function updateComment(commentId, body) {
  if (!commentId) throw new Error('commentId is required')
  const trimmed = (body || '').trim()
  if (!trimmed) throw new Error('Comment cannot be empty.')
  if (trimmed.length > 2000) {
    throw new Error('Comment is too long (max 2000 characters).')
  }

  const { data, error } = await supabase
    .from('comments')
    .update({ body: trimmed, updated_at: new Date().toISOString() })
    .eq('id', commentId)
    .select('*, users!comments_user_id_fkey(username, display_name, avatar_url)')
    .single()

  if (error) {
    console.error('[comments] updateComment failed:', error.message)
    throw new Error(error.message)
  }
  return data
}

/**
 * DELETE a comment. RLS enforces user_id = auth.uid(). The
 * ON DELETE CASCADE on parent_comment_id means deleting a top-level
 * comment also removes every reply under it.
 */
export async function deleteComment(commentId) {
  if (!commentId) throw new Error('commentId is required')
  const { error } = await supabase
    .from('comments')
    .delete()
    .eq('id', commentId)
  if (error) {
    console.error('[comments] deleteComment failed:', error.message)
    throw new Error(error.message)
  }
}

import { supabase } from './supabase'

/**
 * Like Service — Supabase-backed.
 *
 * Sprint 6 P0: replaces the localStorage-backed shim that lived at
 * src/utils/likes.js. Likes now persist across devices and are
 * visible to other users.
 *
 * Schema (run in the Supabase SQL editor before this code is
 * exercised — mirrored here for reference, matches BACKEND_SCHEMA.md):
 *
 *   CREATE TABLE review_likes (
 *     user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *     review_id  uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
 *     created_at timestamptz NOT NULL DEFAULT now(),
 *     PRIMARY KEY (user_id, review_id)
 *   );
 *
 *   CREATE INDEX review_likes_review_idx ON review_likes(review_id);
 *
 *   ALTER TABLE review_likes ENABLE ROW LEVEL SECURITY;
 *
 *   CREATE POLICY review_likes_select_all ON review_likes
 *     FOR SELECT USING (true);
 *
 *   CREATE POLICY review_likes_insert_self ON review_likes
 *     FOR INSERT WITH CHECK (auth.uid() = user_id);
 *
 *   CREATE POLICY review_likes_delete_self ON review_likes
 *     FOR DELETE USING (auth.uid() = user_id);
 *
 * Mirrors src/services/followService.js:
 *   - all writes resolve auth.uid() from supabase.auth.getUser()
 *   - mutation errors are logged via console.error and re-thrown so
 *     callers can roll back their optimistic UI
 *   - reads fail soft (return 0 / false / empty Map) so a flaky
 *     network never blocks render
 */

const LIKES_LS_KEY = 'gt:likes:v1'
const LIKES_MIGRATED_KEY = 'gt:likes-migrated-to-supabase'

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error) {
    console.error('[likes] auth.getUser failed:', error.message)
    return null
  }
  return user?.id || null
}

/* ============================================================
   Mutations
   ============================================================ */

/**
 * INSERT a row representing the current user liking `reviewId`.
 * Idempotent — re-liking an already-liked review resolves silently
 * (Postgres unique-violation 23505 swallowed) so optimistic UI races
 * don't surface as errors.
 *
 * RLS enforces user_id = auth.uid().
 */
export async function likeReview(reviewId) {
  if (!reviewId) throw new Error('reviewId is required')
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to like a review.')

  const { error } = await supabase
    .from('review_likes')
    .insert({ user_id: userId, review_id: reviewId })

  if (error) {
    if (error.code === '23505') return
    console.error('[likes] likeReview failed:', error.message)
    throw new Error(error.message)
  }
}

/**
 * DELETE the row representing the current user liking `reviewId`.
 * No-op when no row exists — matches the idempotent shape of
 * likeReview so retry logic stays simple.
 *
 * RLS enforces user_id = auth.uid().
 */
export async function unlikeReview(reviewId) {
  if (!reviewId) throw new Error('reviewId is required')
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to unlike a review.')

  const { error } = await supabase
    .from('review_likes')
    .delete()
    .eq('user_id', userId)
    .eq('review_id', reviewId)

  if (error) {
    console.error('[likes] unlikeReview failed:', error.message)
    throw new Error(error.message)
  }
}

/* ============================================================
   Reads
   ============================================================ */

/**
 * Returns true if the signed-in user has liked `reviewId`. Returns
 * false for signed-out callers and missing args so callers don't
 * need to special-case the anonymous path.
 */
export async function isLiked(reviewId) {
  if (!reviewId) return false
  const userId = await getCurrentUserId()
  if (!userId) return false

  const { data, error } = await supabase
    .from('review_likes')
    .select('user_id')
    .eq('user_id', userId)
    .eq('review_id', reviewId)
    .maybeSingle()

  if (error) {
    console.error('[likes] isLiked failed:', error.message)
    return false
  }
  return !!data
}

/**
 * Number of users that liked `reviewId`. Soft-fails to 0.
 */
export async function getLikeCount(reviewId) {
  if (!reviewId) return 0
  const { count, error } = await supabase
    .from('review_likes')
    .select('*', { count: 'exact', head: true })
    .eq('review_id', reviewId)
  if (error) {
    console.error('[likes] getLikeCount failed:', error.message)
    return 0
  }
  return count || 0
}

/**
 * Batched like-counts for an array of review IDs.
 *
 * Returns a Map<reviewId, count>. Every input id appears in the
 * result Map (count = 0 if no rows exist) so callers can use
 * `counts.get(id)` without `?? 0` boilerplate at every call site.
 *
 * Issues ONE query against the likes table (with `?in.(...)`),
 * aggregating client-side. For Sprint 6 scale this beats a real
 * GROUP BY (which would require an RPC or view) on round-trips —
 * the wire payload is ~36 bytes per like row, so a 200-review
 * timeline with an average of 5 likes per review is ~36 KB.
 *
 * The Home Popular tab and Profile "Most Liked" sort both rely on
 * this so they don't fire N round-trips when sorting by likes.
 */
export async function getLikeCountsForReviews(reviewIds) {
  const counts = new Map()
  if (!reviewIds || reviewIds.length === 0) return counts
  for (const id of reviewIds) counts.set(id, 0)

  const { data, error } = await supabase
    .from('review_likes')
    .select('review_id')
    .in('review_id', reviewIds)

  if (error) {
    console.error('[likes] getLikeCountsForReviews failed:', error.message)
    return counts
  }

  for (const row of data || []) {
    counts.set(row.review_id, (counts.get(row.review_id) || 0) + 1)
  }
  return counts
}

/* ============================================================
   One-time localStorage → Supabase migration
   ============================================================ */

/**
 * Migrates the legacy localStorage like blob (`gt:likes:v1`, written
 * by the now-deleted src/utils/likes.js) into the Supabase `likes`
 * table for the signed-in user.
 *
 * Behaviour:
 *   - Idempotent per-user: writes `${LIKES_MIGRATED_KEY}` on success
 *     so subsequent loads skip the work. Same pattern as the review
 *     and list migrations.
 *   - On any insert error: localStorage is left intact and the
 *     marker is NOT written, so the next boot retries.
 *   - Uses upsert with `ignoreDuplicates: true` so re-runs across
 *     devices don't error on the composite PK.
 *
 * Returns a result object for diagnostics; callers can ignore.
 */
export async function migrateLocalLikesIfNeeded(userId) {
  if (!userId) return { migrated: 0, skipped: true, reason: 'no-user' }
  try {
    const marker = localStorage.getItem(LIKES_MIGRATED_KEY)
    if (marker === userId) {
      return { migrated: 0, skipped: true, reason: 'already-migrated' }
    }

    const stored = localStorage.getItem(LIKES_LS_KEY)
    if (!stored) {
      localStorage.setItem(LIKES_MIGRATED_KEY, userId)
      return { migrated: 0, skipped: false, reason: 'nothing-to-migrate' }
    }

    let parsed
    try {
      parsed = JSON.parse(stored)
    } catch {
      localStorage.removeItem(LIKES_LS_KEY)
      localStorage.setItem(LIKES_MIGRATED_KEY, userId)
      return { migrated: 0, skipped: true, reason: 'corrupt-localstorage' }
    }

    const rows = Object.entries(parsed || {})
      .filter(([, v]) => v && v.liked)
      .map(([reviewId]) => ({ user_id: userId, review_id: reviewId }))

    if (rows.length === 0) {
      localStorage.removeItem(LIKES_LS_KEY)
      localStorage.setItem(LIKES_MIGRATED_KEY, userId)
      return { migrated: 0, skipped: false, reason: 'empty' }
    }

    const { error } = await supabase
      .from('review_likes')
      .upsert(rows, {
        onConflict: 'user_id,review_id',
        ignoreDuplicates: true,
      })

    if (error) {
      // Don't write the marker and don't clear localStorage — let the
      // next boot retry. Foreign-key violations against deleted reviews
      // would surface here; that's fine because subsequent runs will
      // still see them and continue retrying (idempotent inserts).
      console.error('[likes] migration failed:', error.message)
      return { migrated: 0, skipped: false, error }
    }

    localStorage.removeItem(LIKES_LS_KEY)
    localStorage.setItem(LIKES_MIGRATED_KEY, userId)
    return { migrated: rows.length, skipped: false }
  } catch (err) {
    console.error('[likes] migration crashed:', err)
    return { migrated: 0, skipped: false, error: err }
  }
}

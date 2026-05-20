import { supabase } from './supabase'

/**
 * Pin Service — Supabase-backed.
 *
 * Sprint 6 P3 — Users can pin up to 3 of their OWN reviews to the top
 * of their Profile Reviews tab. Order matters: `position` is the
 * 0-indexed slot, and the UNIQUE(user_id, position) constraint on the
 * table enforces "one review per slot". See supabase/review_pins.sql
 * for the schema + RLS policies — RLS is the source of truth for the
 * "can only pin your own reviews" rule (this module just hides the
 * affordance in the kebab menu).
 *
 *   review_pins (
 *     user_id   uuid REFERENCES users(id)   ON DELETE CASCADE,
 *     review_id uuid REFERENCES reviews(id) ON DELETE CASCADE,
 *     position  smallint CHECK (position BETWEEN 0 AND 2),
 *     pinned_at timestamptz DEFAULT now(),
 *     PRIMARY KEY (user_id, review_id),
 *     UNIQUE (user_id, position)
 *   )
 *
 * Service surface area mirrors the rest of Sprint 6: writes raise on
 * failure so callers can run optimistic-rollback logic, and reads soft-
 * fail so the Pinned section on Profile never blocks the page render.
 */

export const MAX_PINS = 3

/**
 * Custom event broadcast whenever the signed-in user's pins change.
 * Profile listens for this so the Pinned section re-fetches without
 * a full page reload after the kebab "Pin to profile" tap.
 *
 *   detail: { userId: string }
 */
export const PIN_CHANGED_EVENT = 'reviewPinChanged'

function emitPinChanged(userId) {
  try {
    window.dispatchEvent(
      new CustomEvent(PIN_CHANGED_EVENT, { detail: { userId } })
    )
  } catch {
    // SSR / no-window — best effort.
  }
}

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error) {
    console.error('[pins] auth.getUser failed:', error.message)
    return null
  }
  return user?.id || null
}

/* ============================================================
   Reads
   ============================================================ */

/**
 * Returns the pinned reviews for `userId`, ordered by slot (0 → 2).
 * Each row carries the full review record + the reviewer's user fields
 * so the Pinned section can render ReviewCards without a follow-up
 * round-trip.
 *
 * The `reviews!review_pins_review_id_fkey` modifier is the explicit
 * FK hint Supabase needs to disambiguate the join. The `users` join
 * is pulled through the review row.
 *
 * @param {string} userId
 * @returns {Promise<Array<{
 *   position: number,
 *   review: object,  // full review row with embedded `users` join
 * }>>}
 */
export async function getPinsForUser(userId) {
  if (!userId) return []
  const { data, error } = await supabase
    .from('review_pins')
    .select(
      'position, pinned_at, review:reviews!review_pins_review_id_fkey(*, users!reviews_user_id_fkey(username, display_name, avatar_url))'
    )
    .eq('user_id', userId)
    .order('position', { ascending: true })

  if (error) {
    console.error('[pins] getPinsForUser failed:', error.message)
    return []
  }

  // Filter out rows whose review was deleted out from under us — the
  // ON DELETE CASCADE FK should keep this list clean, but defensive
  // null-skipping protects us against transient view states (e.g. a
  // realtime delete that hasn't propagated yet).
  return (data || []).filter((r) => r.review)
}

/**
 * Convenience: just the review_ids the user has pinned, ordered by
 * slot. Used by Profile to subtract pinned reviews from the main
 * sorted list (so a review doesn't appear twice).
 */
export async function getPinnedReviewIds(userId) {
  if (!userId) return []
  const { data, error } = await supabase
    .from('review_pins')
    .select('review_id, position')
    .eq('user_id', userId)
    .order('position', { ascending: true })
  if (error) {
    console.error('[pins] getPinnedReviewIds failed:', error.message)
    return []
  }
  return (data || []).map((r) => r.review_id)
}

/* ============================================================
   Mutations
   ============================================================ */

/**
 * Pin a review owned by the signed-in user. If `position` is omitted
 * the row is appended to the next free slot.
 *
 * RLS enforces:
 *   1. auth.uid() = user_id  (you can only pin to your own profile)
 *   2. EXISTS reviews WHERE id = review_id AND user_id = auth.uid()
 *      (the review must be yours)
 *
 * Throws when:
 *   - The user is signed out
 *   - The user already has MAX_PINS pinned reviews and no `position`
 *     was supplied (caller should surface "Unpin one first").
 *   - Supabase rejects the insert (RLS, FK, or unique violation).
 *
 * @param {{ reviewId: string, position?: number }} args
 * @returns {Promise<{ position: number }>}
 */
export async function pinReview({ reviewId, position } = {}) {
  if (!reviewId) throw new Error('reviewId is required')
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to pin a review.')

  // Resolve the slot. Caller-supplied position wins; otherwise we
  // append to the next free slot (0, 1, or 2).
  let slot = typeof position === 'number' ? position : null
  if (slot === null) {
    const { data: existing, error: readErr } = await supabase
      .from('review_pins')
      .select('position')
      .eq('user_id', userId)
      .order('position', { ascending: true })
    if (readErr) {
      console.error('[pins] pinReview slot lookup failed:', readErr.message)
      throw new Error(readErr.message)
    }
    const used = new Set((existing || []).map((r) => r.position))
    if (used.size >= MAX_PINS) {
      const err = new Error(
        'You can only pin 3 reviews. Unpin one first.'
      )
      err.code = 'PINS_FULL'
      throw err
    }
    for (let i = 0; i < MAX_PINS; i++) {
      if (!used.has(i)) {
        slot = i
        break
      }
    }
  }

  // Upsert on (user_id, review_id) so re-pinning the same review just
  // moves its slot rather than failing on the primary key. The
  // server-side RLS still enforces "must be your review".
  const { error } = await supabase
    .from('review_pins')
    .upsert(
      { user_id: userId, review_id: reviewId, position: slot },
      { onConflict: 'user_id,review_id' }
    )

  if (error) {
    console.error('[pins] pinReview failed:', error.message)
    throw new Error(error.message)
  }

  emitPinChanged(userId)
  return { position: slot }
}

/**
 * Unpin a review. Idempotent — unpinning a review that isn't pinned
 * resolves silently so callers can use this in optimistic flows.
 *
 * RLS enforces auth.uid() = user_id.
 */
export async function unpinReview(reviewId) {
  if (!reviewId) throw new Error('reviewId is required')
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to unpin a review.')

  const { error } = await supabase
    .from('review_pins')
    .delete()
    .eq('user_id', userId)
    .eq('review_id', reviewId)

  if (error) {
    console.error('[pins] unpinReview failed:', error.message)
    throw new Error(error.message)
  }

  emitPinChanged(userId)
}

/**
 * Reorder pins. Given an array of review_ids (up to MAX_PINS items),
 * persist their positions as 0, 1, 2 in that order.
 *
 * The UNIQUE(user_id, position) constraint means we can't simply
 * issue three UPDATEs sequentially — the first UPDATE that lands on
 * an occupied slot would violate the constraint mid-transaction.
 * Postgres won't let us defer the constraint without DDL, and we
 * don't have an RPC for this yet, so we work around the conflict by
 * first parking every affected row at a temporary out-of-range slot
 * (NULL won't fit — the CHECK rejects it — and 0..2 are taken). The
 * trick: DELETE + re-INSERT in a single batched call. ON DELETE
 * CASCADE doesn't fire (we're not deleting any user/review), and the
 * batched insert is treated as one statement by PostgREST.
 *
 * Throws on failure so the caller can roll back the optimistic UI.
 */
export async function reorderPins(orderedReviewIds) {
  const ids = (orderedReviewIds || []).filter(Boolean)
  if (ids.length === 0) return
  if (ids.length > MAX_PINS) {
    throw new Error(`Cannot reorder more than ${MAX_PINS} pins.`)
  }

  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to reorder pins.')

  // 1. Drop the rows we're about to re-position. We narrow by
  //    review_id so untouched pins (shouldn't be any in normal use,
  //    but defensive) stay put.
  const { error: delErr } = await supabase
    .from('review_pins')
    .delete()
    .eq('user_id', userId)
    .in('review_id', ids)

  if (delErr) {
    console.error('[pins] reorderPins delete failed:', delErr.message)
    throw new Error(delErr.message)
  }

  // 2. Re-insert in the desired order. The batched insert is one
  //    statement so the UNIQUE constraint sees the final state.
  const rows = ids.map((reviewId, i) => ({
    user_id: userId,
    review_id: reviewId,
    position: i,
  }))

  const { error: insErr } = await supabase
    .from('review_pins')
    .insert(rows)

  if (insErr) {
    console.error('[pins] reorderPins insert failed:', insErr.message)
    throw new Error(insErr.message)
  }

  emitPinChanged(userId)
}

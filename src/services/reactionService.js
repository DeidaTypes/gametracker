import { supabase } from './supabase'

/**
 * Reaction Service — cross-surface emoji reactions backed by Supabase.
 *
 * Schema (see supabase/reactions.sql):
 *   reactions (user_id, target_type, target_id, emoji, created_at)
 *   UNIQUE (user_id, target_type, target_id, emoji)
 *
 * target_type: 'review' | 'list' | 'activity' | 'comment'
 * target_id:   UUID string for all current target types
 *
 * Follows the same conventions as likeService.js:
 *   - addReaction idempotent (23505 swallowed)
 *   - removeReaction no-op when row missing
 *   - reads fail soft (return [] / empty Map)
 *   - mutation errors logged + re-thrown so callers can roll back optimistic UI
 */

async function getCurrentUserId() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error) {
    console.error('[reactions] auth.getUser failed:', error.message)
    return null
  }
  return user?.id || null
}

/* ============================================================
   Mutations
   ============================================================ */

/**
 * Add an emoji reaction. Idempotent — re-adding the same reaction
 * resolves silently (unique violation 23505 swallowed) so optimistic
 * UI races don't surface as errors.
 */
export async function addReaction(targetType, targetId, emoji) {
  if (!targetType || !targetId || !emoji) throw new Error('addReaction: missing args')
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to react.')

  const { error } = await supabase
    .from('reactions')
    .insert({ user_id: userId, target_type: targetType, target_id: targetId, emoji })

  if (error) {
    if (error.code === '23505') return
    console.error('[reactions] addReaction failed:', error.message)
    throw new Error(error.message)
  }
}

/**
 * Remove an emoji reaction. No-op when the row doesn't exist.
 */
export async function removeReaction(targetType, targetId, emoji) {
  if (!targetType || !targetId || !emoji) throw new Error('removeReaction: missing args')
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('You must be signed in to remove a reaction.')

  const { error } = await supabase
    .from('reactions')
    .delete()
    .eq('user_id', userId)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .eq('emoji', emoji)

  if (error) {
    console.error('[reactions] removeReaction failed:', error.message)
    throw new Error(error.message)
  }
}

/* ============================================================
   Reads
   ============================================================ */

/**
 * Returns the reaction summary for one target:
 *   [{ emoji, count, reacted }]
 *
 * Entries with count === 0 are never returned. The caller (useReactions)
 * handles collapsing zero-count entries after optimistic rollback.
 *
 * Two queries total:
 *   1. All reactions for the target (count per emoji)
 *   2. The current user's reactions (which emojis they've used)
 *
 * Signed-out callers get accurate counts; reacted is always false.
 */
export async function getReactions(targetType, targetId) {
  if (!targetType || !targetId) return []

  const [{ data: rows, error: rowsErr }, userResult] = await Promise.all([
    supabase
      .from('reactions')
      .select('emoji')
      .eq('target_type', targetType)
      .eq('target_id', targetId),
    supabase.auth.getUser(),
  ])

  if (rowsErr) {
    console.error('[reactions] getReactions failed:', rowsErr.message)
    return []
  }

  const countMap = new Map()
  for (const { emoji } of rows || []) {
    countMap.set(emoji, (countMap.get(emoji) || 0) + 1)
  }

  let reactedSet = new Set()
  const me = userResult?.data?.user
  if (me) {
    const { data: mine } = await supabase
      .from('reactions')
      .select('emoji')
      .eq('user_id', me.id)
      .eq('target_type', targetType)
      .eq('target_id', targetId)
    for (const { emoji } of mine || []) reactedSet.add(emoji)
  }

  return Array.from(countMap.entries()).map(([emoji, count]) => ({
    emoji,
    count,
    reacted: reactedSet.has(emoji),
  }))
}

/**
 * Batch-fetch reactions for multiple targets of the same type.
 * Returns Map<targetId, Array<{ emoji, count, reacted }>>
 * Every input id is present in the result map (empty array if no reactions).
 */
export async function getReactionsBatch(targetType, targetIds) {
  const result = new Map()
  if (!targetType || !targetIds || targetIds.length === 0) return result
  for (const id of targetIds) result.set(id, [])

  const [{ data: rows, error: rowsErr }, userResult] = await Promise.all([
    supabase
      .from('reactions')
      .select('target_id, emoji')
      .eq('target_type', targetType)
      .in('target_id', targetIds),
    supabase.auth.getUser(),
  ])

  if (rowsErr) {
    console.error('[reactions] getReactionsBatch failed:', rowsErr.message)
    return result
  }

  const countMap = new Map()
  for (const { target_id, emoji } of rows || []) {
    const key = `${target_id}::${emoji}`
    countMap.set(key, (countMap.get(key) || 0) + 1)
  }

  let reactedMap = new Map()
  const me = userResult?.data?.user
  if (me) {
    const { data: mine } = await supabase
      .from('reactions')
      .select('target_id, emoji')
      .eq('user_id', me.id)
      .eq('target_type', targetType)
      .in('target_id', targetIds)
    for (const { target_id, emoji } of mine || []) {
      if (!reactedMap.has(target_id)) reactedMap.set(target_id, new Set())
      reactedMap.get(target_id).add(emoji)
    }
  }

  const emojisByTarget = new Map()
  for (const [key, count] of countMap.entries()) {
    const sep = key.indexOf('::')
    const tid = key.slice(0, sep)
    const emoji = key.slice(sep + 2)
    if (!emojisByTarget.has(tid)) emojisByTarget.set(tid, [])
    emojisByTarget.get(tid).push({
      emoji,
      count,
      reacted: reactedMap.get(tid)?.has(emoji) ?? false,
    })
  }

  for (const [tid, summary] of emojisByTarget.entries()) {
    result.set(tid, summary)
  }

  return result
}

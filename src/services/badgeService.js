import { supabase } from './supabase'

/**
 * Upsert a single earned badge for the current user.
 * Called by useBadgeUnlockWatcher when a new badge is detected.
 * Silently no-ops on auth absence or network failure — badge rarity
 * is best-effort; the core badge experience must never break.
 */
export async function syncEarnedBadge(userId, badgeId) {
  if (!userId || !badgeId) return
  const { error } = await supabase
    .from('user_badges')
    .upsert(
      { user_id: userId, badge_id: badgeId },
      { onConflict: 'user_id,badge_id' }
    )
  if (error) {
    console.error('[badges] syncEarnedBadge failed:', error.message)
  }
}

/**
 * Bulk-upsert all earned badge IDs for a user.
 * Called once when the badge system first fully resolves — seeds the
 * server-side count for any badges the user earned before this feature
 * shipped.
 */
export async function syncAllEarnedBadges(userId, badgeIds) {
  if (!userId || !badgeIds?.length) return
  const rows = badgeIds.map((badge_id) => ({ user_id: userId, badge_id }))
  const { error } = await supabase
    .from('user_badges')
    .upsert(rows, { onConflict: 'user_id,badge_id', ignoreDuplicates: true })
  if (error) {
    console.error('[badges] syncAllEarnedBadges failed:', error.message)
  }
}

/**
 * Fetch per-badge rarity stats from the badge_rarity() Postgres function.
 *
 * Returns a Map<badgeId, { holderCount, totalUsers, rarityPct }> so
 * badge renders can do O(1) lookups. An empty Map is returned on error
 * so callsites never need to guard for null.
 */
export async function getBadgeRarity() {
  const { data, error } = await supabase.rpc('badge_rarity')
  if (error) {
    console.error('[badges] getBadgeRarity failed:', error.message)
    return new Map()
  }
  const map = new Map()
  for (const row of data || []) {
    map.set(row.badge_id, {
      holderCount: Number(row.holder_count),
      totalUsers: Number(row.total_users),
      rarityPct: Number(row.rarity_pct),
    })
  }
  return map
}

/**
 * Fetch the showcase_badges array for a given user.
 * Returns an ordered array of up to 3 badge ID strings.
 */
export async function getShowcaseBadges(userId) {
  if (!userId) return []
  const { data, error } = await supabase
    .from('users')
    .select('showcase_badges')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('[badges] getShowcaseBadges failed:', error.message)
    return []
  }
  return data?.showcase_badges || []
}

/**
 * Persist an updated showcase_badges array (max 3) for the current user.
 * Throws on failure so callers can roll back optimistic state if needed.
 */
export async function updateShowcaseBadges(userId, badgeIds) {
  if (!userId) return
  const clamped = (badgeIds || []).slice(0, 3)
  const { error } = await supabase
    .from('users')
    .update({ showcase_badges: clamped })
    .eq('id', userId)
  if (error) {
    console.error('[badges] updateShowcaseBadges failed:', error.message)
    throw error
  }
}

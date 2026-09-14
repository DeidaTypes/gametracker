import { supabase } from './supabase'
import { BADGES, TIER_RANK } from '../data/badges'

/** Catalogue version stamped on users.badge_backfill_version. */
export const BADGE_BACKFILL_VERSION = 1

const backfillInflight = new Map()

/**
 * Expand RPC family-rows ({ badge_id, tier }) into the earned per-tier
 * badge objects the UI already renders. Wave 3 definitions never earn
 * (isEarned is hard-locked false) and are skipped even if a stray row
 * appeared. Only real Wave 1 / promoted Wave 2 grants are returned.
 */
export function expandGrantedBadgeTiers(rows) {
  const granted = []
  for (const row of rows || []) {
    if (!row?.badge_id || !row.tier) continue
    const grantedRank = TIER_RANK[row.tier]
    if (grantedRank == null) continue
    for (const badge of BADGES) {
      if (badge.family !== row.badge_id) continue
      if (badge.wave === 3) continue
      if ((TIER_RANK[badge.tier] ?? 99) <= grantedRank) {
        granted.push(badge)
      }
    }
  }
  return granted
}

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
 * Ask the server to recompute the CURRENT user's Sprint 16 tiered badges
 * (see recompute_my_badges() in
 * supabase/migrations/20260914190930_badge_tiers_persistence.sql).
 *
 * Fire-and-forget, exactly like syncEarnedBadge above — badge progress is
 * best-effort and must never block or roll back the write that triggered
 * it. Call this after any write that could move a Sprint 16 badge
 * (session logged/stopped, journal entry saved, review posted/edited, a
 * game's tracker status changes) — see the call sites in sessionService,
 * journalService, reviewService, and libraryService.setGameStatus.
 *
 * There is deliberately no user-id argument: the RPC always operates on
 * auth.uid(), so this can only ever recompute the calling user's own
 * badges — e.g. liking someone else's review cannot be used to force a
 * recompute of THEIR Resonant count. That means Resonant (hearts
 * received) only updates the next time the review's OWNER makes one of
 * their own qualifying writes, not the instant the like happens — see the
 * chat report for why that lag is an accepted tradeoff, not a bug.
 *
 * Dispatches a `badgesUpdated` window event on success so any mounted
 * `useBadges()` re-reads the fresh persisted state without a page reload.
 */
export async function recomputeBadges(options = {}) {
  const allowCompletionTierDrop = options.allowCompletionTierDrop === true
  const { error } = await supabase.rpc(
    'recompute_my_badges',
    allowCompletionTierDrop ? { p_allow_completion_tier_drop: true } : {}
  )
  if (error) {
    console.error('[badges] recomputeBadges failed:', error.message)
    return
  }
  try {
    window.dispatchEvent(new Event('badgesUpdated'))
  } catch {
    // SSR / no-window — skip.
  }
}

function notifyBadgesUpdated() {
  try {
    window.dispatchEvent(new Event('badgesUpdated'))
  } catch {
    // SSR / no-window — skip.
  }
}

/**
 * One-time first-launch backfill. Calls backfill_my_badges() which
 * runs the unchanged S16-4 RPC, stamps celebrated_at on every earned
 * family, and sets users.badge_backfill_version = 1.
 *
 * Deduped per user for the life of the tab — subsequent launches hit
 * the RPC's version short-circuit (returns empty, no recompute).
 *
 * Returns { grants, alreadyDone, failed }. grants is empty when the
 * user has zero earned tiers (brand-new account) OR when the marker
 * is already set — the summary screen treats both as "do not show".
 */
export function backfillMyBadges(userId) {
  if (!userId) return Promise.resolve({ grants: [], alreadyDone: true, failed: false })
  const cached = backfillInflight.get(userId)
  if (cached) return cached

  const pending = (async () => {
    const { data, error } = await supabase.rpc('backfill_my_badges')
    if (error) {
      console.error('[badges] backfillMyBadges failed:', error.message)
      backfillInflight.delete(userId)
      return { grants: [], alreadyDone: false, failed: true }
    }
    const rows = (data || [])
      .map((row) => ({
        badge_id: row.family_id ?? row.badge_id,
        tier: row.granted_tier ?? row.tier,
        current_value: row.metric_value ?? row.current_value,
      }))
      .filter((row) => row.badge_id && row.tier)
    const grants = expandGrantedBadgeTiers(rows)
    notifyBadgesUpdated()
    return { grants, alreadyDone: grants.length === 0, failed: false }
  })()

  backfillInflight.set(userId, pending)
  return pending
}

/**
 * Stamp celebrated_at on a Sprint 16 family after a genuine unlock
 * overlay. No-op if already set. Uses a SECURITY DEFINER RPC because
 * user_badges has no client UPDATE policy.
 */
export async function acknowledgeBadgeCelebration(badgeFamilyId) {
  if (!badgeFamilyId) return
  const { error } = await supabase.rpc('acknowledge_my_badge', {
    p_badge_id: badgeFamilyId,
  })
  if (error) {
    console.error('[badges] acknowledgeBadgeCelebration failed:', error.message)
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

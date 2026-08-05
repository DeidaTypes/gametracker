import { supabase } from './supabase'

/**
 * Invite / referral service.
 *
 * Flow:
 *   1. Inviter opens Settings → "Invite friends" uses buildInviteUrl(userId)
 *      which embeds their user ID as ?ref=<userId>.
 *
 *   2. Invitee clicks the link (web or via Capacitor appUrlOpen):
 *        - Web cold start  → captureWebReferral() runs in main.jsx before React
 *          mounts, reads ?ref= from window.location.search.
 *        - Native cold start / warm open → appLifecycle.js calls
 *          capturePendingReferral() from the appUrlOpen / getLaunchUrl handlers.
 *      Either path persists the inviter ID to localStorage.
 *
 *   3. Invitee signs up → SignUp.jsx calls convertReferral(newUserId) which
 *      writes an authenticated INSERT to the `referrals` table (RLS: invitee
 *      must be the calling user). Clears the localStorage key on success.
 *
 *   4. Inviter's next session: useUserStats calls getInviteStats(userId) which
 *      counts their converted referral rows. Badge system reacts automatically.
 *
 * Fraud prevention:
 *   - UNIQUE on referrals.invitee_id → an invitee can only be claimed once.
 *   - Self-invite is blocked: convertReferral skips if invitee === inviter.
 *   - The INSERT RLS policy enforces invitee_id === auth.uid().
 */

const PENDING_REF_KEY = 'gt:pending-ref:v1'

// The `referrals` table ships with supabase/invite_referrals.sql, a manual-run
// file that is not applied in every environment. Where it is absent, Profile
// was paying a 404 round-trip per visit (twice, once per useUserStats caller).
// Latch the absence for the session rather than re-asking.
let _referralsTableMissing = false

function isMissingRelation(error) {
  if (!error) return false
  return error.code === 'PGRST205' || error.code === '42P01' ||
    /does not exist|could not find the table/i.test(error.message || '')
}
const BASE_URL = 'https://gametracker.app'

/**
 * Build a shareable invite URL containing the inviter's user ID.
 * Falls back to the static app URL when userId is unavailable.
 */
export function buildInviteUrl(userId) {
  const base =
    typeof window !== 'undefined' ? window.location.origin : BASE_URL
  if (!userId) return base
  return `${base}/?ref=${encodeURIComponent(userId)}`
}

/**
 * Persist a pending referral to localStorage so it survives navigation to
 * /login → /signup. Called by captureWebReferral (web) and appLifecycle
 * (native) immediately when a ref param is detected.
 */
export function capturePendingReferral(referrerId) {
  if (!referrerId || typeof referrerId !== 'string') return
  try {
    localStorage.setItem(PENDING_REF_KEY, referrerId.trim())
  } catch {
    // localStorage unavailable — best effort.
  }
}

export function readPendingReferral() {
  try {
    return localStorage.getItem(PENDING_REF_KEY) || null
  } catch {
    return null
  }
}

export function clearPendingReferral() {
  try {
    localStorage.removeItem(PENDING_REF_KEY)
  } catch {
    // noop
  }
}

/**
 * Parse ?ref= from the current browser URL and store it. Called once in
 * main.jsx before React mounts so it survives the /login → /signup redirect.
 * No-op outside a browser context.
 */
export function captureWebReferral() {
  if (typeof window === 'undefined') return
  try {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')
    if (ref) capturePendingReferral(ref)
  } catch {
    // Malformed URL — ignore.
  }
}

/**
 * Called after a successful signup.  Reads the pending referrer from
 * localStorage and, if present and valid, inserts a conversion row in
 * the `referrals` table.
 *
 * Fire-and-forget from the caller's perspective: this never throws.
 *
 * @param {string} inviteeId - UUID of the newly created user.
 */
export async function convertReferral(inviteeId) {
  if (!inviteeId) return
  const inviterId = readPendingReferral()
  if (!inviterId) return
  // Prevent self-invite.
  if (inviterId === inviteeId) {
    clearPendingReferral()
    return
  }

  // Optimistically clear — even if the insert fails, we don't want to
  // retry and risk a duplicate on the next signup attempt.
  clearPendingReferral()

  try {
    const { error } = await supabase.from('referrals').insert({
      inviter_id: inviterId,
      invitee_id: inviteeId,
      converted_at: new Date().toISOString(),
    })
    if (error && error.code !== '23505') {
      // 23505 = unique_violation: invitee already claimed — safe to ignore.
      console.warn('[inviteService] convertReferral failed:', error.message)
    }
  } catch (err) {
    console.warn('[inviteService] convertReferral threw:', err)
  }
}

/**
 * Count of successfully converted invites for this user (as inviter).
 * Used by useUserStats to feed the invite badge progress.
 *
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function getInviteStats(userId) {
  if (!userId) return 0
  if (_referralsTableMissing) return 0
  try {
    const { count, error } = await supabase
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('inviter_id', userId)
    if (error) {
      if (isMissingRelation(error)) {
        _referralsTableMissing = true
        console.warn('[inviteService] referrals table is not deployed — invite stats disabled')
        return 0
      }
      console.warn('[inviteService] getInviteStats failed:', error.message)
      return 0
    }
    return count || 0
  } catch {
    return 0
  }
}

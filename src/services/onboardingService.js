import { supabase } from './supabase'

/**
 * Sprint 7.6 — Onboarding service.
 *
 * Source of truth for whether a user has completed the first-time
 * onboarding flow. The `users.onboarded_at` column drives the gate:
 *   NULL  → redirect to /onboarding
 *   value → let them through
 *
 * The localStorage flag in userPreferences (`onboarded: true`) acts as
 * a fast-path cache so returning sessions don't flash the redirect while
 * the Supabase profile row is still loading.
 */

/**
 * Mark the current user as having completed (or skipped) onboarding.
 * Sets `onboarded_at = now()` in the `users` table.
 *
 * Soft-fails — a network error should never block the user from
 * reaching Home. The localStorage flag is already set by the caller
 * before this is called, so the guard won't re-fire.
 *
 * @param {string} userId  UUID matching `users.id`
 * @returns {Promise<boolean>} true on success, false on failure
 */
export async function completeOnboarding(userId) {
  if (!userId) return false
  try {
    const { error } = await supabase
      .from('users')
      .update({ onboarded_at: new Date().toISOString() })
      .eq('id', userId)
    if (error) {
      console.error('[onboarding] completeOnboarding failed:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error('[onboarding] completeOnboarding threw:', err)
    return false
  }
}

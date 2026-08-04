/**
 * Local User Data — single source of truth for "wipe every local trace of
 * the previously-signed-in account from this device."
 *
 * Background (the "sign up as a new email, still see the previous account's
 * library" bug):
 *
 * Earlier fixes addressed the *Supabase auth session* race (see auth.js —
 * clearLocalSession(), and AuthContext.jsx's explicit-op authority window).
 * That work is correct and necessary, but it only ever touched the Supabase
 * client's own session/token. The auth identity was in fact switching
 * correctly: a new signup got a new auth.users row and a new uuid.
 *
 * The remaining problem was local-first state. GameTracker caches a lot of
 * account-shaped data — profile, the tracker library, reviews/likes/lists
 * migration blobs, badges, swipe/taste history, search history, stats
 * counters — in plain, un-namespaced keys (`userProfile`, `gameLibrary`)
 * that were never cleared on sign-out and are read synchronously, before
 * any Supabase round trip, by screens like Profile and Home.
 *
 * That made it more than a display bug. `syncTrackersWithServer()` PUSHES
 * the local `gameLibrary` to `game_trackers` for whoever is signed in, and
 * the reviews/lists/likes migrations only skip when their marker matches the
 * *current* user id — so a brand-new account didn't just render the previous
 * account's data, it had that data written into it server-side. A verified
 * instance copied all 43 of the previous account's trackers into a new
 * account 1.1s after signup.
 *
 * This module is the single place that knows about every such key, so future
 * additions don't reintroduce the bug piecemeal. Ownership is tracked with a
 * stamp (`OWNER_KEY`) holding the user id the on-device data belongs to;
 * `syncLocalDataOwner()` compares that stamp to whoever just authenticated
 * and wipes when they disagree. Everything here is synchronous and issues no
 * Supabase calls, so it is safe to run from inside the auth-state-change
 * listener (see the DEADLOCK HAZARD note in services/auth.js).
 */

import { clearProfile } from './profileService'
import { clearLibrary } from './libraryService'
import { clearListsMigrationMarker } from './listService'
import { clearLegacyLikesData } from './likeService'
import { clearReviewCache, clearLocalReviewsLegacyData } from './reviewService'
import { clearPreferences } from './userPreferences'
import { clearLocalSwipes } from './swipeService'
import { clearBlockCache } from './blockService'
import { clearSWRCache } from './swrCache'
import { invalidateActivityCache } from './statsService'
import { clearAccountScopedSettings } from './userSettingsService'

/**
 * User id whose data currently sits on this device. Absent means "unknown
 * provenance" — see syncLocalDataOwner() for how that case is resolved.
 */
const OWNER_KEY = 'gt:local-data-owner:v1'

// Keys owned by hook/component files rather than a service module. Cleared
// by literal key here (instead of importing the owning React
// hook/component into this plain service module, which would risk a
// circular import back through AuthContext) — each is cross-referenced to
// its owning file so the two never drift apart silently.
const RAW_LOCAL_STORAGE_KEYS = [
  'gt:earnedBadges:v1', // src/hooks/useBadgeUnlockWatcher.js — per-device "already toasted" badge set
  'gt:comments-count', // src/hooks/useUserStats.js
  'gt:shares-count', // src/hooks/useUserStats.js
  'gt:reactions:v1', // src/components/ActivityTimeline.jsx — reactions keyed by activity id
  'gt:profile-sort:v1', // src/pages/Profile.jsx — reviews-tab sort preference
  'gt:recents:v1', // src/utils/recentSearches.js — per-tab Search screen recents
  'gameWishlist', // src/pages/Wishlist.jsx
]

const RAW_SESSION_STORAGE_KEYS = [
  'gt:swipe-deck-state:v1', // src/components/explore/SwipeDeck.jsx
  'gt:swipe-session-adds:v1', // src/services/swipeService.js — per-session backlog add count
]

// Deliberately NOT cleared:
//   gt:milestone-seen:v1:{userId}:*  (streakMilestoneService)
//   gt:nudge-seen:v1:{userId}:*      (useProgressNudges)
//     Both already carry the user id in the key, so they cannot bleed
//     between accounts.
//   gt:pending-ref:v1                (inviteService)
//     Referral attribution for the signup that is about to happen — wiping
//     it here would drop the referrer on the very flow it exists to serve.
//   Game/IGDB caches (search_cache_v1, gt:ttb:v2, gameColorCache_v1, ...)
//     Not account data; re-fetching them would only cost bandwidth.

/**
 * Synchronously wipe every local-first cache that mirrors account data.
 * Safe to call even when some keys are already absent. Never throws —
 * sign-out/sign-in must never fail because a cleanup step hiccuped.
 */
export function clearAllLocalUserData() {
  // Persisted, account-shaped state.
  clearProfile()
  clearLibrary()
  clearListsMigrationMarker()
  clearLegacyLikesData()
  clearLocalReviewsLegacyData()
  clearPreferences()
  clearLocalSwipes()
  clearAccountScopedSettings()

  // In-memory caches. These outlive a React unmount, so a user switch
  // inside one app session would otherwise keep serving the old account
  // from module scope even after storage was cleared.
  clearReviewCache()
  clearBlockCache()
  clearSWRCache()
  invalidateActivityCache()

  for (const key of RAW_LOCAL_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      // best-effort
    }
  }
  for (const key of RAW_SESSION_STORAGE_KEYS) {
    try {
      sessionStorage.removeItem(key)
    } catch {
      // best-effort
    }
  }

  // Module-scope caches inside hook files (like/reaction state) clear
  // themselves off this event. Broadcasting keeps the teardown central
  // without dragging React hooks into a plain service's import graph.
  try {
    window.dispatchEvent(new Event('gt:user-data-cleared'))
  } catch {
    // best-effort
  }
}

function readOwner() {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

function writeOwner(userId) {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId)
    else localStorage.removeItem(OWNER_KEY)
  } catch {
    // best-effort
  }
}

/**
 * Reconcile the on-device data against whoever just authenticated, wiping
 * it when they don't match.
 *
 * @param {string|null} userId  the newly-authoritative user, or null for signed-out
 * @param {{ adoptUnstamped?: boolean }} [options]
 *   `adoptUnstamped` claims existing unstamped data for `userId` instead of
 *   wiping it. Pass it only where the data provably belongs to `userId`
 *   already — boot-time session restore, where the device is simply resuming
 *   the session that wrote the data in the first place. Without this, the
 *   first launch after this fix ships would wipe every existing user's
 *   local-only state (progress percentages, swipe history, recents) for no
 *   reason. Explicit sign-in/sign-up must NOT pass it: there, unstamped data
 *   is of unknown provenance and the safe assumption is that it is someone
 *   else's.
 * @returns {boolean} whether a wipe occurred
 */
export function syncLocalDataOwner(userId, { adoptUnstamped = false } = {}) {
  const owner = readOwner()

  if (!userId) {
    clearAllLocalUserData()
    writeOwner(null)
    return true
  }

  if (owner === userId) return false

  if (owner === null && adoptUnstamped) {
    writeOwner(userId)
    return false
  }

  clearAllLocalUserData()
  writeOwner(userId)
  return true
}

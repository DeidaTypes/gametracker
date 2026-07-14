/**
 * Local User Data — single source of truth for "wipe every local trace of
 * the previously-signed-in account from this device."
 *
 * Background (fix attempt #3 for the "sign out, then sign up as a new
 * email, still lands on the previous account" bug):
 *
 * Attempts #1/#2 fixed the *Supabase auth session* race (see auth.js —
 * clearLocalSession(), and AuthContext.jsx's explicit-op authority window).
 * That work is correct and necessary, but it only ever touched the
 * Supabase client's own session/token. Auditing every localStorage/
 * sessionStorage key in the app turned up a second, independent problem:
 * GameTracker's local-first architecture caches a lot of account-shaped
 * data — profile (name/avatar/bio/favorites), the tracker library (Want to
 * Play/Playing/Played/Dropped), reviews/likes/lists migration blobs,
 * badges, swipe/taste history, search history, stats counters — in plain,
 * un-namespaced keys (e.g. `userProfile`, `gameLibrary`) that are NEVER
 * cleared on sign-out and are read directly (synchronously, before any
 * Supabase round trip) by screens like Profile.jsx and Home.jsx. Signing
 * out never touched any of it, so the very next signUp()/logIn() on the
 * same device inherited the previous account's name, avatar, bio, favorite
 * games, and entire game library — indistinguishable, from the user's
 * perspective, from "landing on the previous account," even though the
 * actual authenticated Supabase user was in fact the newly created one.
 *
 * This module is the single place that knows about every such key so
 * future additions don't reintroduce the bug piecemeal. Call
 * `clearAllLocalUserData()` from every place an account's local footprint
 * must be erased: on sign-out (auth.js logOut()) and, as a defense-in-depth
 * backstop, at the start of every fresh signUp()/logIn() (clearLocalSession()).
 */

import { clearProfile } from './profileService'
import { clearLibrary } from './libraryService'
import { clearListsMigrationMarker } from './listService'
import { clearLegacyLikesData } from './likeService'
import { clearReviewCache, clearLocalReviewsLegacyData } from './reviewService'
import { clearPreferences } from './userPreferences'
import { clearSwipes } from './swipeService'
import { clearBlockCache } from './blockService'

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
]

/**
 * Synchronously wipe every local-first cache that mirrors account data.
 * Safe to call even when some keys are already absent. Never throws —
 * sign-out/sign-up must never fail because a cleanup step hiccuped.
 */
export function clearAllLocalUserData() {
  clearProfile()
  clearLibrary()
  clearListsMigrationMarker()
  clearLegacyLikesData()
  clearLocalReviewsLegacyData()
  clearReviewCache()
  clearPreferences()
  clearSwipes()
  clearBlockCache()

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
}

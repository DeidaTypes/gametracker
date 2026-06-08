// Profile Service - manages user profile data

const PROFILE_KEY = 'userProfile'

// Default profile data
const DEFAULT_PROFILE = {
  // No stock/placeholder name — the real name is captured at signup and
  // mirrored here from the authenticated Supabase profile. Leaving this
  // empty means the UI falls back to the server display_name rather than a
  // generic "Game Enthusiast" stand-in.
  displayName: '',
  username: null, // Optional username/handle
  avatar: null, // Base64 or URL
  bio: '',
  // Social handles — stored raw (no leading '@'). The '@' is added at
  // display time only. URL templates are owned by Profile.jsx so the
  // service stays presentation-agnostic.
  instagramHandle: '',
  xHandle: '',
  youtubeHandle: '',
  tiktokHandle: '',
  // Up-to-4 favorite-game cards rendered in the Home tab. Each entry is
  // a slim copy of the IGDB game shape used elsewhere on the profile
  // ({ id, title, image, developer }) so the picker can hand them in
  // without forcing Profile.jsx to round-trip IGDB on render.
  favoriteGames: [],
  // Sprint 7 — banner image stored in Supabase Storage; only the public
  // URL lives here so the Profile screen renders without a round-trip.
  bannerUrl: null,
  createdAt: new Date().toISOString(),
}

// Initialize profile
export function initializeProfile() {
  const existing = getProfile()
  if (!existing) {
    const profile = { ...DEFAULT_PROFILE }
    saveProfile(profile)
    return profile
  }
  // Backfill any new fields that didn't exist when this profile was
  // created so older devices pick up the Sprint 5 socials/favorites
  // defaults without a destructive rewrite.
  let needsSave = false
  for (const key of Object.keys(DEFAULT_PROFILE)) {
    if (existing[key] === undefined) {
      existing[key] = DEFAULT_PROFILE[key]
      needsSave = true
    }
  }
  if (needsSave) saveProfile(existing)
  return existing
}

// Get user profile
export function getProfile() {
  const stored = localStorage.getItem(PROFILE_KEY)
  if (stored) {
    return JSON.parse(stored)
  }
  return null
}

// Save user profile — silently skips if localStorage is unavailable or full.
export function saveProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch (err) {
    console.error('[profile] localStorage write failed:', err)
  }
}

// Update profile fields
export function updateProfile(updates) {
  const profile = getProfile() || initializeProfile()
  const updated = {
    ...profile,
    ...updates,
    updatedAt: new Date().toISOString(),
  }
  saveProfile(updated)
  return updated
}

// Update display name
export function updateDisplayName(displayName) {
  return updateProfile({ displayName })
}

// Update username
export function updateUsername(username) {
  return updateProfile({ username })
}

/**
 * Mirror the authoritative Supabase `users` row into the localStorage
 * profile that the own-profile UI reads synchronously. Called after signup
 * and login so the entered name/username show up immediately and survive a
 * reinstall or a different device.
 *
 * Only copies fields the server actually has a value for, so a handle that
 * only exists locally (set in Edit Profile before this sync shipped) is
 * never clobbered with a server NULL.
 *
 * @param {{ display_name?: string, username?: string|null, bio?: string|null, avatar_url?: string|null } | null} row
 */
export function syncProfileFromSupabase(row) {
  if (!row) return getProfile()
  const profile = getProfile() || initializeProfile()
  const updates = {}
  if (row.display_name && row.display_name !== profile.displayName) {
    updates.displayName = row.display_name
  }
  if (row.username && row.username !== profile.username) {
    updates.username = row.username
  }
  // Sync bio from Supabase when the server has a value. This ensures bio
  // saved via Edit Profile (which now writes to Supabase) survives on other
  // devices and after a localStorage clear.
  if (row.bio != null && row.bio !== profile.bio) {
    updates.bio = row.bio
  }
  // Sync avatar from Supabase storage URL. When the server has an avatar_url,
  // upgrade the local avatar to a URL-type shape so Profile.jsx can render it
  // from the CDN instead of a potentially stale base64 blob.
  if (row.avatar_url && row.avatar_url !== profile.avatarUrl) {
    updates.avatarUrl = row.avatar_url
    updates.avatar = { type: 'url', data: row.avatar_url }
  }
  if (Object.keys(updates).length === 0) return profile
  return updateProfile(updates)
}

// Update bio
export function updateBio(bio) {
  return updateProfile({ bio })
}

// Update avatar
export function updateAvatar(avatar) {
  return updateProfile({ avatar })
}

// Check if username is available (for future reserved handles)
export function isUsernameAvailable(username) {
  // For now, just check basic format
  if (!username) return true
  const pattern = /^[a-zA-Z0-9_]{3,20}$/
  return pattern.test(username)
}

// Generate default avatar from display name
export function generateDefaultAvatar(displayName) {
  const initials = displayName
    .split(' ')
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase()
    .substring(0, 2)
  
  // Create a simple colored circle with initials
  const colors = [
    '#4A9EFF', '#5B9FFF', '#6BAFFF', '#7BBFFF',
    '#8CCFFF', '#9DDFFF', '#AEEFFF', '#BFFFFF'
  ]
  const colorIndex = displayName.charCodeAt(0) % colors.length
  const color = colors[colorIndex]
  
  return {
    type: 'generated',
    initials,
    color,
  }
}


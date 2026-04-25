// Profile Service - manages user profile data

const PROFILE_KEY = 'userProfile'

// Default profile data
const DEFAULT_PROFILE = {
  displayName: 'Game Enthusiast',
  username: null, // Optional username/handle
  avatar: null, // Base64 or URL
  bio: '',
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

// Save user profile
export function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
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


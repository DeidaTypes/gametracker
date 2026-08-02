/**
 * The single "no avatar image" fallback system for the whole app —
 * initials on a color from the --avatar-fallback-* palette in
 * src/styles/theme.css. Used by src/components/Avatar.jsx (the
 * canonical avatar primitive) and by generateDefaultAvatar in
 * src/services/profileService.js, which now delegates here instead of
 * carrying its own copy of the palette.
 *
 * A user's color is picked by hashing a stable seed — their id when
 * one is available, otherwise their name — so the SAME person renders
 * the SAME color on every screen, even if different screens happen to
 * pass slightly different name strings (e.g. "Someone" vs a real
 * display name while data is loading).
 */

const PALETTE = [
  'var(--avatar-fallback-1)',
  'var(--avatar-fallback-2)',
  'var(--avatar-fallback-3)',
  'var(--avatar-fallback-4)',
  'var(--avatar-fallback-5)',
  'var(--avatar-fallback-6)',
  'var(--avatar-fallback-7)',
  'var(--avatar-fallback-8)',
]

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0
  }
  return h
}

/** Up to two uppercase initials from a display name — "Jane Doe" → "JD". */
export function initialsFor(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return '?'
  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/** Picks a palette color by hashing a stable seed (user id or name). */
export function colorForSeed(seed) {
  const key = seed == null ? '' : String(seed)
  if (!key) return PALETTE[0]
  return PALETTE[hashString(key) % PALETTE.length]
}

/**
 * Resolves the {initials, color} fallback for a user. `seed` should be
 * a stable identity (user id) when one is known; falls back to `name`
 * otherwise.
 */
export function getAvatarFallback(name, seed) {
  return {
    initials: initialsFor(name),
    color: colorForSeed(seed != null ? seed : name),
  }
}

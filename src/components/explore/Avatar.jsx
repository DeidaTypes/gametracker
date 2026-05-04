import React from 'react'
import './Avatar.css'

const FALLBACK_COLORS = [
  '#c4634e', '#8d5a3a', '#5a7c8d', '#7a8d5a', '#5a8d7c',
  '#8d5a7c', '#5a5a8d', '#8d7c5a', '#7c5a8d', '#5a8d5a',
]

function colorFor(seed) {
  if (!seed) return FALLBACK_COLORS[0]
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]
}

/**
 * Compact circular avatar for community feed rows.
 *
 * Real reviewers (joined from the `users` table) have an `avatar_url`
 * and `display_name`; mock community users have a `username` +
 * `avatarColor`. We accept both shapes and prefer real data when present.
 */
function Avatar({ user, size = 32 }) {
  if (!user) return null

  const name = user.displayName || user.display_name || user.username || '?'
  const letter = name.slice(0, 1).toUpperCase()
  const avatarUrl = user.avatarUrl || user.avatar_url || null
  const bg = user.avatarColor || colorFor(user.id || name)

  if (avatarUrl) {
    return (
      <img
        className="community-avatar community-avatar--img"
        src={avatarUrl}
        alt={name}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        loading="lazy"
      />
    )
  }

  return (
    <div
      className="community-avatar"
      style={{ width: size, height: size, background: bg, fontSize: Math.round(size * 0.42) }}
      aria-label={name}
    >
      {letter}
    </div>
  )
}

export default Avatar

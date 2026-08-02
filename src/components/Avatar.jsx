import React, { useEffect, useState } from 'react'
import { getAvatarFallback } from '../utils/avatarFallback'
import './Avatar.css'

/** xs/sm/md/lg/xl — the one size scale every avatar in the app uses. */
export const AVATAR_SIZES = { xs: 24, sm: 32, md: 40, lg: 56, xl: 64 }

/**
 * Avatar — the single shared user-avatar primitive for the whole app.
 *
 * Renders the real photo when one loads successfully, and otherwise
 * (no URL, or the image fails to load) falls back to initials on a
 * color from the one app-wide fallback system — see
 * src/utils/avatarFallback.js — so a given user's initials color is
 * consistent on every screen.
 *
 * Accepts either a `user` object (checked for the handful of shapes
 * already in use across the codebase — displayName/display_name/
 * username/name, avatarUrl/avatar_url, id/userId/user_id) or explicit
 * `name` / `avatarUrl` / `seed` overrides for call sites that already
 * have those as separate values rather than one object.
 *
 * By default the avatar is treated as decorative (empty alt / aria-
 * hidden), matching the vast majority of call sites where the name is
 * already shown as visible text next to it. Pass `alt` to make a
 * standalone avatar (no adjacent name text) accessible.
 */
function Avatar({ user, name, avatarUrl, seed, size = 'md', className = '', alt }) {
  const resolvedName =
    name ?? user?.displayName ?? user?.display_name ?? user?.username ?? user?.name ?? ''
  const resolvedUrl = avatarUrl ?? user?.avatarUrl ?? user?.avatar_url ?? null
  const resolvedSeed = seed ?? user?.id ?? user?.userId ?? user?.user_id ?? resolvedName

  const [failed, setFailed] = useState(false)
  // A previously-broken URL shouldn't stay "failed" forever if the
  // avatar this instance renders changes (e.g. a list re-using the row).
  useEffect(() => {
    setFailed(false)
  }, [resolvedUrl])

  const sizeKey = AVATAR_SIZES[size] ? size : 'md'
  const px = AVATAR_SIZES[sizeKey]
  const decorative = alt == null
  const classes = `avatar avatar--${sizeKey}${className ? ` ${className}` : ''}`

  if (resolvedUrl && !failed) {
    return (
      <img
        className={`${classes} avatar--img`}
        src={resolvedUrl}
        alt={alt ?? ''}
        width={px}
        height={px}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    )
  }

  const { initials, color } = getAvatarFallback(resolvedName, resolvedSeed)

  return (
    <div
      className={`${classes} avatar--fallback`}
      style={{ background: color }}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : alt}
    >
      {initials}
    </div>
  )
}

export default Avatar

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getAvatarFallback } from '../utils/avatarFallback'
import { useUserLevel } from '../hooks/useUserLevel'
import { normalizeUserId } from '../services/levelCache'
import LevelRing from './level/LevelRing'
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
 * `userId` is the Checkpoint user the ring belongs to. It is never
 * taken from `seed` or `name`. When `ring` is true (the default), the
 * id is known, and that user's level has loaded, a full tier ring is
 * drawn around the photo. Until then the avatar renders exactly as it
 * does with no ring, so nothing shifts when the color arrives.
 *
 * By default the avatar is treated as decorative (empty alt / aria-
 * hidden), matching the vast majority of call sites where the name is
 * already shown as visible text next to it. Pass `alt` to make a
 * standalone avatar (no adjacent name text) accessible.
 */
function Avatar({
  user,
  userId,
  name,
  avatarUrl,
  seed,
  size = 'md',
  className = '',
  alt,
  ring = true,
}) {
  const resolvedName =
    name ?? user?.displayName ?? user?.display_name ?? user?.username ?? user?.name ?? ''
  const resolvedUrl = avatarUrl ?? user?.avatarUrl ?? user?.avatar_url ?? null
  const resolvedSeed = seed ?? user?.id ?? user?.userId ?? user?.user_id ?? resolvedName
  const resolvedId = normalizeUserId(
    userId ?? user?.id ?? user?.userId ?? user?.user_id ?? null
  )
  const level = useUserLevel(ring ? resolvedId : null)
  // Wrap as soon as the id is known so the caller's class (margins, stack
  // overlap) sits on the same element before and after the level arrives.
  // The ring itself waits for the level — nothing is drawn in its place.
  const showWrap = !!(ring && resolvedId)
  const showRing = showWrap && level != null

  const [failed, setFailed] = useState(false)
  // A previously-broken URL shouldn't stay "failed" forever if the
  // avatar this instance renders changes (e.g. a list re-using the row).
  useEffect(() => {
    setFailed(false)
  }, [resolvedUrl])

  const sizeKey = AVATAR_SIZES[size] ? size : 'md'
  const px = AVATAR_SIZES[sizeKey]
  const decorative = alt == null
  const faceClass = `avatar avatar--${sizeKey}${!showWrap && className ? ` ${className}` : ''}`

  const photoRef = useRef(null)
  const [photoSize, setPhotoSize] = useState(px)
  // Some rows size the photo in CSS (stacks, bylines). The ring has to
  // match that box, and measuring before paint keeps the first ring
  // from popping to the token size and back.
  useLayoutEffect(() => {
    const el = photoRef.current
    if (!el) return
    const w = el.getBoundingClientRect().width
    if (w > 0) {
      setPhotoSize((prev) => (Math.abs(prev - w) < 0.5 ? prev : w))
    }
  }, [px, showRing, resolvedUrl, failed, className])

  const photo =
    resolvedUrl && !failed ? (
      <img
        ref={photoRef}
        className={`${faceClass} avatar--img`}
        src={resolvedUrl}
        alt={alt ?? ''}
        width={px}
        height={px}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    ) : (
      <FallbackFace
        ref={photoRef}
        className={`${faceClass} avatar--fallback`}
        name={resolvedName}
        seed={resolvedSeed}
        decorative={decorative}
        alt={alt}
      />
    )

  if (!showWrap) return photo

  return (
    <span className={`avatar-ringed${className ? ` ${className}` : ''}`}>
      {photo}
      {showRing && (
        <LevelRing level={level} progress={null} photoSize={photoSize} />
      )}
    </span>
  )
}

const FallbackFace = React.forwardRef(function FallbackFace(
  { className, name, seed, decorative, alt },
  ref
) {
  const { initials, color } = getAvatarFallback(name, seed)
  return (
    <div
      ref={ref}
      className={className}
      style={{ background: color }}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : alt}
    >
      {initials}
    </div>
  )
})

export default Avatar

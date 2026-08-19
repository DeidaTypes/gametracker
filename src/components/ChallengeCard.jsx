import { useNavigate } from 'react-router-dom'
import Pressable from './Pressable'

/**
 * Path segment for profile-scoped routes (`/user/:username/...` or
 * `/user/id/:userId/...`). Matches Profile's `profilePathSegment` so Home
 * and Profile land on the same challenge detail screen.
 */
export function challengePathSegment({ username, userId }) {
  if (username) return encodeURIComponent(username)
  if (userId) return `id/${encodeURIComponent(userId)}`
  return null
}

export function challengeDetailPath(profilePathSegment, year) {
  const y = year ?? new Date().getFullYear()
  return `/user/${profilePathSegment}/challenge?year=${y}`
}

/**
 * Shared tappable wrapper for the yearly-challenge card. Home and Profile
 * both render through this so every surface inherits the same destination,
 * label, keyboard activation, and press state — no per-screen onClick.
 *
 * Native <button> (via Pressable) already handles Enter/Space and focus.
 */
export default function ChallengeCard({
  year,
  current,
  target,
  profilePathSegment,
  className = '',
  children,
  ariaLabel,
}) {
  const navigate = useNavigate()
  const label =
    ariaLabel ||
    `${year} Challenge, ${current} of ${target} completed. View completed games.`

  function openDetail() {
    if (!profilePathSegment) return
    navigate(challengeDetailPath(profilePathSegment, year))
  }

  return (
    <Pressable
      className={className}
      onClick={openDetail}
      aria-label={label}
    >
      {children}
    </Pressable>
  )
}

import { useState } from 'react'
import Pressable from './Pressable'
import ChallengePopup from './challenge/ChallengePopup'

/**
 * Shared tappable wrapper for the yearly-challenge card. Home and Profile
 * both render through this so every surface inherits the same destination,
 * label, keyboard activation, and press state — no per-screen onClick.
 *
 * Tapping opens the challenge as a centered popup over the current page
 * (in-page state: no navigation, no URL change), for your own challenge and
 * for another player's alike. Long-press removal exists only on your own.
 *
 * Native <button> (via Pressable) already handles Enter/Space and focus.
 */
export default function ChallengeCard({
  year,
  current,
  target,
  userId,
  isOwnProfile = false,
  displayName = '',
  className = '',
  children,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false)
  const label =
    ariaLabel ||
    `${year} Challenge, ${current} of ${target} completed. View completed games.`

  return (
    <>
      <Pressable
        className={className}
        onClick={() => {
          if (userId) setOpen(true)
        }}
        aria-label={label}
        aria-haspopup="dialog"
      >
        {children}
      </Pressable>
      <ChallengePopup
        isOpen={open}
        onClose={() => setOpen(false)}
        userId={userId}
        year={year}
        isOwnProfile={isOwnProfile}
        displayName={displayName}
      />
    </>
  )
}

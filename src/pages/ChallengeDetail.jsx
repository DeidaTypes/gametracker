import React, { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useProfileRouteUser } from '../hooks/useProfileRouteUser'
import ChallengePopup from '../components/challenge/ChallengePopup'
import Profile from './Profile'

/**
 * Cold deep link for `/user/:username/challenge` and
 * `/user/id/:userId/challenge`.
 *
 * The challenge is a popup now, not a page. A link that lands here renders
 * that user's Profile and opens the Challenge popup once on arrival, as soon
 * as the user resolves (`?year=` is respected; it defaults to the current
 * calendar year). Closing it leaves the Profile in place. In-app taps never
 * come through these routes: ChallengeCard opens the popup in place.
 */
function ChallengeDetail() {
  const [searchParams] = useSearchParams()
  const { userId, user, notFound, isOwnProfile } = useProfileRouteUser()
  const [open, setOpen] = useState(true)

  const parsedYear = parseInt(searchParams.get('year') || '', 10)
  const year = Number.isFinite(parsedYear) ? parsedYear : new Date().getFullYear()

  return (
    <>
      <Profile />
      <ChallengePopup
        isOpen={open && !!userId && !notFound}
        onClose={() => setOpen(false)}
        userId={userId}
        year={year}
        isOwnProfile={isOwnProfile}
        displayName={user?.display_name || user?.username || ''}
      />
    </>
  )
}

export default ChallengeDetail

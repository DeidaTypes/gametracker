import React, { useCallback } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import ReviewComposer from '../components/composer/ReviewComposer'

/**
 * /review/new — fallback for old links only. Nothing inside the app navigates
 * here any more: every entry point calls openReviewComposer() (ComposerHost),
 * which opens the same box over the current page with no route change.
 *
 * Here the box is the whole screen, so closing it goes back, as before.
 * Route state still carries { game, editReview }; ?gameId= is fetched.
 */
function ReviewNew() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const handleClose = useCallback(() => navigate(-1), [navigate])

  return (
    <ReviewComposer
      game={location.state?.game ?? null}
      gameId={searchParams.get('gameId')}
      editReview={location.state?.editReview ?? null}
      onClose={handleClose}
    />
  )
}

export default ReviewNew

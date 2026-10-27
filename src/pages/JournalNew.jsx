import React, { useCallback } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import JournalComposer from '../components/composer/JournalComposer'

/**
 * /journal/new — fallback for old links only. Closing goes back, as before.
 * Route state may carry { game }; ?gameId= is fetched.
 */
function JournalNew() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const handleClose = useCallback(() => navigate(-1), [navigate])

  return (
    <JournalComposer
      game={location.state?.game ?? null}
      gameId={searchParams.get('gameId')}
      onClose={handleClose}
    />
  )
}

export default JournalNew

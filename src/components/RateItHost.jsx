import React, { useCallback, useEffect, useState } from 'react'
import RatingSheet from './RatingSheet'
import { postReview } from '../services/reviewService'
import { RATE_IT_EVENT } from '../services/ratePrompt'
import { showToast } from './Toast'
import { openReviewComposer as openReviewBox } from './composer/ComposerHost'

/**
 * App-root host for the post-Finish "Rate it?" sheet. Dismiss (backdrop,
 * skip, escape) closes with no writes. Done saves a rating-only review
 * through the existing postReview path.
 */
function RateItHost() {
  const [game, setGame] = useState(null)

  useEffect(() => {
    const onPrompt = (e) => {
      if (e.detail?.game) setGame(e.detail.game)
    }
    window.addEventListener(RATE_IT_EVENT, onPrompt)
    return () => window.removeEventListener(RATE_IT_EVENT, onPrompt)
  }, [])

  const handleClose = useCallback(() => setGame(null), [])

  const handleResolve = useCallback(({ rating, hoursPlayed }) => {
    const target = game
    if (!target || !(Number(rating) > 0)) return
    postReview({
      igdbGameId: target.id,
      body: '',
      rating,
      gameTitle: target.title || null,
      gameImage: target.image || null,
      hoursPlayed: Number(hoursPlayed) || 0,
    }).catch((err) => {
      console.error('[RateItHost] rating write failed:', err)
      showToast('Could not save your rating — try again', 'error')
    })
  }, [game])

  const handleWriteReview = useCallback((target) => {
    if (!target) return
    openReviewBox({ game: target })
  }, [])

  return (
    <RatingSheet
      isOpen={!!game}
      game={game}
      title="Rate it?"
      rateOnly
      onResolve={handleResolve}
      onClose={handleClose}
      onWriteReview={handleWriteReview}
    />
  )
}

export default RateItHost

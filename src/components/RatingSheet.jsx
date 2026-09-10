import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useDragControls } from 'motion/react'
import { LuCheck } from 'react-icons/lu'
import StarRatingInput from './forms/StarRatingInput'
import { getTracker } from '../services/hoursService'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useNavDim } from '../hooks/useNavDim'
import './RatingSheet.css'

/**
 * RatingSheet — "Finish and rate" bottom sheet.
 *
 * Opened by BOTH existing finish triggers (Home Now Playing hero's
 * Finish button; Game Detail's status tiles / status sheet setting
 * Played) instead of writing the completion immediately. The completion
 * is written when this sheet resolves — Done, Skip, or ANY dismissal
 * (backdrop tap, swipe-down, Escape) all resolve as a completion; only
 * Done additionally carries a rating. A dismissed sheet is still a
 * finish — see `handleDismiss` below, which is the single code path
 * every non-Done exit funnels through.
 *
 * This component does not talk to Supabase directly for the completion
 * itself — the caller receives `onResolve({ rating, hoursPlayed })`
 * exactly once and is responsible for calling
 * `completionService.completeGameWithRating`. Keeping the write in the
 * caller (Home.jsx / GameDetail.jsx) matches how every other sheet in
 * this app works (LogSheet, SetGoalSheet, AddToListButton) — the sheet
 * owns presentation, the page owns the mutation + its own toast wording.
 *
 * Props:
 *   isOpen        boolean
 *   game          { id, title, image } — required while open
 *   onResolve     ({ rating: number, hoursPlayed: number }) => void
 *                 Called exactly once per open: on Done, Skip, backdrop
 *                 tap, swipe-down, Escape, or "Write a review". `rating`
 *                 is 0 for every path except Done with stars selected.
 *   onClose       () => void — always called to close the sheet (paired
 *                 1:1 with onResolve, called immediately after it)
 *   onWriteReview (game) => void — called (after onResolve/onClose) when
 *                 the user taps "Write a review"; caller navigates to
 *                 the existing composer
 */
function RatingSheet({ isOpen, game, onResolve, onClose, onWriteReview }) {
  const { reduced } = useMotionPreference()
  const dragControls = useDragControls()
  const [rating, setRating] = useState(0)
  const [hoursPlayed, setHoursPlayed] = useState(0)
  const resolvedRef = useRef(false)

  useNavDim(isOpen)

  // Reset per-open state and fetch this game's real hours (game_trackers,
  // same source HomeNowPlayingHero/GameDetail/CompletionCelebration all
  // read) so the muted subline can show "· Xh played" — omitted below
  // when it's 0, never fabricated.
  useEffect(() => {
    if (!isOpen || !game?.id) return
    resolvedRef.current = false
    setRating(0)
    setHoursPlayed(0)
    let cancelled = false
    getTracker(game.id).then((tracker) => {
      if (cancelled) return
      setHoursPlayed(tracker?.hours_played != null ? Number(tracker.hours_played) : 0)
    })
    return () => { cancelled = true }
  }, [isOpen, game?.id])

  const resolve = (nextRating) => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    onResolve?.({ rating: nextRating || 0, hoursPlayed })
    onClose?.()
  }

  // Every non-Done exit — backdrop tap, swipe-down, Escape — is a Skip:
  // the game still completes, just with no rating.
  const handleDismiss = () => resolve(0)

  const handleDone = () => {
    if (rating <= 0) return
    resolve(rating)
  }

  const handleSkip = () => resolve(0)

  const handleWriteReview = () => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    onResolve?.({ rating: 0, hoursPlayed })
    onClose?.()
    onWriteReview?.(game)
  }

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape') handleDismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, hoursPlayed])

  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.2 }
  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }

  const handleDragEnd = (_e, info) => {
    if (info.offset.y > 110 || info.velocity.y > 600) handleDismiss()
  }

  const ratingHint = rating === 0 ? 'Tap to rate' : `${rating} out of 5`

  const hoursLabel = hoursPlayed > 0
    ? `${hoursPlayed % 1 === 0 ? hoursPlayed.toFixed(0) : hoursPlayed.toFixed(1)}h played`
    : null

  return createPortal(
    <AnimatePresence>
      {isOpen && game && (
        <motion.div
          className="rts-backdrop"
          onClick={handleDismiss}
          role="dialog"
          aria-modal="true"
          aria-label="Finished it"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <motion.div
            className="rts-sheet"
            onClick={(e) => e.stopPropagation()}
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? { y: 0 } : { y: '100%' }}
            transition={sheetTransition}
            drag={reduced ? false : 'y'}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={handleDragEnd}
          >
            <div
              className="rts-drag-zone"
              onPointerDown={(e) => !reduced && dragControls.start(e)}
            >
              <div className="rts-handle" aria-hidden="true" />
            </div>

            <div className="rts-icon" aria-hidden="true">
              <LuCheck size={28} />
            </div>

            <h2 className="rts-heading">Finished it</h2>

            <p className="rts-subline">
              {game.title}{hoursLabel ? ` · ${hoursLabel}` : ''}
            </p>

            <div className="rts-card">
              <span className="rts-card-label">How was it?</span>
              <StarRatingInput
                value={rating}
                onChange={setRating}
                size="xl"
                aria-label={`Rate ${game.title} out of 5`}
              />
              <p className="rts-hint" aria-live="polite">{ratingHint}</p>
            </div>

            <button
              type="button"
              className="rts-done-btn"
              onClick={handleDone}
              disabled={rating <= 0}
            >
              Done
            </button>

            <button type="button" className="rts-skip-btn" onClick={handleSkip}>
              Skip for now
            </button>

            <p className="rts-write-review">
              Want to say more?{' '}
              <button type="button" className="rts-write-review-link" onClick={handleWriteReview}>
                Write a review
              </button>
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default RatingSheet

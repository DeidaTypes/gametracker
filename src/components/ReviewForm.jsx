import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useDragControls } from 'motion/react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import {
  TextArea,
  StarRating,
  NumericField,
  SubmitButton,
} from './forms'
import { COVER_FALLBACK } from '../utils/coverFallback'
import './ReviewForm.css'

/**
 * Dismiss the soft keyboard and wait for it to finish collapsing.
 *
 * On iOS the keyboard collapsing resizes the WKWebView visual viewport.
 * If that happens *while* the sheet is animating away, the fixed-anchored
 * sheet shifts mid-transition and the screen visibly jumps. Blurring the
 * focused field + calling the Capacitor Keyboard plugin up front (and
 * waiting a beat for the collapse to settle) lets the keyboard fully
 * retract before the sheet starts its exit, so the close is smooth.
 */
async function dismissKeyboardAndSettle() {
  if (typeof document !== 'undefined') {
    const active = document.activeElement
    if (active && typeof active.blur === 'function') active.blur()
  }
  try {
    const { Keyboard } = await import('@capacitor/keyboard')
    await Keyboard.hide()
  } catch {
    /* no-op on web or when the plugin is unavailable */
  }
  // Give the keyboard time to finish its collapse animation before the
  // sheet begins exiting. Matches the keyboardWillHide window on iOS.
  await new Promise((resolve) => setTimeout(resolve, 160))
}

const RATING_DESCRIPTIONS = {
  0.5: 'I have words. None are kind.',
  1.0: 'Disappointing.',
  1.5: 'Rough.',
  2.0: 'Underwhelming.',
  2.5: 'Mixed feelings.',
  3.0: 'Solid.',
  3.5: 'Genuinely enjoyed it.',
  4.0: 'Loved it.',
  4.5: 'Near perfect.',
  5.0: 'All-timer.',
}

function ReviewForm({
  gameId,
  gameTitle,
  gameImage,
  gameYear,
  gameDeveloper,
  gameStatus,
  onSubmit,
  onCancel,
  isOpen,
}) {
  const { reduced } = useMotionPreference()
  const dragControls = useDragControls()
  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  const [hoursPlayed, setHoursPlayed] = useState('')
  const [liked, setLiked] = useState(false)
  const [containsSpoilers, setContainsSpoilers] = useState(false)
  const [markCompleted, setMarkCompleted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      // Reset the composer to a clean slate on open. We deliberately do
      // NOT reset on submit: clearing fields while the sheet is still
      // visible (mid-exit) reflows its content and causes a visible jump.
      // Resetting here means the next open starts fresh with no flash.
      setRating(0)
      setText('')
      setHoursPlayed('')
      setLiked(false)
      setContainsSpoilers(false)
      setMarkCompleted(false)
      setSubmitting(false)
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    if (isOpen) {
      window.addEventListener('keydown', handleEscape)
      return () => window.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onCancel])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!rating || submitting) return
    setSubmitting(true)

    // Dismiss the keyboard BEFORE handing off to the parent (which closes
    // the sheet). A keyboard collapsing mid-exit is what causes the jump.
    await dismissKeyboardAndSettle()

    onSubmit({
      rating,
      text: text.trim(),
      hoursPlayed: hoursPlayed ? parseFloat(hoursPlayed) : 0,
      liked,
      containsSpoilers,
      markCompleted,
    })
    // Intentionally no field reset here — the parent closes the sheet and
    // the open effect resets everything on the next open. Resetting now
    // would reflow the still-visible sheet during its exit animation.
  }

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onCancel()
  }

  const fallbackImage = COVER_FALLBACK
  const canSubmit = !submitting && rating > 0
  const ratingDescription = rating > 0 ? RATING_DESCRIPTIONS[rating] : null
  const showMarkCompleted = gameStatus !== 'played'
  const coverSrc = gameImage || fallbackImage

  // Consistent 300 ms-feel spring shared with the app's other bottom
  // sheets (ReportSheet). Reduced motion collapses both to an instant swap.
  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.2 }
  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }

  // Swipe-down-to-dismiss: drag is initiated only from the grabber handle
  // (dragListener={false}) so the inner scroll area still scrolls normally.
  const handleDragEnd = (_e, info) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onCancel()
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="review-modal-backdrop"
          onClick={handleBackdropClick}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <motion.div
            className="review-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Write Review"
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
        <button
          type="button"
          className="review-sheet-handle"
          aria-label="Drag to dismiss"
          onPointerDown={(e) => dragControls.start(e)}
        />
        <button
          className="review-modal-close"
          onClick={onCancel}
          aria-label="Close"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="review-modal-scroll">
          {/* ── Header ── */}
          <div className="review-modal-header">
            <div className="review-cover-wrap">
              <div
                className="review-cover-glow"
                style={{ backgroundImage: `url(${coverSrc})` }}
                aria-hidden="true"
              />
              <img
                src={coverSrc}
                alt={gameTitle}
                className="review-cover-img"
                onError={(e) => {
                  e.target.src = fallbackImage
                }}
              />
            </div>
            <div className="review-header-meta">
              <span className="review-eyebrow">Writing review for</span>
              <h2 className="review-game-title">{gameTitle}</h2>
              {(gameYear || gameDeveloper) && (
                <p className="review-game-sub">
                  {gameYear}
                  {gameDeveloper && gameYear ? ' · ' : ''}
                  {gameDeveloper}
                </p>
              )}
            </div>
          </div>

          <div className="review-header-divider" aria-hidden="true" />

          {/* ── Form ── */}
          <form
            id="review-form"
            onSubmit={handleSubmit}
            className="review-form"
            noValidate
          >
            {/* Rating */}
            <section className="review-section">
              <span className="review-section-label">Your Rating</span>
              <StarRating
                value={rating}
                onChange={setRating}
                size="lg"
                aria-label="Your rating out of 5"
              />
              <p
                className={[
                  'review-rating-desc',
                  ratingDescription ? 'review-rating-desc--visible' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-live="polite"
              >
                {ratingDescription || '\u00a0'}
              </p>
            </section>

            {/* Hours played */}
            <section className="review-section">
              <span className="review-section-label">Hours Played</span>
              <NumericField
                value={hoursPlayed}
                onChange={(e) => setHoursPlayed(e.target.value)}
                suffix="hours"
                min={0}
                step={0.5}
                placeholder="0"
              />
              {showMarkCompleted && (
                <label className="review-toggle">
                  <input
                    type="checkbox"
                    checked={markCompleted}
                    onChange={(e) => setMarkCompleted(e.target.checked)}
                    className="review-toggle__input"
                  />
                  <span className="review-toggle__box" aria-hidden="true" />
                  <span className="review-toggle__text">Mark as completed</span>
                </label>
              )}
            </section>

            {/* Review body */}
            <section className="review-section">
              <TextArea
                label="Your Review"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What did you think? No spoilers, please."
                maxLength={5000}
                className="review-textarea-field"
              />
              <p className="review-format-hint">
                Tip: Use <em>*italics*</em> for emphasis. Spoilers? Add{' '}
                <code>[spoiler]...[/spoiler]</code> tags.
              </p>
            </section>

            {/* Optional toggles */}
            <section className="review-section review-toggles-row">
              <label className="review-toggle review-toggle--heart">
                <input
                  type="checkbox"
                  checked={liked}
                  onChange={(e) => setLiked(e.target.checked)}
                  className="review-toggle__input"
                />
                <svg
                  className={[
                    'review-heart-icon',
                    liked ? 'review-heart-icon--filled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill={liked ? 'var(--color-brand-primary)' : 'none'}
                  stroke={
                    liked ? 'var(--color-brand-primary)' : 'currentColor'
                  }
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
                <span className="review-toggle__text">Liked</span>
              </label>

              <label className="review-toggle">
                <input
                  type="checkbox"
                  checked={containsSpoilers}
                  onChange={(e) => setContainsSpoilers(e.target.checked)}
                  className="review-toggle__input"
                />
                <span className="review-toggle__box" aria-hidden="true" />
                <span className="review-toggle__text">Contains spoilers</span>
              </label>
            </section>
          </form>
        </div>

        {/* ── Sticky footer ── */}
        <div className="review-sticky-footer">
          <SubmitButton
            type="submit"
            form="review-form"
            disabled={!canSubmit}
            loading={submitting}
            className="review-modal-submit"
          >
            Post Review
          </SubmitButton>
          <p className="review-footer-hint">
            Your review will appear on your profile and on this game's page.
          </p>
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default ReviewForm

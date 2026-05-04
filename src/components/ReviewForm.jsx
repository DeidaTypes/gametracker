import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  TextArea,
  StarRating,
  NumericField,
  SubmitButton,
} from './forms'
import './ReviewForm.css'

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

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!rating) return
    setSubmitting(true)
    onSubmit({
      rating,
      text: text.trim(),
      hoursPlayed: hoursPlayed ? parseFloat(hoursPlayed) : 0,
      liked,
      containsSpoilers,
      markCompleted,
    })
    setSubmitting(false)
    setText('')
    setRating(0)
    setHoursPlayed('')
    setLiked(false)
    setContainsSpoilers(false)
    setMarkCompleted(false)
  }

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onCancel()
  }

  if (!isOpen) return null

  const fallbackImage =
    'https://via.placeholder.com/280x380/1a1a1a/ffffff?text=No+Cover'
  const canSubmit = !submitting && rating > 0
  const ratingDescription = rating > 0 ? RATING_DESCRIPTIONS[rating] : null
  const showMarkCompleted = gameStatus !== 'played'
  const coverSrc = gameImage || fallbackImage

  return createPortal(
    <div className="review-modal-backdrop" onClick={handleBackdropClick}>
      <div
        className="review-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Write Review"
      >
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
      </div>
    </div>,
    document.body
  )
}

export default ReviewForm

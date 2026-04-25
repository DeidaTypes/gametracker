import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import './ReviewForm.css'

function ReviewForm({ gameId, gameTitle, gameImage, gameYear, onSubmit, onCancel, isOpen }) {
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [text, setText] = useState('')
  const [hoursPlayed, setHoursPlayed] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef(null)

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

  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 300) + 'px'
  }, [])

  const handleTextChange = (e) => {
    setText(e.target.value)
    autoResizeTextarea()
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!text.trim()) {
      alert('Please write a review before submitting.')
      return
    }
    setSubmitting(true)
    onSubmit({
      rating: rating || 5,
      text: text.trim(),
      hoursPlayed: hoursPlayed ? parseFloat(hoursPlayed) : 0,
    })
    setSubmitting(false)
    setText('')
    setRating(0)
    setHoursPlayed('')
  }

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onCancel()
  }

  if (!isOpen) return null

  const currentRating = hoverRating || rating

  const renderStars = () =>
    [1, 2, 3, 4, 5].map((star) => {
      const isFull = star <= currentRating
      const isHalf = star === Math.ceil(currentRating) && currentRating % 1 !== 0
      const fillState = isFull ? 'filled' : isHalf ? 'half' : 'empty'

      return (
        <div key={star} className="star-container">
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={`star-icon ${fillState}`}
            aria-hidden="true"
          >
            <defs>
              <clipPath id={`clip-rv-${star}`}>
                <rect x="0" y="0" width="12" height="24" />
              </clipPath>
            </defs>
            <path
              d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
              className="star-outline"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
              className="star-fill"
              fill="currentColor"
              clipPath={isHalf ? `url(#clip-rv-${star})` : undefined}
            />
          </svg>

          <button
            type="button"
            className="star-half-button left"
            onClick={() => setRating(star - 0.5)}
            onMouseEnter={() => setHoverRating(star - 0.5)}
            onMouseLeave={() => setHoverRating(0)}
            aria-label={`Rate ${star - 0.5} stars`}
          />
          <button
            type="button"
            className="star-half-button right"
            onClick={() => setRating(star)}
            onMouseEnter={() => setHoverRating(star)}
            onMouseLeave={() => setHoverRating(0)}
            aria-label={`Rate ${star} stars`}
          />
        </div>
      )
    })

  const fallbackImage = 'https://via.placeholder.com/280x380/1a1a1a/ffffff?text=No+Cover'

  return createPortal(
    <div className="review-modal-backdrop" onClick={handleBackdropClick}>
      <div className="review-modal">
        <button className="review-modal-close" onClick={onCancel} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="review-modal-content">
          <div className="review-modal-right">
            {/* Header */}
            <div className="review-modal-header">
              <img
                src={gameImage || fallbackImage}
                alt={gameTitle}
                className="review-modal-thumb"
                onError={(e) => { e.target.src = fallbackImage }}
              />
              <div>
                <h2 className="review-modal-title">{gameTitle}</h2>
                {gameYear && <span className="review-modal-year">{gameYear}</span>}
              </div>
            </div>

            <form id="review-form" onSubmit={handleSubmit} className="review-modal-form">
              {/* Rating + Hours in one row */}
              <div className="review-fields-row">
                <div className="review-field-group">
                  <label className="review-modal-label">Your Rating</label>
                  <div className="review-modal-stars">
                    {renderStars()}
                  </div>
                </div>
                <div className="review-field-group review-field-group--hours">
                  <label htmlFor="hours-played" className="review-modal-label">Hours Played</label>
                  <input
                    id="hours-played"
                    type="number"
                    min="0"
                    step="0.5"
                    value={hoursPlayed}
                    onChange={(e) => setHoursPlayed(e.target.value)}
                    placeholder="0"
                    className="hours-input"
                  />
                </div>
              </div>

              {/* Review text */}
              <div className="review-textarea-section">
                <label className="review-modal-label">Your Review</label>
                <textarea
                  ref={textareaRef}
                  value={text}
                  onChange={handleTextChange}
                  placeholder="Write your review..."
                  className="review-modal-textarea"
                  rows={4}
                />
              </div>
            </form>
          </div>
        </div>

        {/* Sticky submit button */}
        <div className="review-sticky-footer">
          <button
            type="submit"
            form="review-form"
            disabled={submitting || !text.trim()}
            className="review-modal-submit"
          >
            {submitting ? 'Posting...' : 'Post Review'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default ReviewForm

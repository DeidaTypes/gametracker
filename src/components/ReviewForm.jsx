import React, { useState } from 'react'
import './ReviewForm.css'

function ReviewForm({ gameId, gameTitle, onSubmit, onCancel }) {
  const [rating, setRating] = useState(5)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!text.trim()) {
      alert('Please write a review before submitting.')
      return
    }

    setSubmitting(true)
    onSubmit({
      rating: parseInt(rating),
      text: text.trim(),
    })
    setSubmitting(false)
    setText('')
    setRating(5)
  }

  return (
    <div className="review-form-container">
      <form onSubmit={handleSubmit} className="review-form">
        <h3>Write a Review for {gameTitle}</h3>
        
        <div className="rating-selector">
          <label>Rating:</label>
          <div className="stars-input">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                className={`star-button ${star <= rating ? 'active' : ''}`}
                onClick={() => setRating(star)}
                onMouseEnter={(e) => {
                  if (e.buttons === 0) {
                    // Only highlight on hover if not dragging
                  }
                }}
              >
                ⭐
              </button>
            ))}
            <span className="rating-text">{rating} / 5</span>
          </div>
        </div>

        <div className="review-text-area">
          <label htmlFor="review-text">Your Review:</label>
          <textarea
            id="review-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Share your thoughts about this game..."
            rows={6}
            required
          />
        </div>

        <div className="review-form-actions">
          <button type="button" onClick={onCancel} className="cancel-button">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="submit-button">
            {submitting ? 'Submitting...' : 'Submit Review'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default ReviewForm


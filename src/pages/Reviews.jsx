import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getReviewsForUser } from '../services/reviewService'
import { useAuth } from '../contexts/AuthContext'
import StarRating from '../components/StarRating'
import './Reviews.css'

function Reviews() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!user?.id) {
        setReviews([])
        setLoading(false)
        return
      }
      try {
        const rows = await getReviewsForUser(user.id)
        if (!cancelled) setReviews(rows)
      } catch (err) {
        console.error('[reviews] failed to load:', err)
        if (!cancelled) setReviews([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()

    const refresh = () => load()
    window.addEventListener('reviewAdded', refresh)
    return () => {
      cancelled = true
      window.removeEventListener('reviewAdded', refresh)
    }
  }, [user?.id])

  const handleReviewClick = (review) => {
    navigate(
      `/game/${review.igdb_game_id}?review=${encodeURIComponent(review.id)}`,
      review.game_image ? { state: { coverImage: review.game_image } } : undefined
    )
  }

  return (
    <div className="reviews-page">
      <div className="reviews-header">
        <h1>Reviews</h1>
        <p className="reviews-subtitle">
          {loading
            ? 'Loading…'
            : reviews.length === 0
              ? 'Your game reviews will appear here'
              : `${reviews.length} ${reviews.length === 1 ? 'review' : 'reviews'}`}
        </p>
      </div>

      {!loading && reviews.length === 0 ? (
        <div className="empty-reviews">
          <h2>No reviews yet</h2>
          <p>Start reviewing games to share your thoughts!</p>
        </div>
      ) : (
        <div className="reviews-grid">
          {reviews.map((review) => {
            const hours = Number(review.hours_played) || 0
            const dateLabel = review.created_at
              ? new Date(review.created_at).toLocaleDateString()
              : ''
            return (
              <div
                key={review.id}
                className="review-box"
                onClick={() => handleReviewClick(review)}
              >
                <div className="review-box-content">
                  <h3 className="review-box-title">{review.game_title || 'Untitled Game'}</h3>
                  <p className="review-box-text">{review.body}</p>
                  <div className="review-box-date">
                    {dateLabel}
                    {hours > 0 && ` • ${hours}h played`}
                  </div>
                </div>
                <div className="review-box-footer">
                  <div className="review-box-rating">
                    <label className="rating-label">Rating</label>
                    <StarRating rating={parseFloat(review.rating)} size={20} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default Reviews

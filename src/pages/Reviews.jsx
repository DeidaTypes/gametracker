import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PenLine } from 'lucide-react'
import { getReviewsForUser } from '../services/reviewService'
import { useAuth } from '../contexts/AuthContext'
import StarRatingDisplay from '../components/StarRatingDisplay'
import Skeleton from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
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
        {loading ? (
          <Skeleton variant="text" width={80} height={14} className="reviews-subtitle-sk" />
        ) : (
          <p className="reviews-subtitle">
            {reviews.length === 0
              ? 'Your game reviews will appear here'
              : `${reviews.length} ${reviews.length === 1 ? 'review' : 'reviews'}`}
          </p>
        )}
      </div>

      {loading ? (
        <div className="reviews-grid reviews-grid--skeleton" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="review-box review-box--skeleton">
              <div className="review-box-content">
                <Skeleton variant="text" width="55%" height={16} style={{ marginBottom: 8 }} />
                <Skeleton variant="text" width="90%" height={13} />
                <Skeleton variant="text" width="75%" height={13} style={{ marginTop: 4 }} />
              </div>
              <div className="review-box-footer">
                <Skeleton variant="rect" width={80} height={20} />
              </div>
            </div>
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className="content-fade-in">
          <EmptyState
            icon={PenLine}
            title="No reviews yet"
            body="Start reviewing games to share your thoughts!"
            cta="Find a game to review"
            onCta={() => navigate('/search')}
          />
        </div>
      ) : (
        <div className="reviews-grid content-fade-in">
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
                    <StarRatingDisplay rating={parseFloat(review.rating)} size="md" />
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

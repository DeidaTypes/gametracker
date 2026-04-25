import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllReviews } from '../services/reviewService'
import StarRating from '../components/StarRating'
import './Reviews.css'

function Reviews() {
  const navigate = useNavigate()
  const [reviews, setReviews] = useState([])

  useEffect(() => {
    // Load reviews from reviewService
    const allReviews = getAllReviews()
    setReviews(allReviews)
  }, [])

  const handleGameClick = (gameId) => {
    navigate(`/game/${gameId}`)
  }

  return (
    <div className="reviews-page">
      <div className="reviews-header">
        <h1>Reviews</h1>
        <p className="reviews-subtitle">
          {reviews.length === 0
            ? 'Your game reviews will appear here'
            : `${reviews.length} ${reviews.length === 1 ? 'review' : 'reviews'}`}
        </p>
      </div>

      {reviews.length === 0 ? (
        <div className="empty-reviews">
          <h2>No reviews yet</h2>
          <p>Start reviewing games to share your thoughts!</p>
        </div>
      ) : (
        <div className="reviews-grid">
          {reviews.map((review, index) => (
            <div 
              key={index} 
              className="review-box"
              onClick={() => handleGameClick(review.gameId)}
            >
              <div className="review-box-content">
                <h3 className="review-box-title">{review.gameTitle}</h3>
                <p className="review-box-text">{review.text}</p>
                <div className="review-box-date">
                  {new Date(review.date).toLocaleDateString()}
                  {review.hoursPlayed > 0 && ` • ${review.hoursPlayed}h played`}
                </div>
              </div>
              <div className="review-box-footer">
                <div className="review-box-rating">
                  <label className="rating-label">Rating</label>
                  <StarRating rating={parseFloat(review.rating)} size={20} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Reviews


import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllReviews } from '../services/reviewService'
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
        <div className="reviews-content">
          {reviews.map((review, index) => (
            <div 
              key={index} 
              className="review-card"
              onClick={() => handleGameClick(review.gameId)}
            >
              {review.gameImage && (
                <img 
                  src={review.gameImage} 
                  alt={review.gameTitle}
                  className="review-game-image"
                />
              )}
              <div className="review-card-content">
                <div className="review-header">
                  <h3 className="review-game-title">{review.gameTitle}</h3>
                  <div className="review-rating">
                    {'⭐'.repeat(Math.floor(review.rating))}
                  </div>
                </div>
                <p className="review-text">{review.text}</p>
                <div className="review-date">
                  {new Date(review.date).toLocaleDateString()}
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


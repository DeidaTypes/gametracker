import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CoverPlaceholder from './CoverPlaceholder'
import './ReviewCard.css'

function ReviewCard({ review }) {
  const navigate = useNavigate()
  const [coverError, setCoverError] = useState(false)

  const stars = Array.from({ length: 5 }, (_, i) => (
    <span
      key={i}
      className={`review-card__dot ${i < review.rating ? 'review-card__dot--filled' : ''}`}
    />
  ))

  const avatarInitial = (review.user.name || '?')[0].toUpperCase()

  return (
    <div
      className="review-card"
      onClick={() => navigate(`/game/${review.game.id}`)}
      role="link"
      tabIndex={0}
    >
      <div className="review-card__header">
        {review.user.avatar ? (
          <img className="review-card__avatar" src={review.user.avatar} alt="" />
        ) : (
          <div className="review-card__avatar review-card__avatar--initial">{avatarInitial}</div>
        )}
        <div className="review-card__user-info">
          <span className="review-card__username">{review.user.name}</span>
          <span className="review-card__time">{review.timeAgo}</span>
        </div>
      </div>
      {review.excerpt && (
        <p className="review-card__excerpt">{review.excerpt}</p>
      )}
      <div className="review-card__footer">
        {review.game.image && !coverError ? (
          <img
            className="review-card__game-cover"
            src={review.game.image}
            alt=""
            onError={() => setCoverError(true)}
          />
        ) : (
          <div className="review-card__game-cover review-card__game-cover--placeholder">
            <CoverPlaceholder title={review.game.title} />
          </div>
        )}
        <span className="review-card__game-title">{review.game.title}</span>
        <div className="review-card__dots">{stars}</div>
      </div>
    </div>
  )
}

export default ReviewCard

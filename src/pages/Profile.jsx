import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllReviews, getReviewCount } from '../services/reviewService'
import './Profile.css'

function Profile() {
  const navigate = useNavigate()
  const [reviewCount, setReviewCount] = useState(0)
  const [recentReviews, setRecentReviews] = useState([])

  const loadProfileData = () => {
    // Load review count and recent reviews
    const count = getReviewCount()
    setReviewCount(count)
    
    const allReviews = getAllReviews()
    // Get 5 most recent reviews
    const recent = allReviews
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 5)
    setRecentReviews(recent)
  }

  useEffect(() => {
    loadProfileData()
    
    // Listen for storage changes to update review count
    const handleStorageChange = () => {
      loadProfileData()
    }
    
    window.addEventListener('storage', handleStorageChange)
    window.addEventListener('reviewAdded', handleStorageChange)
    
    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('reviewAdded', handleStorageChange)
    }
  }, [])

  const handleGameClick = (gameId) => {
    navigate(`/game/${gameId}`)
  }

  return (
    <div className="profile-page">
      <div className="profile-header">
        <h1>Your Profile</h1>
      </div>

      <div className="profile-stats">
        <div className="stat-card">
          <div className="stat-info">
            <div className="stat-value">{reviewCount}</div>
            <div className="stat-label">Reviews Written</div>
          </div>
        </div>
      </div>

      {recentReviews.length > 0 && (
        <div className="recent-reviews-section">
          <h2>Recent Reviews</h2>
          <div className="recent-reviews-list">
            {recentReviews.map((review, index) => (
              <div 
                key={index} 
                className="recent-review-item"
                onClick={() => handleGameClick(review.gameId)}
              >
                {review.gameImage && (
                  <img 
                    src={review.gameImage} 
                    alt={review.gameTitle}
                    className="recent-review-image"
                  />
                )}
                <div className="recent-review-content">
                  <h3>{review.gameTitle}</h3>
                  <div className="recent-review-rating">
                    {'⭐'.repeat(Math.floor(review.rating))}
                  </div>
                  <p className="recent-review-text">{review.text.substring(0, 150)}...</p>
                  <span className="recent-review-date">
                    {new Date(review.date).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {reviewCount === 0 && (
        <div className="empty-profile">
          <h2>Start reviewing games!</h2>
          <p>Your review count will appear here as you write reviews.</p>
          <button 
            onClick={() => navigate('/')}
            className="browse-button"
          >
            Browse Games
          </button>
        </div>
      )}
    </div>
  )
}

export default Profile


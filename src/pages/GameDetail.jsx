import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getGameById } from '../services/igdb'
import ReviewForm from '../components/ReviewForm'
import AddToListButton from '../components/AddToListButton'
import { saveReview, getReviewsByGameId } from '../services/reviewService'
import { addViewedGame } from '../services/userPreferences'
import './GameDetail.css'

function GameDetail() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reviews, setReviews] = useState([])
  const [showReviewForm, setShowReviewForm] = useState(false)

  useEffect(() => {
    async function fetchGame() {
      try {
        setLoading(true)
        setError(null)
        const gameData = await getGameById(gameId)
        setGame(gameData)
        
        // Track viewed game in user preferences
        addViewedGame(gameId, gameData.title)
        
        // Load existing reviews for this game
        const gameReviews = getReviewsByGameId(gameId)
        setReviews(gameReviews)
      } catch (err) {
        console.error('Error fetching game:', err)
        setError('Failed to load game details.')
      } finally {
        setLoading(false)
      }
    }

    if (gameId) {
      fetchGame()
    }
  }, [gameId])

  const handleReviewSubmit = (reviewData) => {
    const newReview = {
      ...reviewData,
      gameId: gameId,
      gameTitle: game.title,
      gameImage: game.image,
      date: new Date().toISOString(),
    }
    
    saveReview(newReview)
    setReviews([...reviews, newReview])
    setShowReviewForm(false)
    
    // Trigger custom event so Profile page can update
    window.dispatchEvent(new Event('reviewAdded'))
  }

  if (loading) {
    return (
      <div className="game-detail">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading game details...</p>
        </div>
      </div>
    )
  }

  if (error || !game) {
    return (
      <div className="game-detail">
        <div className="error-container">
          <p>{error || 'Game not found'}</p>
          <button onClick={() => navigate('/')} className="back-button">
            Go Back Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="game-detail">
      <button onClick={() => navigate(-1)} className="back-button">
        ← Back
      </button>

      <div className="game-detail-header">
        <div className="game-detail-cover">
          <img 
            src={game.image || 'https://via.placeholder.com/400x600/1a1a1a/ffffff?text=No+Cover'} 
            alt={game.title}
            onError={(e) => {
              e.target.src = 'https://via.placeholder.com/400x600/1a1a1a/ffffff?text=No+Cover'
            }}
          />
        </div>
        <div className="game-detail-info">
          <h1 className="game-detail-title">{game.title}</h1>
          
          <div className="game-detail-meta">
            {game.year && <span className="meta-item">📅 {game.year}</span>}
            {game.rating && <span className="meta-item">⭐ {game.rating}/5.0</span>}
            {game.genres.length > 0 && (
              <span className="meta-item">🎮 {game.genres.join(', ')}</span>
            )}
          </div>

          <div className="game-detail-details">
            {game.developers.length > 0 && (
              <div className="detail-row">
                <span className="detail-label">Developer:</span>
                <span className="detail-value">{game.developers.join(', ')}</span>
              </div>
            )}
            {game.publishers.length > 0 && (
              <div className="detail-row">
                <span className="detail-label">Publisher:</span>
                <span className="detail-value">{game.publishers.join(', ')}</span>
              </div>
            )}
            {game.platforms.length > 0 && (
              <div className="detail-row">
                <span className="detail-label">Platforms:</span>
                <span className="detail-value">{game.platforms.join(', ')}</span>
              </div>
            )}
          </div>

          <div className="game-detail-actions">
            <AddToListButton game={game} />
          </div>
        </div>
      </div>

      <div className="game-detail-content">
        <div className="game-description">
          <h2>About</h2>
          <p>{game.description}</p>
        </div>

        {game.screenshots.length > 0 && (
          <div className="game-screenshots">
            <h2>Screenshots</h2>
            <div className="screenshots-grid">
              {game.screenshots.slice(0, 4).map((screenshot, index) => (
                <img 
                  key={index} 
                  src={screenshot} 
                  alt={`${game.title} screenshot ${index + 1}`}
                  className="screenshot"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="reviews-section">
        <div className="reviews-header">
          <h2>Reviews ({reviews.length})</h2>
          <button 
            onClick={() => setShowReviewForm(!showReviewForm)}
            className="add-review-button"
          >
            {showReviewForm ? 'Cancel' : '+ Write a Review'}
          </button>
        </div>

        {showReviewForm && (
          <ReviewForm 
            gameId={gameId}
            gameTitle={game.title}
            onSubmit={handleReviewSubmit}
            onCancel={() => setShowReviewForm(false)}
          />
        )}

        <div className="reviews-list">
          {reviews.length === 0 ? (
            <p className="no-reviews">No reviews yet. Be the first to review!</p>
          ) : (
            reviews.map((review, index) => (
              <div key={index} className="review-item">
                <div className="review-header">
                  <div className="review-rating">
                    {'⭐'.repeat(Math.floor(review.rating))}
                  </div>
                  <span className="review-date">
                    {new Date(review.date).toLocaleDateString()}
                  </span>
                </div>
                <p className="review-text">{review.text}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default GameDetail


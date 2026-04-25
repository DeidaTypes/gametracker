import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getGameById, getSimilarGames, getSimilarGamesByStyle } from '../services/igdb'
import ReviewForm from '../components/ReviewForm'
import AddToListButton from '../components/AddToListButton'
import GameCard from '../components/GameCard'
import StarRating from '../components/StarRating'
import { saveReview, getReviewsByGameId } from '../services/reviewService'
import { addViewedGame } from '../services/userPreferences'
import { getProfile } from '../services/profileService'
import { getGameStatus, setGameStatus, getGameProgress, updateGameProgress } from '../services/libraryService'
import { logActivity } from '../services/activityService'
import './GameDetail.css'

const STATUS_OPTIONS = [
  { key: 'want', label: 'Want to Play' },
  { key: 'currently', label: 'Playing' },
  { key: 'played', label: 'Played' },
  { key: 'dropped', label: 'Dropped' },
]

function GameDetail() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reviews, setReviews] = useState([])
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [similarGames, setSimilarGames] = useState([])
  const [loadingSimilar, setLoadingSimilar] = useState(false)
  const [similarStyleGames, setSimilarStyleGames] = useState([])
  const [loadingSimilarStyle, setLoadingSimilarStyle] = useState(false)
  const [status, setStatus] = useState(null)
  const [progress, setProgress] = useState({ progressPercent: null, lastPlayedAt: null, hoursPlayed: null })

  const refreshProgress = useCallback(() => {
    setStatus(getGameStatus(gameId))
    setProgress(getGameProgress(gameId))
  }, [gameId])

  useEffect(() => {
    async function fetchGame() {
      try {
        setLoading(true)
        setError(null)
        const gameData = await getGameById(gameId)
        setGame(gameData)

        addViewedGame(gameId, gameData.title)

        const gameReviews = getReviewsByGameId(gameId)
        setReviews(gameReviews)

        refreshProgress()

        setLoadingSimilar(true)
        try {
          const similar = await getSimilarGames(gameData.genres || [], gameId, 12)
          setSimilarGames(similar)
        } catch (err) {
          console.error('Error fetching similar games:', err)
          setSimilarGames([])
        } finally {
          setLoadingSimilar(false)
        }

        setLoadingSimilarStyle(true)
        try {
          const styleSimilar = await getSimilarGamesByStyle(gameData, gameId, 12)
          setSimilarStyleGames(styleSimilar)
        } catch (err) {
          console.error('Error fetching similar style games:', err)
          if (gameData.genres && gameData.genres.length > 0) {
            try {
              const fallback = await getSimilarGames(gameData.genres, gameId, 12)
              setSimilarStyleGames(fallback)
            } catch (fallbackErr) {
              console.error('Fallback also failed:', fallbackErr)
              setSimilarStyleGames([])
            }
          } else {
            setSimilarStyleGames([])
          }
        } finally {
          setLoadingSimilarStyle(false)
        }
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
    const profile = getProfile()
    const newReview = {
      ...reviewData,
      gameId: gameId,
      gameTitle: game.title,
      gameImage: game.image,
      userName: profile?.displayName || 'Anonymous',
      date: new Date().toISOString(),
    }

    saveReview(newReview)
    setReviews([...reviews, newReview])
    setShowReviewForm(false)

    logActivity('review', gameId, game.title, { rating: Number(reviewData.rating) })
    window.dispatchEvent(new Event('reviewAdded'))
  }

  const handleStatusChange = (newStatus) => {
    if (!game) return
    if (newStatus === status) return
    setGameStatus(gameId, newStatus, game)
    logActivity('status_change', gameId, game.title, { newStatus })
    refreshProgress()
  }

  const handleProgressChange = (percent) => {
    const clamped = Math.min(100, Math.max(0, Number(percent) || 0))
    updateGameProgress(gameId, {
      progressPercent: clamped,
      lastPlayedAt: new Date().toISOString(),
    })
    refreshProgress()
  }

  const handleHoursChange = (hours) => {
    const parsed = hours ? parseFloat(hours) : null
    updateGameProgress(gameId, {
      hoursPlayed: parsed,
      lastPlayedAt: new Date().toISOString(),
    })
    if (parsed && parsed > 0) {
      logActivity('hours_logged', gameId, game.title, { hours: parsed })
    }
    refreshProgress()
  }

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: game.title, url: window.location.href })
      } catch {}
    } else {
      navigator.clipboard?.writeText(window.location.href)
    }
  }

  if (loading) {
    return (
      <div className="game-detail margins-style">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading game details...</p>
        </div>
      </div>
    )
  }

  if (error || !game) {
    return (
      <div className="game-detail margins-style">
        <div className="error-container">
          <p>{error || 'Game not found'}</p>
          <button onClick={() => navigate('/')} className="back-button">
            Go Back Home
          </button>
        </div>
      </div>
    )
  }

  const fallbackCover = 'https://via.placeholder.com/400x600/1a1a1a/ffffff?text=No+Cover'

  return (
    <div className="game-detail margins-style">

      {/* ── Hero Section ── */}
      <div className="gd-hero">
        <div
          className="gd-hero-blur"
          style={{ backgroundImage: `url(${game.image || ''})` }}
        />
        <div className="gd-hero-overlay" />

        <div className="gd-hero-topbar">
          <button className="gd-glass-btn" onClick={() => navigate(-1)} aria-label="Go back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>

        <div className="gd-hero-cover-wrapper">
          <div className="gd-hero-cover">
            <img
              src={game.image || fallbackCover}
              alt={game.title}
              onError={(e) => { e.target.src = fallbackCover }}
            />
          </div>
          {game.rating && (
            <div className="gd-hero-rating">
              <svg className="gd-rating-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
              </svg>
              {game.rating}
            </div>
          )}
        </div>
      </div>

      {/* ── Title + Action Buttons ── */}
      <div className="gd-title-section">
        <div className="gd-title-text">
          <h1 className="gd-title">{game.title}</h1>
          {game.year && <p className="gd-subtitle">{game.year}</p>}
          {game.developers.length > 0 && (
            <p className="gd-developer">{game.developers.join(', ')}</p>
          )}
          {game.publishers.length > 0 && (
            <p className="gd-publisher">{game.publishers.join(', ')}</p>
          )}
          {game.genres.length > 0 && (
            <div className="gd-genre-row">
              {game.genres.map((genre) => (
                <span key={genre} className="gd-genre-pill">{genre}</span>
              ))}
            </div>
          )}
        </div>

        <div className="gd-action-buttons">
          <button className="gd-action-circle" onClick={handleShare} aria-label="Share">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </button>
          <button
            className="gd-action-circle"
            onClick={() => setShowReviewForm(true)}
            aria-label="Write a review"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
          <AddToListButton game={game} variant="icon" />
        </div>
      </div>

      {/* ── Content Area ── */}
      <div className="gd-content">

        {/* Playing Status */}
        <div className="gd-section">
          <p className="gd-section-label">Playing Status</p>
          <div className="gd-status-chips">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                className={`gd-status-chip${status === opt.key ? ' gd-status-chip--active' : ''}`}
                onClick={() => handleStatusChange(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {status === 'currently' && (
            <div className="gd-progress-fields">
              <div className="gd-progress-field">
                <span className="gd-field-label">Progress</span>
                <div className="gd-slider-row">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={progress.progressPercent ?? 0}
                    onChange={(e) => handleProgressChange(e.target.value)}
                    className="gd-range"
                  />
                  <span className="gd-pct-label">{progress.progressPercent ?? 0}%</span>
                </div>
              </div>
              <div className="gd-progress-field">
                <label className="gd-field-label" htmlFor="gd-hours">Hours Played</label>
                <input
                  id="gd-hours"
                  type="number"
                  min="0"
                  step="0.5"
                  value={progress.hoursPlayed ?? ''}
                  onChange={(e) => handleHoursChange(e.target.value)}
                  placeholder="0"
                  className="gd-hours-input"
                />
              </div>
            </div>
          )}
        </div>

        <div className="gd-divider" />

        {/* About */}
        <div className="gd-section">
          <p className="gd-section-label">About</p>
          <p className="gd-description">{game.description}</p>
        </div>

        <div className="gd-divider" />

        {/* Details */}
        <div className="gd-section">
          <p className="gd-section-label">Details</p>
          <div className="gd-details-grid">
            {game.developers.length > 0 && (
              <div className="gd-detail-item">
                <span className="gd-detail-key">Developer</span>
                <span className="gd-detail-val">{game.developers.join(', ')}</span>
              </div>
            )}
            {game.publishers.length > 0 && (
              <div className="gd-detail-item">
                <span className="gd-detail-key">Publisher</span>
                <span className="gd-detail-val">{game.publishers.join(', ')}</span>
              </div>
            )}
            {game.platforms.length > 0 && (
              <div className="gd-detail-item">
                <span className="gd-detail-key">Platforms</span>
                <span className="gd-detail-val">{game.platforms.join(', ')}</span>
              </div>
            )}
            {game.year && (
              <div className="gd-detail-item">
                <span className="gd-detail-key">Released</span>
                <span className="gd-detail-val">{game.year}</span>
              </div>
            )}
          </div>
        </div>

        {/* Screenshots */}
        {game.screenshots && game.screenshots.length > 0 && (
          <>
            <div className="gd-divider" />
            <div className="gd-section">
              <p className="gd-section-label">Screenshots</p>
              <div className="gd-screenshots-scroll">
                {game.screenshots.slice(0, 6).map((screenshot, index) => (
                  <img
                    key={index}
                    src={screenshot}
                    alt={`${game.title} screenshot ${index + 1}`}
                    className="gd-screenshot"
                  />
                ))}
              </div>
            </div>
          </>
        )}

        <div className="gd-divider" />

        {/* Reviews */}
        <div className="gd-section">
          <div className="gd-section-header-row">
            <p className="gd-section-label">Reviews ({reviews.length})</p>
            <button
              className="gd-write-review-btn"
              onClick={() => setShowReviewForm(true)}
            >
              Write Review
            </button>
          </div>

          <div className="gd-reviews-list">
            {reviews.length === 0 ? (
              <p className="gd-empty-text">No reviews yet. Be the first to review!</p>
            ) : (
              reviews.map((review, index) => (
                <div key={index} className="gd-review-card">
                  <div className="gd-review-top">
                    <div className="gd-review-user">
                      <span className="gd-review-name">{review.userName || 'Anonymous'}</span>
                      <span className="gd-review-date">
                        {new Date(review.date).toLocaleDateString()}
                        {review.hoursPlayed > 0 && ` · ${review.hoursPlayed}h played`}
                      </span>
                    </div>
                    <div className="gd-review-stars">
                      <StarRating rating={parseFloat(review.rating)} size={18} />
                    </div>
                  </div>
                  <p className="gd-review-body">{review.text}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Similar Games */}
        {similarGames.length > 0 && (
          <>
            <div className="gd-divider" />
            <div className="gd-section">
              <p className="gd-section-label">Similar Games</p>
              {loadingSimilar ? (
                <div className="loading-container">
                  <div className="loading-spinner"></div>
                </div>
              ) : (
                <div className="gd-similar-scroll">
                  {similarGames.map((similarGame) => (
                    <GameCard key={similarGame.id} game={similarGame} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}

      </div>

      {/* Review Modal (portaled to body) */}
      <ReviewForm
        gameId={gameId}
        gameTitle={game.title}
        gameImage={game.image}
        gameYear={game.year}
        onSubmit={handleReviewSubmit}
        onCancel={() => setShowReviewForm(false)}
        isOpen={showReviewForm}
      />
    </div>
  )
}

export default GameDetail

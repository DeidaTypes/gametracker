import React from 'react'
import { useNavigate } from 'react-router-dom'
import './WelcomeCard.css'

function WelcomeCard({ totalGames, currentlyPlayingCount, wantToPlayCount }) {
  const navigate = useNavigate()
  const hasGames = totalGames > 0

  if (!hasGames) {
    // Show "Start Your Library" card
    return (
      <div className="welcome-card empty-library">
        <div className="welcome-card-content">
          <h2 className="welcome-card-title">Start your library</h2>
          <p className="welcome-card-subtitle">
            Add a few games you've played recently to get better recommendations.
          </p>
          <button 
            className="welcome-card-button primary"
            onClick={() => navigate('/search')}
          >
            Add games
          </button>
        </div>
      </div>
    )
  }

  // Show stats card
  return (
    <div className="welcome-card stats-card">
      <div className="welcome-card-content">
        <div className="stats-summary">
          <span className="stat-item">
            You've logged <strong>{totalGames}</strong> {totalGames === 1 ? 'game' : 'games'}
          </span>
          {currentlyPlayingCount > 0 && (
            <>
              <span className="stat-separator">·</span>
              <span className="stat-item">
                <strong>{currentlyPlayingCount}</strong> currently playing
              </span>
            </>
          )}
          {wantToPlayCount > 0 && (
            <>
              <span className="stat-separator">·</span>
              <span className="stat-item">
                <strong>{wantToPlayCount}</strong> in backlog
              </span>
            </>
          )}
        </div>
        <button 
          className="welcome-card-button secondary"
          onClick={() => navigate('/library')}
        >
          View your lists
        </button>
      </div>
    </div>
  )
}

export default WelcomeCard


import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { getContinuePlayingGames } from '../services/libraryService'
import './CurrentlyPlaying.css'

function CurrentlyPlaying() {
  const navigate = useNavigate()
  const [games, setGames] = useState([])

  useEffect(() => {
    const load = () => setGames(getContinuePlayingGames(50))
    load()

    window.addEventListener('libraryUpdated', load)
    return () => window.removeEventListener('libraryUpdated', load)
  }, [])

  return (
    <AppShell>
      <div className="cp-page">
        <header className="cp-page-header">
          <button className="cp-page-back" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <h1 className="cp-page-title">Currently Playing</h1>
          <p className="cp-page-subtitle">
            {games.length} {games.length === 1 ? 'game' : 'games'} in progress
          </p>
        </header>

        {games.length === 0 ? (
          <div className="cp-page-empty">
            <span className="cp-page-empty-icon">🎮</span>
            <h2 className="cp-page-empty-title">No games in progress</h2>
            <p className="cp-page-empty-body">
              Start playing a game and it will appear here so you can track your
              progress.
            </p>
            <button
              className="cta-button"
              onClick={() => navigate('/search')}
            >
              Find Games
            </button>
          </div>
        ) : (
          <div className="cp-page-list">
            {games.map((game) => {
              const pct = game.progressPercent ?? 0
              const hours = game.hoursPlayed
              const genre = game.genres?.[0] || game.genre || null

              return (
                <button
                  key={game.id}
                  className="cp-page-card"
                  onClick={() => navigate(`/game/${game.id}`)}
                >
                  <div className="cp-page-card-cover">
                    <img
                      src={game.image}
                      alt={game.title}
                      onError={(e) => {
                        e.target.src =
                          'https://via.placeholder.com/200x280/1a1a2e/ffffff?text=' +
                          encodeURIComponent(game.title)
                      }}
                    />
                  </div>
                  <div className="cp-page-card-info">
                    <h3 className="cp-page-card-title">{game.title}</h3>
                    {genre && (
                      <span className="cp-page-card-genre">{genre}</span>
                    )}
                    <div className="cp-page-card-progress">
                      {pct > 0 && (
                        <span className="cp-page-card-pct">{pct}% complete</span>
                      )}
                      {hours > 0 && (
                        <span className="cp-page-card-hours">{hours}h played</span>
                      )}
                      {!pct && !hours && (
                        <span className="cp-page-card-hours">Just started</span>
                      )}
                    </div>
                    <div className="cp-page-card-bar">
                      <div
                        className="cp-page-card-bar-fill"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="cp-page-card-arrow">→</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}

export default CurrentlyPlaying

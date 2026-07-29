import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { useAutoAnimateMotion } from '../hooks/useMotionPreference'
import AppShell from '../components/AppShell'
import SharedCover from '../components/SharedCover'
import { getContinuePlayingGames } from '../services/libraryService'
import { getDominantColor } from '../services/colorExtract'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import './CurrentlyPlaying.css'

function GameRow({ game }) {
  const navigate = useNavigate()
  const [tintColor, setTintColor] = useState(null)

  const pct = game.progressPercent ?? 0
  const hours = game.hoursPlayed ?? 0
  const justStarted = !pct && !hours
  const genre = game.genres?.[0] || game.genre || null

  const lastPlayed =
    game.lastPlayedAt
      ? formatDistanceToNow(new Date(game.lastPlayedAt), { addSuffix: true })
      : null

  useEffect(() => {
    getDominantColor(game.image).then(setTintColor)
  }, [game.image])

  const tintStyle = tintColor
    ? { '--cp-tint': `rgba(${tintColor.r}, ${tintColor.g}, ${tintColor.b}, 0.08)` }
    : undefined

  return (
    <button
      className="cp-page-card"
      style={tintStyle}
      onClick={() =>
        navigate(`/game/${game.id}`, { state: { coverImage: game.image } })
      }
    >
      <div className="cp-page-card-cover">
        <SharedCover gameId={game.id} imageSrc={game.image}>
          <img
            src={game.image}
            alt={game.title}
            onError={(e) => {
              e.target.src = COVER_FALLBACK
            }}
          />
        </SharedCover>
      </div>

      <div className="cp-page-card-info">
        <h3 className="cp-page-card-title">{game.title}</h3>

        <div className="cp-page-card-meta">
          {genre && <span className="cp-page-card-genre">{genre}</span>}
          {justStarted && (
            <span className="cp-page-card-just-started">
              <span className="cp-page-card-just-dot" aria-hidden="true" />
              Just started
            </span>
          )}
        </div>

        {!justStarted && (
          <>
            <div className="cp-page-card-progress">
              {pct > 0 && (
                <span className="cp-page-card-pct">{pct}% complete</span>
              )}
              {hours > 0 && (
                <span className="cp-page-card-hours">{hours}h played</span>
              )}
            </div>
            <div className="cp-page-card-bar">
              <div
                className="cp-page-card-bar-fill"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        )}
      </div>

      <div className="cp-page-card-aside">
        {lastPlayed && (
          <span className="cp-page-card-timestamp">{lastPlayed}</span>
        )}
        <span className="cp-page-card-arrow" aria-hidden="true">→</span>
      </div>
    </button>
  )
}

function CurrentlyPlaying() {
  const navigate = useNavigate()
  const [games, setGames] = useState([])
  const [listRef] = useAutoAnimateMotion()

  useEffect(() => {
    const load = () => setGames(getContinuePlayingGames(50))
    load()

    window.addEventListener('libraryUpdated', load)
    window.addEventListener(APP_RESUMED_EVENT, load)
    return () => {
      window.removeEventListener('libraryUpdated', load)
      window.removeEventListener(APP_RESUMED_EVENT, load)
    }
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
          <div className="cp-page-list" ref={listRef}>
            {games.map((game) => (
              <GameRow key={game.id} game={game} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}

export default CurrentlyPlaying

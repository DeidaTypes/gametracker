import React from 'react'
import { useNavigate } from 'react-router-dom'
import SectionHeader from './SectionHeader'
import './ContinuePlaying.css'

function ContinuePlaying({ games }) {
  const navigate = useNavigate()

  if (!games || games.length === 0) return null

  return (
    <div className="cp-section">
      <SectionHeader
        eyebrow="Pick up where you left off"
        title="Continue Playing"
      />

      <div className="cp-rail">
        {games.map((game) => {
          const pct = game.progressPercent ?? 0
          const hours = game.hoursPlayed
          return (
            <button
              key={game.id}
              className="cp-card"
              onClick={() => navigate(`/game/${game.id}`)}
            >
              <div className="cp-cover-wrap">
                <img
                  src={game.image}
                  alt={game.title}
                  className="cp-cover"
                  onError={(e) => {
                    e.target.src =
                      'https://via.placeholder.com/200x280/1a1a1a/ffffff?text=' +
                      encodeURIComponent(game.title)
                  }}
                />
                <div className="cp-overlay">
                  <span className="cp-cta">Continue →</span>
                </div>
                {pct > 0 && (
                  <div className="cp-bar-track">
                    <div className="cp-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
              <div className="cp-info">
                <h3 className="cp-title">{game.title}</h3>
                <span className="cp-meta">
                  {pct > 0 && `${pct}%`}
                  {pct > 0 && hours ? ' · ' : ''}
                  {hours ? `${hours}h` : ''}
                  {!pct && !hours ? 'Currently playing' : ''}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default ContinuePlaying

import React, { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import './CurrentlyPlayingCarousel.css'

function CurrentlyPlayingCarousel({ games }) {
  const navigate = useNavigate()
  const railRef = useRef(null)

  if (!games || games.length === 0) {
    return (
      <div className="cpc">
        <button
          className="cpc-header"
          onClick={() => navigate('/currently-playing')}
        >
          <h2 className="cpc-heading">Currently Playing</h2>
          <span className="cpc-chevron">›</span>
        </button>

        <div className="cpc-empty">
          <div className="cpc-empty-inner">
            <span className="cpc-empty-icon">🎮</span>
            <p className="cpc-empty-title">Nothing playing yet</p>
            <p className="cpc-empty-body">
              Add games to your Currently Playing list to see them here.
            </p>
            <button
              className="cpc-empty-cta"
              onClick={() => navigate('/search')}
            >
              Find Games
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="cpc">
      <button
        className="cpc-header"
        onClick={() => navigate('/currently-playing')}
      >
        <h2 className="cpc-heading">Currently Playing</h2>
        <span className="cpc-chevron">›</span>
      </button>

      <div className="cpc-rail" ref={railRef}>
        {games.map((game) => {
          const pct = game.progressPercent ?? 0
          const hours = game.hoursPlayed
          const genre = game.genres?.[0] || game.genre || null

          return (
            <div key={game.id} className="cpc-slide">
              <button
                className="cpc-card"
                onClick={() => navigate(`/game/${game.id}`)}
              >
                <div className="cpc-cover-col">
                  <div className="cpc-cover-wrap">
                    <img
                      src={game.image}
                      alt={game.title}
                      className="cpc-cover"
                      loading="lazy"
                      onError={(e) => {
                        e.target.src =
                          'https://via.placeholder.com/240x340/1a1a2e/ffffff?text=' +
                          encodeURIComponent(game.title)
                      }}
                    />
                  </div>
                </div>

                <div className="cpc-info-col">
                  <div className="cpc-info-top">
                    <h3 className="cpc-title">{game.title}</h3>
                    {genre && <span className="cpc-genre">{genre}</span>}
                  </div>

                  <div className="cpc-progress-block">
                    {(pct > 0 || hours) && (
                      <div className="cpc-progress-numbers">
                        {pct > 0 && (
                          <span className="cpc-pct">
                            <strong>{pct}</strong>
                            <span className="cpc-pct-symbol">%</span>
                            <span className="cpc-pct-label"> complete</span>
                          </span>
                        )}
                        {hours > 0 && (
                          <span className="cpc-hours">{hours}h played</span>
                        )}
                      </div>
                    )}
                    <div className="cpc-bar-track">
                      <div
                        className="cpc-bar-fill"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                </div>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default CurrentlyPlayingCarousel

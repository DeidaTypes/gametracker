import React, { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNowStrict } from 'date-fns'
import SharedCover from './SharedCover'
import { COVER_FALLBACK } from '../utils/coverFallback'
import './CurrentlyPlayingCarousel.css'

function shortTimeAgo(dateStr) {
  if (!dateStr) return null
  try {
    const result = formatDistanceToNowStrict(new Date(dateStr), { addSuffix: true })
    return result
      .replace(/ seconds?/, 's')
      .replace(/ minutes?/, 'm')
      .replace(/ hours?/, 'h')
      .replace(/ days?/, 'd')
      .replace(/ weeks?/, 'w')
      .replace(/ months?/, 'mo')
      .replace(/ years?/, 'y')
      .replace(/^1d ago$/, 'yesterday')
  } catch {
    return null
  }
}

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
          const hasProgress = pct > 0 || hours > 0
          const timeAgo = shortTimeAgo(game.lastPlayedAt || game.addedAt)

          return (
            <div key={game.id} className="cpc-slide">
              <button
                className="cpc-card"
                onClick={() =>
                  navigate(`/game/${game.id}`, {
                    state: { coverImage: game.image },
                  })
                }
              >
                <div className="cpc-cover-col">
                  <div className="cpc-cover-wrap">
                    <SharedCover gameId={game.id} imageSrc={game.image}>
                      <img
                        src={game.image}
                        alt={game.title}
                        className="cpc-cover"
                        loading="lazy"
                        onError={(e) => {
                          e.target.src = COVER_FALLBACK
                        }}
                      />
                    </SharedCover>
                  </div>
                </div>

                <div className="cpc-info-col">
                  <div className="cpc-info-top">
                    <h3 className="cpc-title">{game.title}</h3>
                    {genre && <span className="cpc-genre">{genre}</span>}
                    {timeAgo && (
                      <span className="cpc-timestamp">{timeAgo}</span>
                    )}
                  </div>

                  <div className="cpc-progress-block">
                    {hasProgress ? (
                      <>
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
                        <div className="cpc-bar-track">
                          <div
                            className="cpc-bar-fill"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </>
                    ) : (
                      <span className="cpc-just-started">Just started</span>
                    )}
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

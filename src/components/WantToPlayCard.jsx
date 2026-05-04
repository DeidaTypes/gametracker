import React from 'react'
import { useNavigate } from 'react-router-dom'
import SharedCover from './SharedCover'
import './WantToPlayCard.css'

function getFanConfig(index, total) {
  if (total === 1) return { x: 0, r: 0, z: 1 }
  if (total === 2) {
    return [
      { x: -18, r: -6, z: 1 },
      { x: 18, r: 6, z: 2 },
    ][index]
  }
  return [
    { x: -30, r: -8, z: 1 },
    { x: 0, r: 0, z: 3 },
    { x: 30, r: 8, z: 2 },
  ][index]
}

function WantToPlayCard({ games }) {
  const navigate = useNavigate()
  const count = games.length
  const covers = [...games].reverse().slice(0, 3)

  const handleClick = () => {
    if (count > 0) {
      navigate('/library', { state: { selectedListId: 'want-to-play' } })
    } else {
      navigate('/explore')
    }
  }

  return (
    <div className="wtp-wrap">
      <button className="wtp-card" onClick={handleClick}>
        <div className="wtp-header">
          <span className="wtp-title">
            Want to Play
            {count > 0 && <span className="wtp-count">&nbsp;· {count}</span>}
          </span>
          <span className="wtp-chevron">›</span>
        </div>

        <div className="wtp-body">
          {count > 0 ? (
            <div className="wtp-fan">
              {covers.map((game, i) => {
                const cfg = getFanConfig(i, covers.length)
                return (
                  <div
                    key={game.id}
                    className="wtp-fan-card"
                    style={{
                      '--fan-x': `${cfg.x}px`,
                      '--fan-r': `${cfg.r}deg`,
                      zIndex: cfg.z,
                    }}
                  >
                    {game.image ? (
                      <SharedCover gameId={game.id} imageSrc={game.image}>
                        <img
                          src={game.image}
                          alt=""
                          className="wtp-fan-img"
                          loading="lazy"
                        />
                      </SharedCover>
                    ) : (
                      <div className="wtp-fan-fallback">
                        {game.title?.charAt(0) || '?'}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="wtp-empty">
              <div className="wtp-fan wtp-fan--ghost">
                {[0, 1, 2].map((i) => {
                  const cfg = getFanConfig(i, 3)
                  return (
                    <div
                      key={i}
                      className="wtp-fan-card wtp-fan-card--ghost"
                      style={{
                        '--fan-x': `${cfg.x}px`,
                        '--fan-r': `${cfg.r}deg`,
                        zIndex: cfg.z,
                      }}
                    />
                  )
                })}
              </div>
              <p className="wtp-empty-label">Build your backlog</p>
              <span className="wtp-empty-cta">Browse games &rarr;</span>
            </div>
          )}
        </div>
      </button>
    </div>
  )
}

export default WantToPlayCard

import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CoverPlaceholder from './CoverPlaceholder'
import './HeroFeature.css'

function HeroFeatureSkeleton() {
  return (
    <div className="hero-feature hero-feature--skeleton">
      <div className="hero-feature__backdrop skeleton" />
      <div className="hero-feature__content">
        <div className="skeleton" style={{ width: 120, height: 10, borderRadius: 4, marginBottom: 12 }} />
        <div className="skeleton" style={{ width: '70%', height: 32, borderRadius: 6, marginBottom: 10 }} />
        <div className="skeleton" style={{ width: '90%', height: 14, borderRadius: 4, marginBottom: 16 }} />
        <div className="skeleton" style={{ width: 180, height: 12, borderRadius: 4 }} />
      </div>
    </div>
  )
}

function HeroFeature({ game, loading }) {
  const navigate = useNavigate()
  const [imgError, setImgError] = useState(false)

  if (loading || !game) return <HeroFeatureSkeleton />

  const stars = '\u2605'.repeat(Math.floor(game.rating)) + (game.rating % 1 >= 0.5 ? '\u00BD' : '')

  return (
    <div
      className="hero-feature"
      onClick={() => navigate(`/game/${game.id}`)}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/game/${game.id}`)}
    >
      {imgError ? (
        <CoverPlaceholder title={game.title} className="hero-feature__backdrop" />
      ) : (
        <img
          className="hero-feature__backdrop"
          src={game.heroImage || game.image}
          alt=""
          draggable={false}
          onError={() => setImgError(true)}
        />
      )}
      <div className="hero-feature__gradient" />
      <div className="hero-feature__content">
        <span className="hero-feature__eyebrow">{game.eyebrow}</span>
        <h2 className="hero-feature__title">{game.title}</h2>
        {game.blurb && <p className="hero-feature__blurb">{game.blurb}</p>}
        <div className="hero-feature__meta">
          {stars && <span className="hero-feature__stars">{stars}</span>}
          {stars && game.genre && <span className="hero-feature__sep">&middot;</span>}
          {game.genre && <span>{game.genre}</span>}
          {game.logsThisWeek > 0 && (
            <>
              <span className="hero-feature__sep">&middot;</span>
              <span>{game.logsThisWeek} {game.logsThisWeek === 1 ? 'log' : 'logs'} this week</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default HeroFeature

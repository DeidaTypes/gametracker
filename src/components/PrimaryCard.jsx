import React from 'react'
import { getBestImageUrl } from '../services/imageUtils'
import './PrimaryCard.css'

/**
 * PrimaryCard — full-width editorial hero card for a featured game.
 * Props:
 *   game    — game object with title, image, year, genre, rating, developer
 *   onClick — navigation callback
 */
function PrimaryCard({ game, onClick }) {
  const imageUrl = getBestImageUrl(game, 800) || game.image

  return (
    <div
      className="primary-card"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
    >
      {/* Full-bleed image */}
      <div className="primary-card-media">
        <img
          src={imageUrl}
          alt={game.title}
          className="primary-card-img"
          loading="eager"
          onError={(e) => {
            if (e.target.src !== game.image) {
              e.target.src = game.image || ''
            }
          }}
        />
        <div className="primary-card-scrim" />

        {/* Rating badge — top right */}
        {game.rating && (
          <div className="primary-card-rating">
            ★ {typeof game.rating === 'number' ? game.rating.toFixed(1) : game.rating}
          </div>
        )}
      </div>

      {/* Text content below image */}
      <div className="primary-card-body">
        <div className="primary-card-meta-row">
          <span className="primary-card-eyebrow">Featured</span>
          <div className="primary-card-pills">
            {game.year && (
              <span className="primary-card-pill">{game.year}</span>
            )}
            {game.genre && (
              <span className="primary-card-pill">
                {game.genre.split(',')[0].trim()}
              </span>
            )}
            {game.developer && (
              <span className="primary-card-pill">{game.developer}</span>
            )}
          </div>
        </div>

        <h2 className="primary-card-title">{game.title}</h2>

        <div className="primary-card-cta">
          Discover <span className="primary-card-arrow">→</span>
        </div>
      </div>
    </div>
  )
}

export default PrimaryCard

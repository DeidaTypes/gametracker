import React, { forwardRef } from 'react'
import './ShareCard.css'

/**
 * 1080×1920 share card. Rendered offscreen so html-to-image can
 * rasterise it without flashing on the user's screen.
 *
 * Props:
 *   game        { title, image }
 *   displayName string
 *   rating      number  0–5 (user's own rating; 0 = not rated)
 *   accentRgb   { r, g, b } | null
 */
const ShareCard = forwardRef(function ShareCard(
  { game, displayName, rating, accentRgb },
  ref
) {
  const accent = accentRgb
    ? `rgb(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b})`
    : '#3b82f6'

  const backdropGradient = accentRgb
    ? `linear-gradient(180deg,
        rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.55) 0%,
        rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.18) 36%,
        rgba(10, 15, 31, 0.95) 72%,
        #0a0f1f 100%)`
    : `linear-gradient(180deg,
        rgba(59, 130, 246, 0.45) 0%,
        rgba(59, 130, 246, 0.14) 36%,
        rgba(10, 15, 31, 0.95) 72%,
        #0a0f1f 100%)`

  const safeRating = Math.max(0, Math.min(5, Number(rating) || 0))
  const fillPct = (safeRating / 5) * 100

  return (
    <div
      ref={ref}
      className="share-card"
      style={{ background: backdropGradient }}
      aria-hidden="true"
    >
      <div className="share-card__inner">
        <div className="share-card__eyebrow">Completed</div>

        <div className="share-card__cover-wrap">
          <div
            className="share-card__cover-glow"
            style={{ background: accent }}
          />
          {game?.image ? (
            <img
              src={game.image}
              alt=""
              crossOrigin="anonymous"
              className="share-card__cover"
            />
          ) : (
            <div className="share-card__cover share-card__cover--fallback" />
          )}
        </div>

        <h1 className="share-card__title">{game?.title || 'Untitled'}</h1>
        <p className="share-card__byline">
          Completed by {displayName || 'a player'}
        </p>

        {safeRating > 0 && (
          <div className="share-card__rating">
            <span className="share-card__rating-label">Rating</span>
            {/* Inline star row — no external CSS vars in html-to-image context */}
            <div className="share-card__stars-wrap">
              <div className="share-card__stars-base">
                {[0, 1, 2, 3, 4].map((i) => (
                  <svg key={i} width="32" height="32" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                      fill="none"
                      stroke="rgba(148,168,212,0.3)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ))}
              </div>
              <div className="share-card__stars-fill" style={{ width: `${fillPct}%` }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <svg key={i} width="32" height="32" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                      fill="#f5b50a"
                      stroke="#f5b50a"
                      strokeWidth="1"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ))}
              </div>
            </div>
            <span className="share-card__rating-value">{safeRating} / 5</span>
          </div>
        )}

        <div className="share-card__watermark">
          <span className="share-card__watermark-mark">GameTracker</span>
        </div>
      </div>
    </div>
  )
})

export default ShareCard

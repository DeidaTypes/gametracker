import React, { forwardRef } from 'react'
import './ShareCard.css'

/**
 * 1080×1920 share card. Rendered offscreen (position: fixed, top: -100000px)
 * so html-to-image can rasterise it without a flash on the user's screen.
 *
 * The DOM intentionally avoids any styles that depend on outside CSS
 * cascade — every selector here is namespaced to `.share-card-*` so the
 * rendered PNG matches the on-screen preview byte-for-byte.
 */
const ShareCard = forwardRef(function ShareCard(
  { game, displayName, hoursPlayed, daysPlaying, reviewCount, accentRgb },
  ref
) {
  const accent = accentRgb
    ? `rgb(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b})`
    : '#C8965A'

  // Same vertical gradient as the on-screen celebration: extracted color
  // at the top, our deep navy at the bottom.
  const backdropGradient = accentRgb
    ? `linear-gradient(180deg,
        rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.55) 0%,
        rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.18) 36%,
        rgba(12, 19, 34, 0.95) 72%,
        #0C1322 100%)`
    : `linear-gradient(180deg,
        rgba(200, 150, 90, 0.45) 0%,
        rgba(200, 150, 90, 0.14) 36%,
        rgba(12, 19, 34, 0.95) 72%,
        #0C1322 100%)`

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

        <div className="share-card__stats">
          <div className="share-card__stat">
            <span className="share-card__stat-num">{formatHours(hoursPlayed)}</span>
            <span className="share-card__stat-label">Hours</span>
          </div>
          <div className="share-card__stat-divider" />
          <div className="share-card__stat">
            <span className="share-card__stat-num">{daysPlaying ?? '—'}</span>
            <span className="share-card__stat-label">Days</span>
          </div>
          <div className="share-card__stat-divider" />
          <div className="share-card__stat">
            <span className="share-card__stat-num">{reviewCount ?? 0}</span>
            <span className="share-card__stat-label">Reviews</span>
          </div>
        </div>

        <div className="share-card__watermark">
          <span className="share-card__watermark-mark">GameTracker</span>
        </div>
      </div>
    </div>
  )
})

function formatHours(h) {
  if (h == null || Number.isNaN(Number(h))) return '—'
  const num = Number(h)
  if (num >= 100) return Math.round(num).toString()
  return num % 1 === 0 ? num.toFixed(0) : num.toFixed(1)
}

export default ShareCard

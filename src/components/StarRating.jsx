import React, { useId } from 'react'
import './StarRating.css'

const STAR_PATH =
  'M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z'

const STARS = [0, 1, 2, 3, 4]

/**
 * Read-only star rating display.
 *
 * Uses a two-layer overlay technique so any fractional value renders
 * as a smooth continuous fill:
 *   Layer 1 (base)  — 5 empty outline stars, full row width
 *   Layer 2 (fill)  — 5 gold filled stars, absolutely positioned and
 *                     overflow-hidden to (rating / 5) × 100 % of the
 *                     base width.
 *
 * No SVG clipPath IDs are used so there are no per-page collisions.
 *
 * Props:
 *   rating  number  0–5, any decimal (0.5 increments typical)
 *   size    number  pixel dimension of each star (default 20)
 */
function StarRating({ rating, size = 20 }) {
  const safeRating = Math.max(0, Math.min(5, Number(rating) || 0))
  const fillPct = (safeRating / 5) * 100

  return (
    <div
      className="star-rating-display"
      role="img"
      aria-label={`${safeRating} out of 5 stars`}
    >
      {/* Base layer — empty outline stars, establishes width */}
      <div className="star-rating__layer star-rating__layer--base" aria-hidden="true">
        {STARS.map((i) => (
          <svg
            key={i}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d={STAR_PATH}
              fill="none"
              stroke="var(--star-empty)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ))}
      </div>

      {/* Fill layer — gold stars clipped to fillPct% of the base width */}
      <div
        className="star-rating__layer star-rating__layer--fill"
        style={{ width: `${fillPct}%` }}
        aria-hidden="true"
      >
        {STARS.map((i) => (
          <svg
            key={i}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d={STAR_PATH}
              fill="var(--star)"
              stroke="var(--star)"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ))}
      </div>
    </div>
  )
}

export default StarRating

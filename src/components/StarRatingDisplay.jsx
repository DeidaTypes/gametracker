import React from 'react'
import './StarRatingDisplay.css'
import {
  STAR_ICON_PATH,
  resolveStarRatingSize,
  getStarRatingFillPercent,
} from './starRatingConfig'

const STARS = [0, 1, 2, 3, 4]

/**
 * Read-only star rating display. (Formerly `StarRating.jsx` — renamed to
 * disambiguate it from the interactive `forms/StarRatingInput.jsx`, which
 * has a different job and a different `size` shape.)
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
 * ROUNDING POLICY — TRUE FRACTIONAL FILL, applied everywhere (flagged,
 * reversible):
 *   This is the single rounding policy for every read-only star surface
 *   in the app. A 3.7 rating fills the 4th star to 70% — it does not
 *   round to a whole star or snap to the nearest half. Previously this
 *   varied by screen (GameDetail's review list pre-rounded to whole
 *   stars, ReviewOfWeekHero snapped to halves via Unicode glyphs, and
 *   everywhere else already did true fractional fill) which meant the
 *   same rating could visibly read as three different values depending
 *   on which screen you were on. True fractional fill was chosen
 *   because: (1) it's the most accurate representation and matches how
 *   ratings are stored, (2) individual review ratings are already
 *   locked to 0.5 increments by the rating input, so in practice this
 *   renders identically to half-star rounding for real review data,
 *   and (3) it degrades gracefully for any future non-half-step value
 *   (e.g. a community average rating) instead of hiding precision.
 *   To reverse this decision, change `getStarRatingFillPercent` in
 *   `starRatingConfig.js` to round to the nearest 0.5 (half-star policy)
 *   or nearest integer (whole-star policy) before computing the
 *   percentage — every screen updates together because they all go
 *   through that one function.
 *
 * Props:
 *   rating  number                                     0–5, any decimal
 *   size    'xs'|'sm'|'md'|'lg'|'xl'|'xxl' | number(px) shared scale with
 *           forms/StarRatingInput — see starRatingConfig.js. Default 'md'.
 */
function StarRatingDisplay({ rating, size = 'md' }) {
  const safeRating = Math.max(0, Math.min(5, Number(rating) || 0))
  const fillPct = getStarRatingFillPercent(safeRating)
  const px = resolveStarRatingSize(size)

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
            width={px}
            height={px}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d={STAR_ICON_PATH}
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
            width={px}
            height={px}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d={STAR_ICON_PATH}
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

export default StarRatingDisplay

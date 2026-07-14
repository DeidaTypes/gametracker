import React from 'react'
import './CommunityRatingCard.css'

const ROWS = [5, 4, 3, 2, 1]

// Full (never half-filled) star glyph used only as the histogram row
// label — the average number to the left never renders a star at all.
function FullStar() {
  return (
    <svg className="crc-row-star" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
    </svg>
  )
}

/**
 * Community rating card for GameDetail — numeric average (gradient number)
 * on the left, whole-star histogram (rows ★5→★1) on the right.
 *
 * Renders nothing when the game has zero ratings so the caller's "Be the
 * first to review" empty state can show instead.
 *
 * @param {{
 *   average: number|null,
 *   totalCount: number,
 *   counts: Record<number, number>|null,
 * }} props
 */
export default function CommunityRatingCard({ average, totalCount, counts }) {
  if (!totalCount || average == null || !counts) return null

  return (
    <div className="crc-card">
      <div className="crc-avg">
        <span className="crc-avg-number">{average.toFixed(1)}</span>
        <span className="crc-avg-caption">avg of 5</span>
        <span className="crc-avg-count">
          {totalCount === 1 ? '1 rating' : `${totalCount} ratings`}
        </span>
      </div>

      <div
        className="crc-histogram"
        role="img"
        aria-label={`Rating distribution: average ${average.toFixed(1)} out of 5 from ${totalCount} ${totalCount === 1 ? 'rating' : 'ratings'}`}
      >
        {ROWS.map((star) => {
          const count = counts[star] || 0
          const pct = totalCount > 0 ? (count / totalCount) * 100 : 0
          return (
            <div className="crc-row" key={star}>
              <span className="crc-row-label">
                <FullStar />
                {star}
              </span>
              <span className="crc-row-track">
                {pct > 0 && <span className="crc-row-fill" style={{ width: `${pct}%` }} />}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

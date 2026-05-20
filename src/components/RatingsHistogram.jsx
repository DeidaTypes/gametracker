import React from 'react'
import './RatingsHistogram.css'

const BAR_WIDTH = 12
const BAR_GAP = 8
const SVG_WIDTH = 220
const SVG_HEIGHT = 60
const MAX_BAR_H = 52
const BUCKET_COUNT = 11

// Bucket index = Math.round(rating * 2), mapping 0.0–5.0 in 0.5 steps → indices 0–10
function buildBuckets(ratings) {
  const buckets = new Array(BUCKET_COUNT).fill(0)
  for (const r of ratings) {
    const idx = Math.min(BUCKET_COUNT - 1, Math.max(0, Math.round(r * 2)))
    buckets[idx]++
  }
  return buckets
}

export default function RatingsHistogram({ ratings }) {
  if (!ratings || ratings.length === 0) return null

  const buckets = buildBuckets(ratings)
  const maxCount = Math.max(...buckets, 1)

  const totalBarsWidth = BUCKET_COUNT * BAR_WIDTH + (BUCKET_COUNT - 1) * BAR_GAP
  const startX = (SVG_WIDTH - totalBarsWidth) / 2

  return (
    <div className="ratings-histogram">
      <svg
        width={SVG_WIDTH}
        height={SVG_HEIGHT}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        aria-label="Community ratings distribution"
        role="img"
      >
        {buckets.map((count, i) => {
          const barH = Math.max(count > 0 ? 3 : 0, Math.round((count / maxCount) * MAX_BAR_H))
          const x = startX + i * (BAR_WIDTH + BAR_GAP)
          const y = SVG_HEIGHT - barH

          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={BAR_WIDTH}
              height={barH}
              rx={2}
              ry={2}
              fill="var(--accent-copper)"
              opacity={count > 0 ? 1 : 0.15}
            />
          )
        })}
      </svg>
      <div className="ratings-histogram__labels">
        <span className="ratings-histogram__label">0.5 star</span>
        <span className="ratings-histogram__label">5 stars</span>
      </div>
    </div>
  )
}

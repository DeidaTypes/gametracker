import React from 'react'
import './GameCardSkeleton.css'

/**
 * Matches the visual footprint of a GameCard:
 * — 2:3 cover rectangle (rounded corners)
 * — title placeholder at 60% width
 * — caption placeholder at 40% width
 * All blocks carry the `.skeleton` class (shimmer defined in theme.css).
 */
function GameCardSkeleton() {
  return (
    <div className="gcs-wrap" aria-hidden="true">
      <div className="gcs-cover skeleton" />
      <div className="gcs-title skeleton" />
      <div className="gcs-caption skeleton" />
    </div>
  )
}

/**
 * Renders `count` GameCardSkeletons in a horizontal scroll row —
 * matches the layout used by Explore poster rows.
 */
export function GameCardSkeletonRow({ count = 6 }) {
  return (
    <div className="gcs-scroll-row" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <GameCardSkeleton key={i} />
      ))}
    </div>
  )
}

/**
 * Renders `count` GameCardSkeletons in a CSS grid —
 * matches the layout used by CategoryResults and DeveloperDetail.
 */
export function GameCardSkeletonGrid({ count = 12 }) {
  return (
    <div className="gcs-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <GameCardSkeleton key={i} />
      ))}
    </div>
  )
}

export default GameCardSkeleton

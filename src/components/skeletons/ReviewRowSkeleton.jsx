import React from 'react'
import './ReviewRowSkeleton.css'

/**
 * Single skeleton row for a review entry:
 * — small circle (avatar, 32×32)
 * — username placeholder (80px wide, 14px tall)
 * — game poster placeholder (40px wide, 2:3 ratio)
 * — 2 lines of review text placeholder
 */
function ReviewRowSkeleton() {
  return (
    <div className="rrs-row" aria-hidden="true">
      <div className="rrs-left">
        <div className="rrs-avatar skeleton" />
        <div className="rrs-username skeleton" />
      </div>
      <div className="rrs-poster skeleton" />
      <div className="rrs-body">
        <div className="rrs-line skeleton" style={{ width: '85%' }} />
        <div className="rrs-line skeleton" style={{ width: '60%' }} />
      </div>
    </div>
  )
}

export function ReviewRowSkeletonList({ count = 4 }) {
  return (
    <div className="rrs-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <ReviewRowSkeleton key={i} />
      ))}
    </div>
  )
}

export default ReviewRowSkeleton

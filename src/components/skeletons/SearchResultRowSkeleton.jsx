import React from 'react'
import './SearchResultRowSkeleton.css'

/**
 * Single skeleton row that matches a search result list item:
 * — 40×40 game cover square
 * — title placeholder (variable width, 14px tall)
 * — caption placeholder (shorter, 12px tall)
 * — chevron placeholder (12×20)
 */
function SearchResultRowSkeleton() {
  return (
    <div className="srrs-row" aria-hidden="true">
      <div className="srrs-cover skeleton" />
      <div className="srrs-text">
        <div className="srrs-title skeleton" />
        <div className="srrs-caption skeleton" />
      </div>
      <div className="srrs-chevron skeleton" />
    </div>
  )
}

export function SearchResultSkeletonList({ count = 8 }) {
  return (
    <div className="srrs-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <SearchResultRowSkeleton key={i} />
      ))}
    </div>
  )
}

export default SearchResultRowSkeleton

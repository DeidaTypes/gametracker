import React from 'react'
import { ChevronDown } from 'lucide-react'

export default function LibrarySortRow({ count, sortLabel, onSortClick }) {
  return (
    <div className="lib-sortrow">
      <span className="lib-sortrow-count">
        {count} {count === 1 ? 'game' : 'games'}
      </span>
      <button
        type="button"
        className="lib-sortrow-btn"
        onClick={onSortClick}
        aria-label={`Sort games (currently ${sortLabel})`}
      >
        {sortLabel}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

import React from 'react'
import './StatRowSkeleton.css'

/**
 * 4-column stat bar skeleton for the Profile page.
 * Each cell: number placeholder (24×24) above a label placeholder (40×12).
 */
function StatRowSkeleton() {
  return (
    <div className="srs-row" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="srs-cell">
          <div className="srs-number skeleton" />
          <div className="srs-label skeleton" />
        </div>
      ))}
    </div>
  )
}

export default StatRowSkeleton

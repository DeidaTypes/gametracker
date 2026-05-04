import React, { useState } from 'react'
import './SpoilerOverlay.css'

/**
 * SpoilerOverlay — wraps spoiler-flagged review bodies with a frosted-glass
 * blur (8px) and a "Tap to reveal" affordance. Clicking the overlay reveals
 * the wrapped content for that single mounted instance.
 *
 * Usage:
 *   <SpoilerOverlay>
 *     <p>...review body...</p>
 *   </SpoilerOverlay>
 *
 * The caller decides whether to apply this — typically only when:
 *   review.has_spoilers === true && review.user_id !== currentUser?.id
 */
function SpoilerOverlay({ children, label = 'Tap to reveal' }) {
  const [revealed, setRevealed] = useState(false)

  const handleReveal = (e) => {
    // Stop click from bubbling up to a parent <button>/<a> that wraps the
    // review row (e.g. ReviewFeedRow), so revealing doesn't also navigate.
    e.stopPropagation()
    e.preventDefault()
    setRevealed(true)
  }

  if (revealed) {
    return <>{children}</>
  }

  return (
    <div className="spoiler-wrap">
      <div className="spoiler-content" aria-hidden="true">
        {children}
      </div>
      <button
        type="button"
        className="spoiler-overlay"
        onClick={handleReveal}
        aria-label={`${label} (contains spoilers)`}
      >
        <span className="spoiler-overlay__label">{label}</span>
      </button>
    </div>
  )
}

export default SpoilerOverlay

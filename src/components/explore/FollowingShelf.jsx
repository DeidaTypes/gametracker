import React from 'react'
import './SectionScaffold.css'

/**
 * FollowingShelf — Discover "From people you follow" slot.
 *
 * SCAFFOLD ONLY. This reserves the section's position in the Discover order
 * (between "Collections" and "Notes worth reading"). The internals — real
 * follow-graph activity (rated / reviewed cards, taste-match, add-to-backlog,
 * like/comment counts) — are owned by E3 and land there. Keep the markup/order
 * stable so E3 only has to fill the body.
 */
export default function FollowingShelf() {
  return (
    <section className="explore-section shelf-scaffold" aria-label="From people you follow">
      <div className="explore-section__pad shelf-scaffold__head">
        <div>
          <h2 className="discover-section-title">From people you follow</h2>
          <p className="shelf-scaffold__subtitle">What your circle is saying</p>
        </div>
      </div>

      {/* E3 fills this slot with real follow-graph activity cards. */}
      <div className="explore-section__pad">
        <div className="shelf-scaffold__slot" aria-hidden="true">
          <div className="shelf-scaffold__placeholder shelf-scaffold__placeholder--tall" />
        </div>
      </div>
    </section>
  )
}

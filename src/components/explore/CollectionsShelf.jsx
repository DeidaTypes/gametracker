import React from 'react'
import './SectionScaffold.css'

/**
 * CollectionsShelf — Discover "Collections" slot.
 *
 * SCAFFOLD ONLY. This reserves the section's position in the Discover order
 * (between "Swipe to discover" and "From people you follow"). The internals —
 * real curated lists, cover mosaics, "saved by" counts, and the See-all
 * navigation — are owned by E2 and land there. Keep the markup/order stable
 * so E2 only has to fill the body.
 */
export default function CollectionsShelf() {
  return (
    <section className="explore-section shelf-scaffold" aria-label="Collections">
      <div className="explore-section__pad shelf-scaffold__head">
        <div>
          <h2 className="discover-section-title">Collections</h2>
          <p className="shelf-scaffold__subtitle">Curated lists worth playing through</p>
        </div>
      </div>

      {/* E2 fills this slot with real collection cards. */}
      <div className="explore-section__pad">
        <div className="shelf-scaffold__slot" aria-hidden="true">
          <div className="shelf-scaffold__placeholder" />
          <div className="shelf-scaffold__placeholder" />
        </div>
      </div>
    </section>
  )
}

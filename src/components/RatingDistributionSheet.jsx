import React from 'react'
import CenteredModal from './CenteredModal'
import CommunityRatingCard from './CommunityRatingCard'
import './RatingDistributionSheet.css'

/**
 * Community rating histogram in a centered popup.
 * Internals are CommunityRatingCard unchanged (true half-star buckets).
 */
export default function RatingDistributionSheet({ isOpen, onClose, ratingDist }) {
  const totalCount = ratingDist?.totalCount ?? 0
  const hasRatings = totalCount > 0 && ratingDist?.average != null && !ratingDist?.error

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Community rating distribution"
      maxWidth={400}
      className="rds-card"
    >
      <header className="rds-top">
        <span aria-hidden="true" />
        <h2 className="rds-top__title text-title">Community ratings</h2>
        <button type="button" className="rds-top__done" onClick={onClose}>
          Done
        </button>
      </header>

      <div className="cm-scroll rds-body">
        {hasRatings ? (
          <>
            <CommunityRatingCard
              average={ratingDist.average}
              totalCount={ratingDist.totalCount}
              counts={ratingDist.counts}
            />
            <p className="rds-caption text-label">
              Half ratings group into the star above. This chart shows the true
              half-star distribution.
            </p>
          </>
        ) : (
          <p className="rds-empty text-body">No community ratings yet.</p>
        )}
      </div>
    </CenteredModal>
  )
}

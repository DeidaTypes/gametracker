import React, { useState } from 'react'
import { LuChevronRight, LuX } from 'react-icons/lu'
import CenteredModal from './CenteredModal'
import { HALF_STAR_BUCKETS, toHalfStarBucket } from '../utils/ratingBuckets'
import './ProfileRatingsChart.css'

const CHART_HEIGHT_PX = 90
const MIN_BAR_PX = 3
const WHOLE_STAR_BUCKETS = [1, 2, 3, 4, 5]

/** Kept for callers that gate the taste/rate card wrapper. */
export const MIN_RATINGS_FOR_CHART = 1

function hasHalfStarRatings(reviews) {
  return reviews.some((r) => {
    const n = Number(r.rating)
    return Number.isFinite(n) && n > 0 && n % 1 !== 0
  })
}

function buildHalfStarBuckets(reviews) {
  const map = new Map(HALF_STAR_BUCKETS.map((b) => [b, []]))
  for (const r of reviews) {
    const snapped = toHalfStarBucket(r.rating)
    if (snapped == null) continue
    map.get(snapped).push(r)
  }
  return HALF_STAR_BUCKETS.map((b) => ({ rating: b, reviews: map.get(b) || [] }))
}

function buildWholeStarBuckets(reviews) {
  const map = new Map(WHOLE_STAR_BUCKETS.map((b) => [b, []]))
  for (const r of reviews) {
    const n = Number(r.rating)
    if (!Number.isFinite(n) || n <= 0) continue
    const bucket = Math.min(5, Math.max(1, Math.round(n)))
    map.get(bucket).push(r)
  }
  return WHOLE_STAR_BUCKETS.map((b) => ({ rating: b, reviews: map.get(b) || [] }))
}

export function meanRating(reviews) {
  const values = reviews
    .map((r) => Number(r.rating))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (values.length === 0) return null
  return values.reduce((s, n) => s + n, 0) / values.length
}

function starLabel(rating, useHalfStars) {
  if (useHalfStars) {
    return rating === 1 ? '1 star' : `${rating} stars`
  }
  return rating === 1 ? '1 star' : `${rating} stars`
}

function axisLabel(rating, useHalfStars) {
  if (useHalfStars) return String(rating)
  return `${rating}*`
}

function BucketModal({ bucket, useHalfStars, onReviewTap, onClose }) {
  const label = starLabel(bucket.rating, useHalfStars)
  return (
    <>
      <div className="prc-modal-header">
        <h2 className="prc-modal-title">{label}</h2>
        <button
          type="button"
          className="prc-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <LuX size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="prc-modal-list cm-scroll">
        {bucket.reviews.map((r) => (
          <button
            key={r.id}
            type="button"
            className="prc-modal-item"
            onClick={() => {
              onClose()
              onReviewTap(r.id)
            }}
          >
            {r.game_image ? (
              <img
                src={r.game_image}
                alt=""
                className="prc-modal-cover"
                loading="lazy"
              />
            ) : (
              <div className="prc-modal-cover prc-modal-cover--placeholder">
                <span>{(r.game_title || '?').charAt(0)}</span>
              </div>
            )}
            <div className="prc-modal-info">
              <span className="prc-modal-game">
                {r.game_title || 'Unknown Game'}
              </span>
              {r.body ? (
                <span className="prc-modal-excerpt">
                  {r.body.length > 90 ? r.body.slice(0, 90) + '…' : r.body}
                </span>
              ) : null}
            </div>
            <LuChevronRight
              size={16}
              className="prc-modal-chevron"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </>
  )
}

export default function ProfileRatingsChart({ reviews, onReviewTap, embedded = false }) {
  const [selectedBucket, setSelectedBucket] = useState(null)

  const rated = (reviews || []).filter((r) => Number(r.rating) > 0)
  const avg = meanRating(rated)

  if (rated.length === 0) return null

  const useHalfStars = hasHalfStarRatings(rated)
  const buckets = useHalfStars ? buildHalfStarBuckets(rated) : buildWholeStarBuckets(rated)
  const overallMax = Math.max(...buckets.map((b) => b.reviews.length), 1)

  return (
    <section
      className={`prc-section${embedded ? ' prc-section--embedded' : ''}`}
      aria-label="How I rate"
    >
      <div className="prc-header">
        <h3 className="prc-section-title">How I rate</h3>
        {avg != null && (
          <span className="prc-avg">
            avg {avg.toFixed(1)}
            <span className="prc-avg__star" aria-hidden="true">★</span>
          </span>
        )}
      </div>

      <div
        className="prc-chart"
        role="list"
        aria-label={`Rating distribution across ${rated.length} ratings`}
        style={{ '--prc-chart-height': `${CHART_HEIGHT_PX}px` }}
      >
        {buckets.map((bucket) => {
          const count = bucket.reviews.length
          const heightPx =
            count === 0
              ? 0
              : Math.max(MIN_BAR_PX, Math.round((count / overallMax) * CHART_HEIGHT_PX))
          const isClickable = count > 0

          return (
            <button
              key={bucket.rating}
              type="button"
              role="listitem"
              className={`prc-bar-btn${isClickable ? ' prc-bar-btn--active' : ''}`}
              onClick={() => { if (isClickable) setSelectedBucket(bucket) }}
              disabled={!isClickable}
              aria-label={`${starLabel(bucket.rating, useHalfStars)}: ${count} review${count !== 1 ? 's' : ''}`}
            >
              <span className="prc-bar-count" aria-hidden="true">{count}</span>
              <span className="prc-bar-stack">
                <span className="prc-bar-fill" style={{ height: `${heightPx}px` }} />
              </span>
              <span className="prc-bar-label" aria-hidden="true">
                {axisLabel(bucket.rating, useHalfStars)}
              </span>
            </button>
          )
        })}
      </div>

      <CenteredModal
        isOpen={selectedBucket !== null}
        onClose={() => setSelectedBucket(null)}
        onExited={() => setSelectedBucket(null)}
        ariaLabel={
          selectedBucket
            ? `${starLabel(selectedBucket.rating, useHalfStars)} reviews`
            : 'Rating reviews'
        }
        maxWidth={400}
      >
        {selectedBucket && (
          <BucketModal
            bucket={selectedBucket}
            useHalfStars={useHalfStars}
            onReviewTap={onReviewTap}
            onClose={() => setSelectedBucket(null)}
          />
        )}
      </CenteredModal>
    </section>
  )
}

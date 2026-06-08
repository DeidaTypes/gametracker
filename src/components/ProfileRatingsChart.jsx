import React, { useState } from 'react'
import { LuChevronRight, LuX } from 'react-icons/lu'
import CenteredModal from './CenteredModal'
import './ProfileRatingsChart.css'

/* ----------------------------------------------------------------
   Ten buckets for half-star ratings 0.5 → 5.0.
   Each bucket holds the raw Supabase review rows that belong to it.
   ---------------------------------------------------------------- */
const BUCKETS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]
const MAX_BAR_PX = 48

function buildBuckets(reviews) {
  const map = new Map(BUCKETS.map((b) => [b, []]))
  for (const r of reviews) {
    const rating = Number(r.rating)
    if (!Number.isFinite(rating)) continue
    // Snap to nearest 0.5-step and clamp within [0.5, 5.0]
    const snapped = Math.min(5.0, Math.max(0.5, Math.round(rating * 2) / 2))
    const key = BUCKETS.find((b) => Math.abs(b - snapped) < 0.01)
    if (key !== undefined) map.get(key).push(r)
  }
  return BUCKETS.map((b) => ({ rating: b, reviews: map.get(b) || [] }))
}

function starLabel(rating) {
  // "1 star", "0.5 stars", "4.5 stars", etc.
  const n = rating % 1 === 0 ? String(rating) : String(rating)
  return rating === 1 ? '1 star' : `${n} stars`
}

/* ---- Filtered list inside the modal ---- */
function BucketModal({ bucket, onReviewTap, onClose }) {
  const label = starLabel(bucket.rating)
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

/* ---- Main export ---- */
export default function ProfileRatingsChart({ reviews, onReviewTap }) {
  const [selectedBucket, setSelectedBucket] = useState(null)

  // Hide the whole section when the user has zero reviews
  if (!reviews || reviews.length === 0) return null

  const buckets = buildBuckets(reviews)
  const maxCount = Math.max(...buckets.map((b) => b.reviews.length), 1)

  const handleBarClick = (bucket) => {
    if (bucket.reviews.length === 0) return
    setSelectedBucket(bucket)
  }

  return (
    <section className="prc-section" aria-label="Ratings distribution">
      <h3 className="prc-section-title">Ratings</h3>

      {/* Bar chart */}
      <div
        className="prc-chart"
        role="list"
        aria-label="Rating buckets"
      >
        {buckets.map((bucket) => {
          const count = bucket.reviews.length
          const heightPx =
            count === 0
              ? 2
              : Math.max(4, Math.round((count / maxCount) * MAX_BAR_PX))
          const isClickable = count > 0

          return (
            <button
              key={bucket.rating}
              type="button"
              role="listitem"
              className={[
                'prc-bar-btn',
                isClickable ? 'prc-bar-btn--active' : '',
              ]
                .join(' ')
                .trim()}
              onClick={() => handleBarClick(bucket)}
              disabled={!isClickable}
              aria-label={`${starLabel(bucket.rating)}: ${count} review${count !== 1 ? 's' : ''}`}
            >
              <div
                className="prc-bar-fill"
                style={{ height: `${heightPx}px` }}
              />
            </button>
          )
        })}
      </div>

      {/* Axis labels */}
      <div className="prc-axis-labels" aria-hidden="true">
        <span className="prc-axis-label">0.5 star</span>
        <span className="prc-axis-label">5 stars</span>
      </div>

      {/* Tap-through modal */}
      <CenteredModal
        isOpen={selectedBucket !== null}
        onClose={() => setSelectedBucket(null)}
        onExited={() => setSelectedBucket(null)}
        ariaLabel={
          selectedBucket
            ? `${starLabel(selectedBucket.rating)} reviews`
            : 'Rating reviews'
        }
        maxWidth={400}
      >
        {selectedBucket && (
          <BucketModal
            bucket={selectedBucket}
            onReviewTap={onReviewTap}
            onClose={() => setSelectedBucket(null)}
          />
        )}
      </CenteredModal>
    </section>
  )
}

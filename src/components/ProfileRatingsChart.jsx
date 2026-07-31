import React, { useState } from 'react'
import { LuChevronRight, LuX } from 'react-icons/lu'
import CenteredModal from './CenteredModal'
import './ProfileRatingsChart.css'

/* ----------------------------------------------------------------
   Five whole-star buckets. Each bucket holds the raw Supabase review
   rows that belong to it, so tapping a bar can list its games.

   Half-star ratings snap to the nearest whole star — the chart reads
   as five labelled columns rather than ten, which is only legible at
   this width if each column carries real weight.
   ---------------------------------------------------------------- */
const BUCKETS = [1, 2, 3, 4, 5]
const CHART_HEIGHT_PX = 72
const MIN_BAR_PX = 3

// A histogram over one or two ratings describes the sample, not the
// person. Below this the section hides rather than drawing a chart that
// is almost entirely empty.
const MIN_RATINGS_FOR_CHART = 3

function buildBuckets(reviews) {
  const map = new Map(BUCKETS.map((b) => [b, []]))
  for (const r of reviews) {
    const rating = Number(r.rating)
    if (!Number.isFinite(rating) || rating <= 0) continue
    const snapped = Math.min(5, Math.max(1, Math.round(rating)))
    map.get(snapped).push(r)
  }
  return BUCKETS.map((b) => ({ rating: b, reviews: map.get(b) || [] }))
}

/** Mean of the real ratings, from the raw values rather than the
 *  snapped buckets so the readout matches the player card's Avg ★. */
function meanRating(reviews) {
  const values = reviews
    .map((r) => Number(r.rating))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (values.length === 0) return null
  return values.reduce((s, n) => s + n, 0) / values.length
}

function starLabel(rating) {
  return rating === 1 ? '1 star' : `${rating} stars`
}

/* ---- Filtered list inside the bucket tap-through modal ---- */
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

/* ---- Main export ----
   "How I Rate" — the rating-distribution histogram on Profile Home.
   Five columns with the count above each bar, a baseline under them,
   and the real average in the section header. Tapping a bar with
   reviews behind it opens the list of those games.

   Hides itself entirely below MIN_RATINGS_FOR_CHART so a brand-new
   account never sees a chart that is one bar and four gaps. */
export default function ProfileRatingsChart({ reviews, onReviewTap }) {
  /* ---- ALL hooks first — React Rules of Hooks ---- */
  const [selectedBucket, setSelectedBucket] = useState(null)

  /* ---- Derived data ---- */
  const rated = (reviews || []).filter((r) => Number(r.rating) > 0)
  const avg = meanRating(rated)

  /* ---- Too little data to chart — after all hooks ---- */
  if (rated.length < MIN_RATINGS_FOR_CHART) return null

  const buckets = buildBuckets(rated)
  const overallMax = Math.max(...buckets.map((b) => b.reviews.length), 1)

  /* ---- Render ---- */
  return (
    <section className="prc-section" aria-label="How I rate">
      <div className="prc-header">
        <h3 className="prc-section-title">How I Rate</h3>
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
              aria-label={`${starLabel(bucket.rating)}: ${count} review${count !== 1 ? 's' : ''}`}
            >
              <span className="prc-bar-count" aria-hidden="true">{count}</span>
              <span className="prc-bar-stack">
                <span className="prc-bar-fill" style={{ height: `${heightPx}px` }} />
              </span>
              <span className="prc-bar-label" aria-hidden="true">
                {bucket.rating}★
              </span>
            </button>
          )
        })}
      </div>

      {/* Tap-through modal — lists games in the tapped bucket */}
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

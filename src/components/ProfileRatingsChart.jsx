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
    const snapped = Math.min(5.0, Math.max(0.5, Math.round(rating * 2) / 2))
    const key = BUCKETS.find((b) => Math.abs(b - snapped) < 0.01)
    if (key !== undefined) map.get(key).push(r)
  }
  return BUCKETS.map((b) => ({ rating: b, reviews: map.get(b) || [] }))
}

/* ----------------------------------------------------------------
   Personality label derived from the real distribution.

   Algorithm:
     1. Weighted mean   = Σ(rating × count) / total
     2. Std deviation   = √(Σ(count × (rating − mean)²) / total)
     3. Primary label   from mean thresholds
     4. Modifier clause appended when spread is unusually high/low

   Requires at least 3 reviews to be meaningful; returns null otherwise
   so the UI can hide the label cleanly for new accounts.

   Note: `label` mirrors ProfileTasteDNA's "Generous rater" persona tag
   at the mean >= 4.0 threshold. That tag already renders once above
   this chart, so this component only surfaces `desc`/`mean` as prose —
   never its own duplicate chip.
   ---------------------------------------------------------------- */
function computePersonality(buckets) {
  const total = buckets.reduce((s, b) => s + b.reviews.length, 0)
  if (total < 3) return null

  const mean =
    buckets.reduce((s, b) => s + b.rating * b.reviews.length, 0) / total

  const variance =
    buckets.reduce(
      (s, b) => s + b.reviews.length * Math.pow(b.rating - mean, 2),
      0
    ) / total
  const stdDev = Math.sqrt(variance)

  let baseDesc
  if (mean >= 4.0) {
    baseDesc = 'You tend to love most games you play'
  } else if (mean >= 3.5) {
    baseDesc = 'You lean toward the positive'
  } else if (mean >= 3.0) {
    baseDesc = 'You call it as you see it'
  } else if (mean >= 2.5) {
    baseDesc = 'You hold games to a high standard'
  } else {
    baseDesc = 'Games rarely earn your full praise'
  }

  let modifier = ''
  if (stdDev >= 1.4) {
    modifier = ' — your opinions are strongly felt'
  } else if (stdDev <= 0.6 && total >= 10) {
    modifier = ' — and remarkably consistent'
  }

  return {
    desc: baseDesc + modifier,
    mean: Math.round(mean * 10) / 10,
    stdDev: Math.round(stdDev * 10) / 10,
  }
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
   Renders the avg + histogram only — no section chrome of its own.
   This chart lives inside the Profile Taste card, directly below
   ProfileTasteDNA's genre legend, so it deliberately has no title,
   no personality chip (already shown as a persona tag above it), and
   no Compare affordance. */
export default function ProfileRatingsChart({ reviews, onReviewTap, hideTitle = false }) {
  /* ---- ALL hooks first — React Rules of Hooks ---- */
  const [selectedBucket, setSelectedBucket] = useState(null)

  /* ---- Early return for zero-review accounts — after all hooks ---- */
  if (!reviews || reviews.length === 0) return null

  /* ---- Derived data ---- */
  const buckets = buildBuckets(reviews)
  const personality = computePersonality(buckets)

  const overallMax = Math.max(...buckets.map((b) => b.reviews.length), 1)

  /* ---- Render ---- */
  return (
    <section className="prc-section" aria-label="Ratings distribution">
      {!hideTitle && (
        <div className="prc-header">
          <h3 className="prc-section-title">Ratings</h3>
        </div>
      )}

      {/* Bar chart */}
      <div className="prc-chart" role="list" aria-label="Rating buckets">
        {buckets.map((bucket) => {
          const count = bucket.reviews.length
          const heightPx =
            count === 0
              ? 2
              : Math.max(4, Math.round((count / overallMax) * MAX_BAR_PX))
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
              onClick={() => { if (isClickable) setSelectedBucket(bucket) }}
              disabled={!isClickable}
              aria-label={`${starLabel(bucket.rating)}: ${count} review${count !== 1 ? 's' : ''}`}
            >
              <div className="prc-bar-stack">
                <div
                  className="prc-bar-fill"
                  style={{ height: `${heightPx}px` }}
                />
              </div>
            </button>
          )
        })}
      </div>

      {/* Axis labels */}
      <div className="prc-axis-labels" aria-hidden="true">
        <span className="prc-axis-label">0.5★</span>
        <span className="prc-axis-label">5★</span>
      </div>

      {/* Personality insight — avg + prose only; the "Generous rater"
          etc. label itself is a persona tag rendered above, not here. */}
      {personality && (
        <p className="prc-personality-desc">
          Avg <strong>{personality.mean}</strong> · {personality.desc}
        </p>
      )}

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

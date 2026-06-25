import React, { useState, useCallback } from 'react'
import { LuChevronRight, LuX, LuGlobe, LuUsers } from 'react-icons/lu'
import CenteredModal from './CenteredModal'
import { getCommunityRatings, getReviewsForUser } from '../services/reviewService'
import { getFollowing } from '../services/followService'
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

/* Build a count-only bucket array from a flat array of rating numbers.
   Used for community / compare-user data where we don't need review rows. */
function buildCountBuckets(ratings) {
  const map = new Map(BUCKETS.map((b) => [b, 0]))
  for (const r of ratings) {
    const n = Number(r)
    if (!Number.isFinite(n) || n <= 0) continue
    const snapped = Math.min(5.0, Math.max(0.5, Math.round(n * 2) / 2))
    const key = BUCKETS.find((b) => Math.abs(b - snapped) < 0.01)
    if (key !== undefined) map.set(key, map.get(key) + 1)
  }
  return BUCKETS.map((b) => ({ rating: b, count: map.get(b) }))
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

  let label, baseDesc
  if (mean >= 4.0) {
    label = 'Generous Rater'
    baseDesc = 'You tend to love most games you play'
  } else if (mean >= 3.5) {
    label = 'Glass Half Full'
    baseDesc = 'You lean toward the positive'
  } else if (mean >= 3.0) {
    label = 'Balanced Critic'
    baseDesc = 'You call it as you see it'
  } else if (mean >= 2.5) {
    label = 'Hard to Please'
    baseDesc = 'You hold games to a high standard'
  } else {
    label = 'Tough Critic'
    baseDesc = 'Games rarely earn your full praise'
  }

  let modifier = ''
  if (stdDev >= 1.4) {
    modifier = ' — your opinions are strongly felt'
  } else if (stdDev <= 0.6 && total >= 10) {
    modifier = ' — and remarkably consistent'
  }

  return {
    label,
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

/* ---- Compare picker modal ---- */
function ComparePicker({ followingUsers, followingLoading, onCommunity, onUser, onClose }) {
  return (
    <>
      <div className="prc-modal-header">
        <h2 className="prc-modal-title">Compare with</h2>
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
        {/* Community option */}
        <button type="button" className="prc-modal-item" onClick={onCommunity}>
          <div className="prc-compare-icon-wrap">
            <LuGlobe size={20} aria-hidden="true" />
          </div>
          <div className="prc-modal-info">
            <span className="prc-modal-game">Community</span>
            <span className="prc-modal-excerpt">
              All ratings on the platform
            </span>
          </div>
          <LuChevronRight size={16} className="prc-modal-chevron" aria-hidden="true" />
        </button>

        {/* Following section */}
        {followingLoading ? (
          <div className="prc-compare-loading">Loading…</div>
        ) : followingUsers.length > 0 ? (
          <>
            <div className="prc-compare-section-label">
              <LuUsers size={12} aria-hidden="true" />
              Following
            </div>
            {followingUsers.map((row) => {
              const u = row.followee || row
              const name = u.display_name || u.username || '?'
              return (
                <button
                  key={u.id || row.followee_id}
                  type="button"
                  className="prc-modal-item"
                  onClick={() => onUser({ id: u.id || row.followee_id, label: name })}
                >
                  {u.avatar_url ? (
                    <img
                      src={u.avatar_url}
                      alt=""
                      className="prc-modal-cover prc-modal-avatar"
                      loading="lazy"
                    />
                  ) : (
                    <div className="prc-modal-cover prc-modal-cover--placeholder">
                      <span>{name.charAt(0).toUpperCase()}</span>
                    </div>
                  )}
                  <div className="prc-modal-info">
                    <span className="prc-modal-game">{name}</span>
                    {u.username && u.display_name && (
                      <span className="prc-modal-excerpt">@{u.username}</span>
                    )}
                  </div>
                  <LuChevronRight
                    size={16}
                    className="prc-modal-chevron"
                    aria-hidden="true"
                  />
                </button>
              )
            })}
          </>
        ) : (
          <p className="prc-compare-empty">
            Follow people to compare your rating curve with theirs.
          </p>
        )}
      </div>
    </>
  )
}

/* ---- Main export ---- */
export default function ProfileRatingsChart({ reviews, onReviewTap, currentUserId }) {
  /* ---- ALL hooks first — React Rules of Hooks ---- */
  const [selectedBucket, setSelectedBucket] = useState(null)
  const [showComparePicker, setShowComparePicker] = useState(false)
  const [compareMode, setCompareMode] = useState(null) // null | 'community' | { id, label }
  const [compareBuckets, setCompareBuckets] = useState(null) // array of { rating, count } | null
  const [compareLoading, setCompareLoading] = useState(false)
  const [followingUsers, setFollowingUsers] = useState([])
  const [followingLoading, setFollowingLoading] = useState(false)
  const [followingLoaded, setFollowingLoaded] = useState(false)

  const openComparePicker = useCallback(async () => {
    setShowComparePicker(true)
    if (!currentUserId || followingLoaded) return
    setFollowingLoading(true)
    setFollowingLoaded(true)
    try {
      const rows = await getFollowing(currentUserId, 100, 0)
      setFollowingUsers(rows || [])
    } catch {
      // soft-fail — community option still works
    } finally {
      setFollowingLoading(false)
    }
  }, [currentUserId, followingLoaded])

  const selectCommunity = useCallback(async () => {
    setShowComparePicker(false)
    setCompareLoading(true)
    setCompareMode('community')
    try {
      const ratings = await getCommunityRatings()
      setCompareBuckets(buildCountBuckets(ratings))
    } catch {
      setCompareBuckets(null)
      setCompareMode(null)
    } finally {
      setCompareLoading(false)
    }
  }, [])

  const selectUser = useCallback(async ({ id, label }) => {
    setShowComparePicker(false)
    setCompareLoading(true)
    setCompareMode({ id, label })
    try {
      const rows = await getReviewsForUser(id)
      const ratings = (rows || []).map((r) => Number(r.rating))
      setCompareBuckets(buildCountBuckets(ratings))
    } catch {
      setCompareBuckets(null)
      setCompareMode(null)
    } finally {
      setCompareLoading(false)
    }
  }, [])

  const clearCompare = useCallback(() => {
    setCompareMode(null)
    setCompareBuckets(null)
  }, [])

  /* ---- Early return for zero-review accounts — after all hooks ---- */
  if (!reviews || reviews.length === 0) return null

  /* ---- Derived data ---- */
  const buckets = buildBuckets(reviews)
  const personality = computePersonality(buckets)

  const userMax = Math.max(...buckets.map((b) => b.reviews.length), 1)
  const compareMax = compareBuckets
    ? Math.max(...compareBuckets.map((b) => b.count), 1)
    : 1
  // Scale both curves to the same axis so the taller bar reaches MAX_BAR_PX
  const overallMax = compareBuckets ? Math.max(userMax, compareMax) : userMax

  const compareLabel =
    compareMode === 'community'
      ? 'Community'
      : compareMode?.label || ''

  /* ---- Render ---- */
  return (
    <section className="prc-section" aria-label="Ratings distribution">
      {/* Header: title + personality badge + compare toggle */}
      <div className="prc-header">
        <div className="prc-header-left">
          <h3 className="prc-section-title">Ratings</h3>
          {personality && (
            <span className="prc-personality-badge" aria-label={`Rater type: ${personality.label}`}>
              {personality.label}
            </span>
          )}
        </div>

        {currentUserId && (
          compareMode ? (
            <button
              type="button"
              className="prc-compare-active-btn"
              onClick={clearCompare}
              aria-label={`Remove comparison with ${compareLabel}`}
            >
              <span className="prc-compare-active-label">{compareLabel}</span>
              <LuX size={12} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="prc-compare-btn"
              onClick={openComparePicker}
              aria-label="Compare your ratings"
            >
              Compare
            </button>
          )
        )}
      </div>

      {/* Bar chart */}
      <div
        className={['prc-chart', compareLoading ? 'prc-chart--loading' : ''].join(' ').trim()}
        role="list"
        aria-label="Rating buckets"
      >
        {buckets.map((bucket, idx) => {
          const count = bucket.reviews.length
          const heightPx =
            count === 0
              ? 2
              : Math.max(4, Math.round((count / overallMax) * MAX_BAR_PX))
          const isClickable = count > 0

          const cCount = compareBuckets ? (compareBuckets[idx]?.count ?? 0) : 0
          const compareHeightPx =
            cCount === 0
              ? 0
              : Math.max(4, Math.round((cCount / overallMax) * MAX_BAR_PX))

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
                {compareHeightPx > 0 && (
                  <div
                    className="prc-bar-fill prc-bar-fill--compare"
                    style={{ height: `${compareHeightPx}px` }}
                    aria-hidden="true"
                  />
                )}
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

      {/* Compare legend (shown when comparison is active and data is ready) */}
      {compareBuckets && !compareLoading && (
        <div className="prc-legend" aria-label="Chart legend">
          <span className="prc-legend-item">
            <span className="prc-legend-dot prc-legend-dot--you" aria-hidden="true" />
            You
          </span>
          <span className="prc-legend-item">
            <span className="prc-legend-dot prc-legend-dot--compare" aria-hidden="true" />
            {compareLabel}
          </span>
        </div>
      )}

      {/* Personality insight (hidden while a compare overlay is active) */}
      {personality && !compareBuckets && !compareLoading && (
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

      {/* Compare picker modal */}
      <CenteredModal
        isOpen={showComparePicker}
        onClose={() => setShowComparePicker(false)}
        ariaLabel="Compare ratings with"
        maxWidth={400}
      >
        <ComparePicker
          followingUsers={followingUsers}
          followingLoading={followingLoading}
          onCommunity={selectCommunity}
          onUser={selectUser}
          onClose={() => setShowComparePicker(false)}
        />
      </CenteredModal>
    </section>
  )
}


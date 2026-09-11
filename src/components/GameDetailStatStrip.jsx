import React, { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { formatActivityDate } from '../utils/formatActivityDate'
import { getTotalHoursForGame } from '../services/hoursService'
import StarRatingDisplay from './StarRatingDisplay'
import './GameDetailStatStrip.css'

const RIDGE_BAR_COUNT = 5
/** Ridge track height in px — must match .gd-stat-strip__ridge height in CSS. */
const RIDGE_TRACK_PX = 22
/** Minimum bar height as a fraction of the track — keeps empty buckets visible, not hairlines. */
const RIDGE_FLOOR_FRAC = 0.22

function playedOnToDate(playedOn) {
  if (!playedOn) return null
  const [y, mo, d] = playedOn.split('-').map(Number)
  return new Date(y, mo - 1, d, 12, 0, 0)
}

function formatHoursValue(hours) {
  const n = Number(hours) || 0
  const rounded = Math.round(n * 100) / 100
  if (rounded % 1 === 0) return `${rounded}`
  return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * Collapse half-star histogram counts into five whole-star ridge buckets.
 *
 * HALF-STAR ROUNDING IS INTENTIONAL HERE ONLY. A 4.5 rolls UP into the 5
 * bucket (Math.ceil), a 3.5 into 4, etc. ProfileRatingsChart,
 * CommunityRatingCard, and getRatingDistributionForGame keep true half-star
 * buckets — do NOT reconcile them with this meter; this groups for space.
 */
function buildRidgeBuckets(halfStarCounts) {
  const buckets = Array(RIDGE_BAR_COUNT).fill(0)
  if (!halfStarCounts) return buckets

  for (const [starKey, count] of Object.entries(halfStarCounts)) {
    const star = Number(starKey)
    if (!Number.isFinite(star) || star <= 0) continue
    const bucketIdx = Math.min(RIDGE_BAR_COUNT - 1, Math.max(0, Math.ceil(star) - 1))
    buckets[bucketIdx] += Number(count) || 0
  }
  return buckets
}

function ridgeBarHeights(buckets, totalCount) {
  if (totalCount <= 0) {
    return Array(RIDGE_BAR_COUNT).fill(RIDGE_FLOOR_FRAC)
  }
  return buckets.map((count) => {
    if (count <= 0) return RIDGE_FLOOR_FRAC
    const share = count / totalCount
    return Math.max(RIDGE_FLOOR_FRAC, share)
  })
}

/**
 * GameDetailStatStrip — single bordered container split into YOUR TIME (left)
 * and COMMUNITY (right). Replaces the former session row + rating histogram.
 */
export default function GameDetailStatStrip({
  sessions = [],
  ratingDist,
  onOpenSessions,
  onOpenRatingDistribution,
}) {
  const sessionCount = sessions.length
  const latestSession = sessions[0] || null
  const totalHours = getTotalHoursForGame(sessions)
  const hasSessions = sessionCount > 0

  const relativeTime = latestSession
    ? formatActivityDate(playedOnToDate(latestSession.playedOn))
    : null

  const totalCount = ratingDist?.totalCount ?? 0
  const hasRatings = totalCount > 0 && ratingDist?.average != null && !ratingDist?.error
  const average = hasRatings ? ratingDist.average : null

  const ridgeBuckets = useMemo(
    () => buildRidgeBuckets(ratingDist?.counts),
    [ratingDist?.counts]
  )
  const barHeights = useMemo(
    () => ridgeBarHeights(ridgeBuckets, totalCount),
    [ridgeBuckets, totalCount]
  )

  const sessionMeta = hasSessions
    ? `${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}${relativeTime ? ` - ${relativeTime}` : ''}`
    : 'No sessions yet'

  return (
    <div className="gd-stat-strip-wrap">
      <div className="gd-stat-strip">
        <button
          type="button"
          className="gd-stat-strip__half gd-stat-strip__half--time"
          onClick={onOpenSessions}
          aria-label={
            hasSessions
              ? `Your time — ${formatHoursValue(totalHours)} hours, ${sessionMeta}. View sessions`
              : 'Your time — no sessions logged. View sessions'
          }
        >
          <span className="gd-stat-strip__label">Your time</span>
          <div className="gd-stat-strip__value-row">
            <span
              className={`gd-stat-strip__value${hasSessions ? '' : ' gd-stat-strip__value--muted'}`}
              aria-hidden="true"
            >
              {formatHoursValue(totalHours)}
              <span className="gd-stat-strip__unit">h</span>
            </span>
          </div>
          <span className="gd-stat-strip__meta">
            <span className="gd-stat-strip__meta-text">{sessionMeta}</span>
            <ChevronRight size={12} aria-hidden="true" className="gd-stat-strip__chevron" />
          </span>
        </button>

        <div className="gd-stat-strip__divider" aria-hidden="true" />

        <button
          type="button"
          className="gd-stat-strip__half gd-stat-strip__half--community"
          onClick={onOpenRatingDistribution}
          aria-label={
            hasRatings
              ? `Community rating — ${average.toFixed(1)} out of 5 from ${totalCount} ${totalCount === 1 ? 'rating' : 'ratings'}. View distribution`
              : 'Community — not rated yet. View distribution'
          }
        >
          <span className="gd-stat-strip__label">Community</span>
          {hasRatings ? (
            <div className="gd-stat-strip__rating-row">
              <span className="gd-stat-strip__value gd-stat-strip__value--rating">
                {average.toFixed(1)}
              </span>
              <StarRatingDisplay rating={average} size={10} />
            </div>
          ) : (
            <div className="gd-stat-strip__rating-row gd-stat-strip__rating-row--empty">
              <StarRatingDisplay rating={0} size={10} />
              <span className="gd-stat-strip__empty-label">Not rated yet</span>
            </div>
          )}

          <div
            className="gd-stat-strip__ridge"
            role="img"
            aria-hidden="true"
            aria-label={hasRatings ? 'Five-star rating ridge' : undefined}
          >
            {barHeights.map((heightFrac, idx) => {
              const filled = hasRatings && ridgeBuckets[idx] > 0
              const barPx = Math.max(
                Math.round(RIDGE_FLOOR_FRAC * RIDGE_TRACK_PX),
                Math.round(heightFrac * RIDGE_TRACK_PX)
              )
              return (
                <span
                  key={idx}
                  className={`gd-stat-strip__ridge-bar${filled ? ' gd-stat-strip__ridge-bar--filled' : ''}`}
                  style={{ height: `${barPx}px` }}
                />
              )
            })}
          </div>
        </button>
      </div>
    </div>
  )
}

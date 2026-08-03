import React from 'react'
import { useNavigate } from 'react-router-dom'
import Pressable from '../Pressable'
import EmptyState from '../EmptyState'
import { getBestImageUrl } from '../../services/imageUtils'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import './GotAnHourRail.css'

// ── Buckets ───────────────────────────────────────────────────────────────────
// min/max are in HOURS (exclusive upper bound except Epic which is >=min).
// "Under 2h"       → main story < 2 h
// "Short · under 8h" → 2 h ≤ main story < 8 h
// "Weekend · 8–20h"  → 8 h ≤ main story < 20 h
// "Epic · 50h+"      → main story ≥ 50 h

export const TTB_BUCKETS = [
  { id: 'quick',   label: 'Under 2h',          min: 0,  max: 2 },
  { id: 'short',   label: 'Short · under 8h',  min: 2,  max: 8 },
  { id: 'weekend', label: 'Weekend · 8–20h',   min: 8,  max: 20 },
  { id: 'epic',    label: 'Epic · 50h+',       min: 50, max: Infinity },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Pick the main-story hour value from a TTB result.
 * `hastilySeconds` = IGDB "main story" (rush run, minimal extras).
 * Fall back to `normallySeconds` only when hastily is absent.
 * Returns null when neither is a number — caller must exclude these games.
 * @param {{ hastilySeconds:number|null, normallySeconds:number|null }|null} ttb
 * @returns {number|null} hours
 */
export function mainStoryHours(ttb) {
  if (!ttb) return null
  const secs =
    typeof ttb.hastilySeconds === 'number'
      ? ttb.hastilySeconds
      : typeof ttb.normallySeconds === 'number'
        ? ttb.normallySeconds
        : null
  if (secs === null) return null
  return secs / 3600
}

/**
 * Returns true when `hours` falls inside the given bucket.
 */
export function inBucket(hours, bucket) {
  if (hours === null) return false
  return hours >= bucket.min && hours < bucket.max
}

function formatHours(hours) {
  if (hours < 1) return '< 1 hr'
  const rounded = Math.round(hours)
  return `~${rounded} hr${rounded !== 1 ? 's' : ''}`
}

// ── Chip bar ─────────────────────────────────────────────────────────────────

export function TimeBucketChips({ activeBucket, onChange }) {
  return (
    <div className="ttb-chips" role="group" aria-label="Filter games by play time">
      {TTB_BUCKETS.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`ttb-chip${activeBucket === b.id ? ' ttb-chip--active' : ''}`}
          onClick={() => onChange(b.id)}
          aria-pressed={activeBucket === b.id}
        >
          {b.label}
        </button>
      ))}
    </div>
  )
}

// ── Single game card ──────────────────────────────────────────────────────────

function TimeBeatCard({ game }) {
  const navigate = useNavigate()
  const img = getBestImageUrl(game, 600) || game.image
  const label = formatHours(game.mainStoryHours)

  function handleClick() {
    navigate(`/game/${game.id}`, { state: { coverImage: img } })
  }

  return (
    <Pressable
      className="ttb-card"
      onClick={handleClick}
      aria-label={`${game.title}, ${label} main story`}
    >
      <div className="ttb-card__cover">
        <img
          src={img || COVER_FALLBACK}
          alt=""
          loading="lazy"
          onError={(e) => { e.currentTarget.src = COVER_FALLBACK }}
        />
      </div>
      <div className="ttb-card__meta">
        <p className="ttb-card__title">{game.title}</p>
        <span className="ttb-card__badge">{label}</span>
      </div>
    </Pressable>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function GotAnHourSkeleton() {
  return (
    <div className="explore-scroll-row ttb-skeleton-row" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="ttb-card ttb-card--skel">
          <div className="ttb-card__cover skeleton" />
          <div className="ttb-card__meta">
            <div className="ttb-skel__title skeleton" />
            <div className="ttb-skel__badge skeleton" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Rail ──────────────────────────────────────────────────────────────────────

/**
 * Presentational rail for the "Got an hour?" section.
 * Props:
 *   games   — array of { id, title, image, mainStoryHours } already filtered
 *             to the active bucket. Never contains fabricated times.
 *   loading — true while TTB data is being fetched.
 */
function GotAnHourRail({ games, loading }) {
  if (loading) return <GotAnHourSkeleton />

  if (!games || games.length === 0) {
    return (
      <div className="explore-section__pad">
        <EmptyState size="inline" body="No games in this time range right now — try another." />
      </div>
    )
  }

  return (
    <div className="explore-scroll-row">
      {games.map((g) => (
        <TimeBeatCard key={g.id} game={g} />
      ))}
    </div>
  )
}

export default GotAnHourRail

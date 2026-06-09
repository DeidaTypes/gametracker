import React from 'react'
import { useNavigate } from 'react-router-dom'
import useGameOfWeek from '../../hooks/useGameOfWeek'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import './GameOfWeekHero.css'

// ── Stat pill helpers ────────────────────────────────────────────────────────

function RatingStat({ avgRating }) {
  if (avgRating == null) return null
  return (
    <span className="gotw-stat gotw-stat--rating" aria-label={`Average rating ${avgRating.toFixed(1)} out of 5`}>
      ★ {avgRating.toFixed(1)}
    </span>
  )
}

function TtbStat({ normallyHours }) {
  if (normallyHours == null) return null
  return (
    <span className="gotw-stat gotw-stat--ttb" aria-label={`Main story approximately ${normallyHours} hours`}>
      ~{normallyHours}h main story
    </span>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function GameOfWeekHero() {
  const navigate = useNavigate()
  const { featured, loading } = useGameOfWeek()

  // Skeleton while the first load is in-flight
  if (loading) {
    return (
      <div className="gotw-outer" aria-hidden="true">
        <div className="gotw-skeleton skeleton" />
      </div>
    )
  }

  // No active row → render nothing (no layout shift, no placeholder)
  if (!featured) return null

  const hasStats =
    featured.avgRating != null || featured.ttbNormallyHours != null

  function handleClick() {
    navigate(`/game/${featured.igdbGameId}`, {
      state: { coverImage: featured.coverUrl },
    })
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }

  return (
    <div className="gotw-outer">
      <div
        className="gotw-hero"
        role="button"
        tabIndex={0}
        aria-label={`Game of the Week: ${featured.title}. Tap to view game detail.`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      >
        {/* ── Blurred background art ── */}
        {featured.bgUrl && (
          <div className="gotw-bg" aria-hidden="true">
            <img
              src={featured.bgUrl}
              alt=""
              className="gotw-bg-img"
              loading="eager"
            />
            <div className="gotw-bg-overlay" />
          </div>
        )}

        {/* ── Cobalt accent bar at top ── */}
        <div className="gotw-accent-bar" aria-hidden="true" />

        {/* ── Foreground content ── */}
        <div className="gotw-fg">
          {/* Cover */}
          <div className="gotw-cover-wrap" aria-hidden="true">
            <img
              src={featured.coverUrl || COVER_FALLBACK}
              alt={featured.title}
              className="gotw-cover"
              loading="eager"
              onError={(e) => { e.currentTarget.src = COVER_FALLBACK }}
            />
          </div>

          {/* Info stack */}
          <div className="gotw-info">
            <span className="eyebrow gotw-eyebrow">Game of the Week</span>

            <h2 className="gotw-title">{featured.title}</h2>

            {featured.year != null && (
              <span className="gotw-year">{featured.year}</span>
            )}

            {featured.blurb && (
              <p className="gotw-blurb">{featured.blurb}</p>
            )}

            {hasStats && (
              <div className="gotw-stats" aria-label="Game stats">
                <RatingStat avgRating={featured.avgRating} />
                <TtbStat normallyHours={featured.ttbNormallyHours} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

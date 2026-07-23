import React from 'react'
import { useNavigate } from 'react-router-dom'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { shouldShowCount } from '../../utils/formatSocialCount'
import './MostPlayedRail.css'

/**
 * Converts total minutes to a human-readable hours string.
 * 0 minutes that somehow got through → "< 1 hr".
 * Formatted with locale commas for large numbers (e.g. "1,240 hrs").
 */
function formatHours(totalMinutes) {
  const hours = Math.round(totalMinutes / 60)
  if (hours === 0) return '< 1 hr'
  return `${hours.toLocaleString()} ${hours === 1 ? 'hr' : 'hrs'}`
}

// ── Movement indicator (circle mode only) ─────────────────────────────────

function MovementBadge({ movement, delta }) {
  if (movement === 'new') {
    return <span className="mpr-movement mpr-movement--new" aria-label="New entry">NEW</span>
  }
  if (movement === 'up') {
    return (
      <span className="mpr-movement mpr-movement--up" aria-label={`Up ${delta} position${delta !== 1 ? 's' : ''}`}>
        ↑{delta > 0 ? delta : ''}
      </span>
    )
  }
  if (movement === 'down') {
    return (
      <span className="mpr-movement mpr-movement--down" aria-label={`Down ${delta} position${delta !== 1 ? 's' : ''}`}>
        ↓{delta > 0 ? delta : ''}
      </span>
    )
  }
  // 'same' — render a visually quiet dash so the column stays aligned
  return <span className="mpr-movement mpr-movement--same" aria-hidden="true">—</span>
}

// ── Live chip (circle mode only, shown only when liveCount > 0) ───────────

function LiveChip({ count, onClick }) {
  if (!count) return null
  const label = shouldShowCount(count)
    ? `${count} friends playing — jump in`
    : 'Friends playing — jump in'
  return (
    <button
      type="button"
      className="mpr-live-chip"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      aria-label={label}
    >
      <span className="mpr-live-chip__dot" aria-hidden="true" />
      {label}
    </button>
  )
}

// ── Single ranked row ──────────────────────────────────────────────────────

function MostPlayedRow({ item, rank, mode }) {
  const navigate = useNavigate()

  function handleClick() {
    navigate(`/game/${item.igdb_game_id}`, {
      state: { coverImage: item.game_image },
    })
  }

  const isCircle = mode === 'circle'

  // ── Circle-mode row ──────────────────────────────────────────────────────
  if (isCircle) {
    const friendLabel = shouldShowCount(item.friend_count)
      ? `${item.friend_count} friends`
      : 'Friends'

    return (
      <Pressable
        as="div"
        className="mpr-row"
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-label={`${item.game_title} — rank ${rank}, ${friendLabel} active this week`}
      >
        {/* Rank + movement stacked */}
        <div className="mpr-row__rank-col">
          <span className="mpr-row__rank" aria-hidden="true">{rank}</span>
          <MovementBadge movement={item.movement} delta={item.movement_delta} />
        </div>

        <img
          className="mpr-row__cover"
          src={item.game_image || COVER_FALLBACK}
          alt=""
          loading="lazy"
          onError={(e) => { e.currentTarget.src = COVER_FALLBACK }}
        />

        <div className="mpr-row__info">
          <span className="mpr-row__title">{item.game_title}</span>
          <span className="mpr-row__meta">{friendLabel} this week</span>
          <LiveChip count={item.liveCount || 0} onClick={handleClick} />
        </div>

        {shouldShowCount(item.friend_count) && (
          <span className="mpr-row__friend-count" aria-hidden="true">
            {item.friend_count}
            <span className="mpr-row__friend-icon" aria-hidden="true">👤</span>
          </span>
        )}
      </Pressable>
    )
  }

  // ── Global-mode row (original) ────────────────────────────────────────────
  const playerLabel = shouldShowCount(item.player_count)
    ? `${item.player_count} players`
    : 'Being played this week'

  return (
    <Pressable
      as="div"
      className="mpr-row"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`${item.game_title} — rank ${rank}, ${playerLabel}, ${formatHours(item.total_minutes)}`}
    >
      <span className="mpr-row__rank" aria-hidden="true">{rank}</span>

      <img
        className="mpr-row__cover"
        src={item.game_image || COVER_FALLBACK}
        alt=""
        loading="lazy"
        onError={(e) => { e.currentTarget.src = COVER_FALLBACK }}
      />

      <div className="mpr-row__info">
        <span className="mpr-row__title">{item.game_title}</span>
        <span className="mpr-row__meta">{playerLabel}</span>
      </div>

      <span className="mpr-row__hours" aria-hidden="true">
        {formatHours(item.total_minutes)}
      </span>
    </Pressable>
  )
}

// ── Skeleton rows shown while fetching ────────────────────────────────────

function MostPlayedSkeleton() {
  return (
    <div className="mpr-list mpr-list--skeleton" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="mpr-row mpr-row--skel">
          <div className="mpr-skel__rank skeleton" />
          <div className="mpr-skel__cover skeleton" />
          <div className="mpr-skel__info">
            <div className="mpr-skel__title skeleton" />
            <div className="mpr-skel__meta skeleton" />
          </div>
          <div className="mpr-skel__hours skeleton" />
        </div>
      ))}
    </div>
  )
}

// ── Rail (section body) ───────────────────────────────────────────────────

/**
 * Presentational component for the Most Played ranked list.
 * Receives { data, loading, error, mode } from the parent (Explore.jsx).
 *
 * mode = 'global' (default) → community hours ranking (original)
 * mode = 'circle'           → follow-graph activity_events ranking with
 *                             WoW movement and live-friend chip
 *
 * Returns null on error or when data is empty — the parent wraps
 * the whole section in a conditional so no orphan <section> is left.
 */
function MostPlayedRail({ data, loading, error, mode = 'global' }) {
  if (loading) return <MostPlayedSkeleton />

  if (error || !data || data.length === 0) return null

  return (
    <div className="mpr-list">
      {data.map((item, idx) => (
        <MostPlayedRow
          key={item.igdb_game_id}
          item={item}
          rank={idx + 1}
          mode={mode}
        />
      ))}
    </div>
  )
}

export default MostPlayedRail

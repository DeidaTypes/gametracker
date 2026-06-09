import React from 'react'
import { useNavigate } from 'react-router-dom'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
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

// ── Single ranked row ──────────────────────────────────────────────────────

function MostPlayedRow({ item, rank }) {
  const navigate = useNavigate()

  function handleClick() {
    navigate(`/game/${item.igdb_game_id}`, {
      state: { coverImage: item.game_image },
    })
  }

  const playerLabel =
    item.player_count === 1 ? '1 player' : `${item.player_count} players`

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
 * Presentational component for the "Most played this week" ranked list.
 * Receives { data, loading, error } from the parent (Explore.jsx).
 * Returns null on error or when data is empty — the parent wraps
 * the whole section in a conditional so no orphan <section> is left.
 */
function MostPlayedRail({ data, loading, error }) {
  if (loading) return <MostPlayedSkeleton />

  if (error || !data || data.length === 0) return null

  return (
    <div className="mpr-list">
      {data.map((item, idx) => (
        <MostPlayedRow key={item.igdb_game_id} item={item} rank={idx + 1} />
      ))}
    </div>
  )
}

export default MostPlayedRail

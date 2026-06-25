import React from 'react'
import { useNavigate } from 'react-router-dom'
import useEventWeek from '../../hooks/useEventWeek'
import Pressable from '../Pressable'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import './EventWeekBanner.css'

// ── Date label ────────────────────────────────────────────────────────────────

function formatDateRange(startDate, endDate) {
  const fmt = (iso) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  return `${fmt(startDate)} – ${fmt(endDate)}`
}

// ── Game cover tile ───────────────────────────────────────────────────────────

function EventGameTile({ game }) {
  const navigate = useNavigate()
  return (
    <Pressable
      as="div"
      className="ewb-game-tile"
      onClick={() => navigate(`/game/${game.id}`, { state: { coverImage: game.image } })}
      role="button"
      tabIndex={0}
      aria-label={game.title}
    >
      <img
        className="ewb-game-tile__cover"
        src={game.image || COVER_FALLBACK}
        alt=""
        loading="lazy"
        onError={(e) => {
          e.currentTarget.src = COVER_FALLBACK
        }}
      />
      {game.rating && (
        <span className="ewb-game-tile__rating" aria-hidden="true">
          ★ {game.rating}
        </span>
      )}
    </Pressable>
  )
}

// ── Leaderboard row ───────────────────────────────────────────────────────────

function LeaderboardRow({ entry, rank }) {
  const navigate = useNavigate()
  const target = entry.username
    ? `/profile/${entry.username}`
    : `/user/${entry.userId}`

  const sessionLabel =
    entry.eventCount === 1 ? '1 session' : `${entry.eventCount} sessions`

  return (
    <Pressable
      as="div"
      className="ewb-lb-row"
      onClick={() => navigate(target)}
      role="button"
      tabIndex={0}
      aria-label={`${entry.displayName} — rank ${rank}, ${sessionLabel}`}
    >
      <span className="ewb-lb-row__rank" aria-hidden="true">
        {rank}
      </span>

      <div className="ewb-lb-row__avatar-wrap">
        {entry.avatarUrl ? (
          <img
            className="ewb-lb-row__avatar"
            src={entry.avatarUrl}
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="ewb-lb-row__avatar ewb-lb-row__avatar--fallback" aria-hidden="true">
            {(entry.displayName || '?')[0].toUpperCase()}
          </div>
        )}
      </div>

      <span className="ewb-lb-row__name">{entry.displayName}</span>

      <span className="ewb-lb-row__sessions" aria-hidden="true">
        {sessionLabel}
      </span>
    </Pressable>
  )
}

// ── Skeleton shown while loading ──────────────────────────────────────────────

function EventWeekSkeleton() {
  return (
    <div className="ewb-skeleton" aria-hidden="true">
      <div className="ewb-skeleton__header">
        <div className="skeleton ewb-skeleton__title" />
        <div className="skeleton ewb-skeleton__badge" />
      </div>
      <div className="ewb-skeleton__strip">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton ewb-skeleton__cover" />
        ))}
      </div>
    </div>
  )
}

// ── Banner ────────────────────────────────────────────────────────────────────

/**
 * Self-contained "Event Week" section for the Discover page.
 *
 * Calls `useEventWeek()` internally (same pattern as GameOfWeekHero).
 * Renders nothing when:
 *  - No event week is active (outside the configured date range), OR
 *  - The IGDB filters returned zero games with covers.
 *
 * The mini-leaderboard is conditionally rendered only when at least one
 * user has activity_events for the themed games in the past 7 days.
 */
export default function EventWeekBanner() {
  const { eventWeek, loading } = useEventWeek()

  if (loading) return <EventWeekSkeleton />
  if (!eventWeek || eventWeek.games.length === 0) return null

  const { config, games, leaderboard } = eventWeek
  const dateLabel = formatDateRange(config.startDate, config.endDate)

  return (
    <div className="ewb">
      {/* Header */}
      <div className="ewb__head explore-section__pad">
        <div className="ewb__title-row">
          <span className="ewb__emoji" aria-hidden="true">
            {config.emoji}
          </span>
          <h2 className="ewb__title">{config.title}</h2>
          <span className="ewb__date-badge" aria-label={`Event runs ${dateLabel}`}>
            {dateLabel}
          </span>
        </div>
        <p className="ewb__subtitle">{config.subtitle}</p>
      </div>

      {/* Game covers — horizontal scroll */}
      <div className="ewb__covers-row" role="list" aria-label={`${config.title} games`}>
        {games.map((game) => (
          <div key={game.id} role="listitem">
            <EventGameTile game={game} />
          </div>
        ))}
      </div>

      {/* Mini-leaderboard — hidden when no one is playing */}
      {leaderboard.length > 0 && (
        <div className="ewb__leaderboard explore-section__pad">
          <p className="ewb__lb-label">Playing this week</p>
          <div className="ewb__lb-list">
            {leaderboard.map((entry, i) => (
              <LeaderboardRow key={entry.userId} entry={entry} rank={i + 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

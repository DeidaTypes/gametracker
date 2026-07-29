import React from 'react'
import { useNavigate } from 'react-router-dom'
import SharedCover from './SharedCover'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { formatActivityDate } from '../utils/formatActivityDate'
import './HomeShelf.css'

/**
 * RecentActivitySection — a glance at the games you most recently looked at.
 *
 * Sourced from the viewed-games history (the last game detail pages you
 * opened), newest first. Presented as a boxed card consistent with
 * BacklogSection. The parent (Home) hides this section entirely when there is
 * no view history, so this component assumes a non-empty `games` array (no
 * internal empty state, per the no-empty-sections rule).
 *
 * Props:
 *   games  array of { id, title, image, viewedAt }
 */
function RecentActivitySection({ games = [] }) {
  const navigate = useNavigate()

  if (games.length === 0) return null

  return (
    <div className="shelf-box shelf-box--recent">
      <div className="shelf-head">
        <h2 className="shelf-title">Recent Activity</h2>
      </div>

      <div className="shelf-rail" role="list">
        {games.map((game) => {
          const when = formatActivityDate(game.viewedAt) || null
          return (
            <button
              key={game.id}
              type="button"
              role="listitem"
              className="shelf-cover-card"
              onClick={() =>
                navigate(`/game/${game.id}`, { state: { coverImage: game.image } })
              }
              aria-label={game.title}
            >
              <div className="shelf-cover-wrap">
                {game.image ? (
                  <SharedCover gameId={game.id} imageSrc={game.image}>
                    <img
                      src={game.image}
                      alt=""
                      className="shelf-cover-img"
                      loading="lazy"
                      onError={(e) => {
                        e.target.src = COVER_FALLBACK
                      }}
                    />
                  </SharedCover>
                ) : (
                  <div className="shelf-cover-fallback">
                    {game.title?.charAt(0) || '?'}
                  </div>
                )}
              </div>
              <span className="shelf-cover-title">{game.title}</span>
              {when && <span className="shelf-cover-meta">Viewed {when}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default RecentActivitySection

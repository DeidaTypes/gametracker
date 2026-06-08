import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Bookmark, ChevronRight } from 'lucide-react'
import SharedCover from './SharedCover'
import EmptyState from './EmptyState'
import { COVER_FALLBACK } from '../utils/coverFallback'
import './HomeShelf.css'

/**
 * BacklogSection — the "what's next" card for Want to Play games.
 *
 * Presented as a boxed card (consistent with RecentActivitySection) so the
 * dashboard reads as a set of tidy panels under the Continue Playing hero.
 * Tapping a cover routes to its game detail. The header "Add" action, the
 * trailing "+" tile, and the empty-state CTA all open the focused tracker
 * search popup (via onAddGame) instead of navigating away to Explore.
 *
 * Props:
 *   games      array of Want-to-Play games
 *   onAddGame  () => void — opens the focused "add to Want to Play" popup
 */
function BacklogSection({ games = [], onAddGame }) {
  const navigate = useNavigate()
  const count = games.length

  if (count === 0) {
    return (
      <div className="shelf-box shelf-box--backlog">
        <div className="shelf-head">
          <h2 className="shelf-title">Your Backlog</h2>
        </div>
        <div className="shelf-empty">
          <EmptyState
            icon={Bookmark}
            title="Nothing waiting yet."
            body="Add games you want to play next and they'll line up here."
            cta="Add a game"
            onCta={onAddGame}
            compact
          />
        </div>
      </div>
    )
  }

  return (
    <div className="shelf-box shelf-box--backlog">
      <div className="shelf-head">
        <h2 className="shelf-title">Your Backlog</h2>
        <button
          type="button"
          className="shelf-link"
          onClick={() =>
            navigate('/list/want-to-play', {
              state: { selectedListId: 'want-to-play' },
            })
          }
          aria-label="Open your Want to Play list"
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="shelf-rail" role="list">
        {games.map((game) => (
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
          </button>
        ))}

        {/* Trailing add tile — reinforces the new add-from-here flow. */}
        <button
          type="button"
          className="shelf-add-tile"
          onClick={onAddGame}
          aria-label="Add a game to Want to Play"
        >
          <span className="shelf-add-icon" aria-hidden="true">
            <Plus size={20} strokeWidth={2.4} />
          </span>
          <span className="shelf-add-label">Add</span>
        </button>
      </div>
    </div>
  )
}

export default BacklogSection

import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bookmark, ChevronRight, Shuffle } from 'lucide-react'
import SharedCover from './SharedCover'
import EmptyState from './EmptyState'
import { COVER_FALLBACK } from '../utils/coverFallback'
import BacklogRoulette from './BacklogRoulette'
import './HomeShelf.css'

/**
 * BacklogSection — compact horizontal peek row for Home.
 *
 * Shows a single scrolling rail of small 84 px cover tiles (2:3 ratio).
 * Mood shelves live on Explore's Swipe-to-Discover deck; they were removed
 * from Home to keep the feed high on the page.
 *
 * Props:
 *   games      array of Want-to-Play games
 *   onAddGame  () => void — opens the focused "add to Want to Play" popup
 */
function BacklogSection({ games = [], onAddGame }) {
  const navigate = useNavigate()
  const [rouletteOpen, setRouletteOpen] = useState(false)
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
        <h2 className="shelf-title">Your Backlog · {count}</h2>
        <div className="shelf-head-end">
          <button
            type="button"
            className="shelf-spin-btn"
            onClick={() => setRouletteOpen(true)}
            aria-label="Spin Backlog Roulette — pick a random game"
          >
            <Shuffle size={13} strokeWidth={2.4} aria-hidden="true" />
            Spin
          </button>
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
      </div>

      {/* Single horizontal peek rail — no mood shelves, no title text below covers */}
      <div
        className="shelf-rail backlog-peek-rail"
        role="list"
        aria-label="Your backlog games"
      >
        {games.map((game) => (
          <button
            key={game.id}
            type="button"
            role="listitem"
            className="backlog-peek-card"
            onClick={() =>
              navigate(`/game/${game.id}`, { state: { coverImage: game.image } })
            }
            aria-label={game.title}
          >
            <div className="backlog-peek-cover">
              {game.image ? (
                <SharedCover gameId={game.id} imageSrc={game.image}>
                  <img
                    src={game.image}
                    alt=""
                    className="shelf-cover-img"
                    loading="lazy"
                    onError={(e) => { e.target.src = COVER_FALLBACK }}
                  />
                </SharedCover>
              ) : (
                <div className="shelf-cover-fallback">
                  {game.title?.charAt(0) || '?'}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      <BacklogRoulette
        isOpen={rouletteOpen}
        onClose={() => setRouletteOpen(false)}
        games={games}
      />
    </div>
  )
}

export default BacklogSection

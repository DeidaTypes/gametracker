import React, { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Bookmark, ChevronRight, Shuffle, Clock, X } from 'lucide-react'
import SharedCover from './SharedCover'
import EmptyState from './EmptyState'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { useBacklogShelves } from '../hooks/useBacklogShelves'
import BacklogRoulette from './BacklogRoulette'
import { getBacklogClearsThisYear } from '../services/libraryService'
import './HomeShelf.css'

const STALE_MS = 180 * 24 * 60 * 60 * 1000 // 6 months

/**
 * BacklogSection — the "what's next" card for Want to Play games.
 *
 * When the backlog has games the section flips from a flat cover rail into
 * mood/length shelves powered by real IGDB attributes:
 *
 *   ⚡ Quick Wins      — time_to_beat normally ≤ 8 h
 *   😢 I want to cry  — IGDB theme 31 (Drama)
 *   🤝 Co-op Night    — IGDB game_mode 3 (Co-operative)
 *   👻 Spooky         — IGDB theme 19 (Horror)
 *   🌅 Just Vibes     — IGDB theme 33 (Sandbox) or 38 (Open world)
 *   🧩 Puzzle Brain   — IGDB genre 9 (Puzzle)
 *
 * Shelves with no matching games are hidden. While IGDB metadata is still
 * loading the flat rail is shown so there's no jarring layout shift.
 *
 * Props:
 *   games      array of Want-to-Play games
 *   onAddGame  () => void — opens the focused "add to Want to Play" popup
 */
function CoverRail({ games, onAddGame }) {
  const navigate = useNavigate()
  return (
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

      {onAddGame && (
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
      )}
    </div>
  )
}

function BacklogSection({ games = [], onAddGame }) {
  const navigate = useNavigate()
  const { shelves, loading } = useBacklogShelves(games)
  const [rouletteOpen, setRouletteOpen] = useState(false)
  const [nudgeDismissed, setNudgeDismissed] = useState(
    () => sessionStorage.getItem('bkg:nudge:v1') === '1',
  )
  const count = games.length

  const staleCount = useMemo(() => {
    const now = Date.now()
    return games.filter(
      (g) => g.addedAt && now - new Date(g.addedAt).getTime() > STALE_MS,
    ).length
  }, [games])

  // Sync read — cheap localStorage access, re-derived each render when
  // games array changes (count change means a game was added or removed).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clearedThisYear = useMemo(() => getBacklogClearsThisYear(), [count])

  const showNudge = staleCount > 0 && !nudgeDismissed
  const showMeter = staleCount > 0 || clearedThisYear > 0
  const meterTotal = clearedThisYear + staleCount
  const meterPct = meterTotal > 0 ? Math.round((clearedThisYear / meterTotal) * 100) : 0

  const handleDismissNudge = () => {
    setNudgeDismissed(true)
    sessionStorage.setItem('bkg:nudge:v1', '1')
  }

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

  const showShelves = !loading && shelves.length > 0

  return (
    <div className="shelf-box shelf-box--backlog">
      <div className="shelf-head">
        <h2 className="shelf-title">Your Backlog</h2>
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

      {/* Gentle stale nudge — shown when ≥1 game has sat 6+ months */}
      {showNudge && (
        <div className="shelf-stale-nudge" role="note" aria-label="Stale backlog notice">
          <Clock size={13} strokeWidth={2} className="shelf-stale-nudge-icon" aria-hidden="true" />
          <span className="shelf-stale-nudge-text">
            {staleCount === 1
              ? '1 game has been sitting here 6+ months'
              : `${staleCount} games have been sitting here 6+ months`}
          </span>
          <button
            type="button"
            className="shelf-stale-nudge-dismiss"
            onClick={handleDismissNudge}
            aria-label="Dismiss"
          >
            <X size={11} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Clear-it progress meter */}
      {showMeter && (
        <div className="shelf-clear-meter" aria-label="Backlog progress">
          <div className="shelf-clear-meter-bar" role="progressbar" aria-valuenow={meterPct} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="shelf-clear-meter-fill"
              style={{ width: `${meterPct}%` }}
            />
          </div>
          <p className="shelf-clear-meter-label">
            {clearedThisYear > 0 && staleCount === 0
              ? `All clear — ${clearedThisYear} cleared this year`
              : clearedThisYear > 0
              ? `${clearedThisYear} cleared this year · ${staleCount} still waiting`
              : `${staleCount} waiting 6+ months — pick one?`}
          </p>
        </div>
      )}

      {showShelves ? (
        <div className="shelf-moods" role="list" aria-label="Backlog by mood">
          {shelves.map((shelf, idx) => (
            <div
              key={shelf.id}
              className="shelf-mood-row"
              role="listitem"
              style={{ '--shelf-idx': idx }}
            >
              <div className="shelf-mood-label" aria-hidden="true">
                <span className="shelf-mood-emoji">{shelf.emoji}</span>
                <span className="shelf-mood-name">{shelf.label}</span>
              </div>
              <CoverRail games={shelf.games} onAddGame={null} />
            </div>
          ))}
        </div>
      ) : (
        <CoverRail games={games} onAddGame={onAddGame} />
      )}

      <BacklogRoulette
        isOpen={rouletteOpen}
        onClose={() => setRouletteOpen(false)}
        games={games}
      />
    </div>
  )
}

export default BacklogSection

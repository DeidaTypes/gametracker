import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import './SessionEndPick.css'

/**
 * SessionEndPick — concrete end-of-session recommendation.
 *
 * Replaces the generic "That's all for now" exhausted state when we have
 * enough signal to make an honest pick. The pick is derived by
 * swipeService.pickTonightsMatch() from everything the user saw this session
 * (with strong preference for cards they backlogged).
 *
 * Tapping the pick deep-links into `/game/:id` so the user can immediately
 * start reading reviews / hitting play.
 *
 * Props:
 *   game         — the chosen game (id, title, image, year, whyLine, genre…)
 *   sessionStats — { swipeCount: number, backlogCount: number }
 *   onKeepSwiping — optional callback to dismiss the pick and continue the deck
 *                   (only meaningful when the deck has cards remaining)
 */
export default function SessionEndPick({ game, sessionStats, onKeepSwiping }) {
  const navigate = useNavigate()
  const { reduced } = useMotionPreference()

  if (!game) return null

  const handleOpen = () => {
    navigate(`/game/${game.id}`)
  }

  const subline = buildSubline(game, sessionStats)

  return (
    <div
      className={`session-end-pick${reduced ? ' session-end-pick--reduced' : ''}`}
      role="region"
      aria-label="Tonight's match"
    >
      <p className="session-end-pick__eyebrow">Tonight's match</p>

      <button
        type="button"
        className="session-end-pick__card"
        onClick={handleOpen}
        aria-label={`Open ${game.title} details`}
      >
        <div className="session-end-pick__cover">
          {game.image ? (
            <img src={game.image} alt="" className="session-end-pick__img" draggable="false" />
          ) : (
            <div className="session-end-pick__cover-placeholder" aria-hidden="true">
              {game.title?.charAt(0) ?? '?'}
            </div>
          )}
        </div>
        <div className="session-end-pick__meta">
          <p className="session-end-pick__title">{game.title}</p>
          {game.year ? <p className="session-end-pick__year">{game.year}</p> : null}
          {subline ? <p className="session-end-pick__why">{subline}</p> : null}
        </div>
        <span className="session-end-pick__chevron" aria-hidden="true">→</span>
      </button>

      <div className="session-end-pick__actions">
        <button
          type="button"
          className="session-end-pick__primary"
          onClick={handleOpen}
        >
          View {game.title?.split(':')[0] || 'game'}
        </button>
        {typeof onKeepSwiping === 'function' && (
          <button
            type="button"
            className="session-end-pick__secondary"
            onClick={onKeepSwiping}
          >
            Keep swiping
          </button>
        )}
      </div>
    </div>
  )
}

function buildSubline(game, stats) {
  if (game.whyLine) return game.whyLine
  if (stats?.backlogCount > 0) {
    return `Top of your ${stats.backlogCount === 1 ? 'pick' : `${stats.backlogCount} picks`} this session`
  }
  if (game.genre && game.genre !== 'Unknown') {
    const first = game.genre.split(',')[0].trim()
    return `An acclaimed ${first.toLowerCase()} to start tonight`
  }
  return null
}

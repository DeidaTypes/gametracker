import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNowStrict } from 'date-fns'
import { LuClock, LuCheck } from 'react-icons/lu'
import { Gamepad2, ChevronRight } from 'lucide-react'
import { ReviewCardShell } from '../reviews/ReviewCardShell'
import { getDominantColor } from '../../services/colorExtract'
import { getTracker } from '../../services/hoursService'
import { setGameStatus } from '../../services/libraryService'
import { showToast } from '../Toast'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import './HomeNowPlayingHero.css'

function formatHoursLabel(hours) {
  if (hours == null || hours <= 0) return null
  const rounded = Math.round(hours * 10) / 10
  const value = rounded % 1 === 0 ? rounded : rounded.toFixed(1)
  return `${value} ${rounded === 1 ? 'hour' : 'hours'} logged`
}

function humanTimeAgo(dateStr) {
  if (!dateStr) return null
  try {
    return formatDistanceToNowStrict(new Date(dateStr), { addSuffix: true })
  } catch {
    return null
  }
}

// ── Backlog nudge — fallback #2, shown when there's no active Playing game ──

function BacklogNudge({ game, onOpen }) {
  return (
    <button type="button" className="nph-backlog" onClick={onOpen}>
      {game?.image ? (
        <img
          src={game.image}
          alt=""
          className="nph-backlog__cover"
          loading="lazy"
          onError={(e) => { e.target.src = COVER_FALLBACK }}
        />
      ) : (
        <div className="nph-backlog__icon" aria-hidden="true">
          <Gamepad2 size={20} />
        </div>
      )}
      <div className="nph-backlog__meta">
        <span className="nph-backlog__title">Start something from your backlog</span>
        {game?.title && <span className="nph-backlog__sub">{game.title} is waiting</span>}
      </div>
      <ChevronRight size={16} aria-hidden="true" className="nph-backlog__chevron" />
    </button>
  )
}

/**
 * HomeNowPlayingHero — the "Now Playing" hero surfaced directly under
 * Home's compact header.
 *
 * Fallback rotation (never an empty shell):
 *   1. `activeGame` (the user's current Playing game) — full hero: cover,
 *      title, real logged hours (fetched from game_trackers via
 *      getTracker — the single source of truth per sessionService.js),
 *      last-played relative time, and two actions.
 *   2. `backlogGame` — a slim nudge row when there's no active game but
 *      the backlog isn't empty.
 *   3. Neither — renders null. The parent is responsible for not
 *      rendering this component's section wrapper at all in that case,
 *      but this also self-guards.
 *
 * No progress bar: `progress_override` (game_trackers) is plumbed
 * end-to-end (see hoursService.setProgressOverride) but no UI in this
 * app ever calls it, so it is always null in practice — rendering a bar
 * here would mean inventing a number. Hours-only display is honest.
 *
 * Props:
 *   activeGame    { id, title, image, lastPlayedAt } | null
 *   backlogGame   { id, title, image } | null
 *   onLogSession  (game) => void   — opens the shared Log a Session modal (A2)
 */
function HomeNowPlayingHero({ activeGame, backlogGame, onLogSession }) {
  const navigate = useNavigate()
  const [color, setColor] = useState(null)
  const [hoursPlayed, setHoursPlayed] = useState(null) // null = still loading
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!activeGame?.image) {
      setColor(null)
      return undefined
    }
    getDominantColor(activeGame.image).then((c) => {
      if (!cancelled) setColor(c)
    })
    return () => { cancelled = true }
  }, [activeGame?.image])

  useEffect(() => {
    let cancelled = false
    if (!activeGame?.id) {
      setHoursPlayed(null)
      return undefined
    }
    setHoursPlayed(null)
    getTracker(activeGame.id).then((tracker) => {
      if (cancelled) return
      setHoursPlayed(tracker?.hours_played != null ? Number(tracker.hours_played) : 0)
    })
    return () => { cancelled = true }
  }, [activeGame?.id])

  if (!activeGame) {
    if (!backlogGame) return null
    return (
      <BacklogNudge
        game={backlogGame}
        onOpen={() =>
          navigate(`/game/${backlogGame.id}`, backlogGame.image ? { state: { coverImage: backlogGame.image } } : undefined)
        }
      />
    )
  }

  const dominantStyle = color ? { '--dominant-rgb': `${color.r} ${color.g} ${color.b}` } : undefined
  const hoursLabel = formatHoursLabel(hoursPlayed)
  const timeAgo = humanTimeAgo(activeGame.lastPlayedAt)

  const goToGame = () => {
    navigate(`/game/${activeGame.id}`, activeGame.image ? { state: { coverImage: activeGame.image } } : undefined)
  }

  const handleLogSession = (e) => {
    e.stopPropagation()
    onLogSession(activeGame)
  }

  const handleFinish = (e) => {
    e.stopPropagation()
    if (finishing) return
    setFinishing(true)
    const ok = setGameStatus(activeGame.id, 'played', activeGame)
    if (ok) {
      showToast(`Marked "${activeGame.title}" as Played`, 'success')
    } else {
      showToast('Could not update — try again', 'error')
    }
    setFinishing(false)
  }

  return (
    <ReviewCardShell as="section" className="nph" aria-label={`Now playing: ${activeGame.title}`}>
      <button
        type="button"
        className="nph__cover-header"
        style={dominantStyle}
        onClick={goToGame}
        aria-label={`View ${activeGame.title}`}
      >
        <img
          src={activeGame.image || COVER_FALLBACK}
          alt=""
          className="nph__cover-thumb"
          loading="eager"
          onError={(e) => { e.target.src = COVER_FALLBACK }}
        />
        <div className="nph__meta">
          <span className="nph__eyebrow">Now Playing</span>
          <h2 className="nph__title">{activeGame.title}</h2>
          <div className="nph__stats">
            {hoursLabel ? (
              <span className="nph__stats-text">{hoursLabel}</span>
            ) : hoursPlayed === null ? (
              <span className="skeleton nph__stats-skeleton" aria-hidden="true" />
            ) : (
              <span className="nph__stats-text">Just started</span>
            )}
            {timeAgo && (
              <>
                <span className="nph__dot" aria-hidden="true">·</span>
                <span className="nph__stats-text">{timeAgo}</span>
              </>
            )}
          </div>
        </div>
      </button>

      <div className="nph__actions">
        <button type="button" className="nph__btn nph__btn--primary" onClick={handleLogSession}>
          <LuClock size={16} aria-hidden="true" />
          Log a session
        </button>
        <button
          type="button"
          className="nph__btn nph__btn--secondary"
          onClick={handleFinish}
          disabled={finishing}
        >
          <LuCheck size={16} aria-hidden="true" />
          Finish
        </button>
      </div>
    </ReviewCardShell>
  )
}

export default HomeNowPlayingHero

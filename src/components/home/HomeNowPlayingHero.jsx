import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNowStrict } from 'date-fns'
import { LuClock, LuCheck } from 'react-icons/lu'
import { Gamepad2, ChevronRight } from 'lucide-react'
import { ReviewCardShell } from '../reviews/ReviewCardShell'
import { getDominantColor } from '../../services/colorExtract'
import { getTracker } from '../../services/hoursService'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { getGameNavStub } from '../../utils/gameNavStub'
import './HomeNowPlayingHero.css'

function humanTimeAgo(dateStr) {
  if (!dateStr) return null
  try {
    return formatDistanceToNowStrict(new Date(dateStr), { addSuffix: true })
  } catch {
    return null
  }
}

function statusLine(hoursPlayed, lastPlayedAt) {
  if (hoursPlayed == null) return null
  if (hoursPlayed <= 0) return 'Just started'
  return humanTimeAgo(lastPlayedAt) || 'Just started'
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
 *   1. `activeGame` — cover, title, "Just started" or relative last-
 *      played time, and Log a session / Finish.
 *   2. `backlogGame` — slim nudge when there's no active game but the
 *      backlog isn't empty.
 *   3. Neither — renders null. The parent hides the section wrapper.
 *
 * Finish calls `onFinish` (Home's handleFinishedIt → setGameStatus
 * 'played'). This component does not write status itself.
 *
 * Props:
 *   activeGame    { id, title, image, lastPlayedAt } | null
 *   backlogGame   { id, title, image } | null
 *   onLogSession  (game) => void — opens the one LogSheet modal
 *   onFinish      (game) => void — Home's handleFinishedIt
 */
function HomeNowPlayingHero({ activeGame, backlogGame, onLogSession, onFinish }) {
  const navigate = useNavigate()
  const [color, setColor] = useState(null)
  const [hoursPlayed, setHoursPlayed] = useState(null)
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

    const fetchHours = () => {
      getTracker(activeGame.id).then((tracker) => {
        if (cancelled) return
        setHoursPlayed(tracker?.hours_played != null ? Number(tracker.hours_played) : 0)
      })
    }

    setHoursPlayed(null)
    fetchHours()
    window.addEventListener('libraryUpdated', fetchHours)
    return () => {
      cancelled = true
      window.removeEventListener('libraryUpdated', fetchHours)
    }
  }, [activeGame?.id])

  if (!activeGame) {
    if (!backlogGame) return null
    return (
      <BacklogNudge
        game={backlogGame}
        onOpen={() => navigate(`/game/${backlogGame.id}`, { state: getGameNavStub(backlogGame) })}
      />
    )
  }

  const dominantStyle = color ? { '--dominant-rgb': `${color.r} ${color.g} ${color.b}` } : undefined
  const line = statusLine(hoursPlayed, activeGame.lastPlayedAt)

  const goToGame = () => {
    navigate(`/game/${activeGame.id}`, { state: getGameNavStub(activeGame) })
  }

  const handleLogSession = (e) => {
    e.stopPropagation()
    onLogSession(activeGame)
  }

  const handleFinish = (e) => {
    e.stopPropagation()
    if (finishing) return
    setFinishing(true)
    onFinish?.(activeGame)
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
            {line ? (
              <span className="nph__stats-text">{line}</span>
            ) : (
              <span className="skeleton nph__stats-skeleton" aria-hidden="true" />
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

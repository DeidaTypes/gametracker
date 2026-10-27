import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNowStrict } from 'date-fns'
import { LuClock, LuCheck } from 'react-icons/lu'
import { Gamepad2, ChevronRight } from 'lucide-react'
import { getDominantColor } from '../../services/colorExtract'
import { getManualSessionsForGame } from '../../services/sessionService'
import { getCachedTimeToBeatSync } from '../../services/timeToBeatService'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import { getGameNavStub } from '../../utils/gameNavStub'
import { openQaAsk, qaGamePreset } from '../../pages/qa/qaComposer'
import './HomeNowPlayingHero.css'

// "Stuck? Ask" is the quiet third action: the ghost button at caption size, so
// the row keeps its height and the primary action keeps its width.
const STUCK_BTN_STYLE = { fontSize: 'var(--font-size-caption)' }

function humanTimeAgo(dateStr) {
  if (!dateStr) return null
  try {
    return formatDistanceToNowStrict(new Date(dateStr), { addSuffix: true })
  } catch {
    return null
  }
}

function buildHeroSubline(sessions, mainStoryHours) {
  if (sessions == null) return null

  const segments = []
  const sessionCount = sessions.length
  const totalHours = Math.round(
    sessions.reduce((sum, s) => sum + (Number(s.hours) || 0), 0)
  )

  if (sessionCount === 0) {
    segments.push('Just started')
    segments.push('0h logged')
  } else {
    const lastDate = sessions[0]?.playedOn || sessions[0]?.createdAt || sessions[0]?.startedAt
    const relative = humanTimeAgo(lastDate)
    if (relative) segments.push(`Last played ${relative}`)
    if (totalHours > 0) segments.push(`${totalHours}h logged`)
  }

  if (mainStoryHours != null) {
    segments.push(`Main story ~${mainStoryHours}h`)
  }

  return segments.length ? segments.join(' · ') : null
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
  const [sessions, setSessions] = useState(null)
  const [mainStoryHours, setMainStoryHours] = useState(null)
  const [finishing, setFinishing] = useState(false)
  // No usable IGDB id (or title) means Ask could not name the game: no action.
  const canAsk = !!activeGame && qaGamePreset(activeGame) != null

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
      setSessions(null)
      setMainStoryHours(null)
      return undefined
    }

    const cachedTtb = getCachedTimeToBeatSync(activeGame.id)
    if (cachedTtb === undefined) {
      setMainStoryHours(null)
    } else if (cachedTtb?.normallySeconds != null) {
      setMainStoryHours(Math.round(cachedTtb.normallySeconds / 3600))
    } else {
      setMainStoryHours(null)
    }

    const fetchSessions = () => {
      getManualSessionsForGame(activeGame.id).then((rows) => {
        if (cancelled) return
        setSessions(rows)
      })
    }

    setSessions(null)
    fetchSessions()
    window.addEventListener('libraryUpdated', fetchSessions)
    window.addEventListener('activityUpdated', fetchSessions)
    return () => {
      cancelled = true
      window.removeEventListener('libraryUpdated', fetchSessions)
      window.removeEventListener('activityUpdated', fetchSessions)
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
  const line = buildHeroSubline(sessions, mainStoryHours)

  const goToGame = () => {
    navigate(`/game/${activeGame.id}`, { state: getGameNavStub(activeGame) })
  }

  const handleLogSession = (e) => {
    e.stopPropagation()
    onLogSession(activeGame)
  }

  // Runs the whole open inside the tap: openQaAsk commits the popup and
  // focuses the title in the same gesture, so the keyboard rises with it.
  const handleStuck = (e) => {
    e.stopPropagation()
    openQaAsk({ game: activeGame })
  }

  const handleFinish = (e) => {
    e.stopPropagation()
    if (finishing) return
    setFinishing(true)
    onFinish?.(activeGame)
    setFinishing(false)
  }

  return (
    <section className="nph" aria-label={`Now playing: ${activeGame.title}`}>
      <button
        type="button"
        className="nph__upper"
        style={dominantStyle}
        onClick={goToGame}
        aria-label={`View ${activeGame.title}`}
      >
        <img
          src={activeGame.image || COVER_FALLBACK}
          alt=""
          className="nph__cover"
          loading="eager"
          onError={(e) => { e.target.src = COVER_FALLBACK }}
        />
        <div className="nph__meta">
          <span className="nph__eyebrow">Now Playing</span>
          <h2 className="nph__title">{activeGame.title}</h2>
          <div className="nph__status">
            {line ? (
              <span className="nph__status-text">{line}</span>
            ) : (
              <span className="skeleton nph__status-skeleton" aria-hidden="true" />
            )}
          </div>
        </div>
      </button>

      <div className="nph__lower">
        <button type="button" className="nph__btn nph__btn--primary" onClick={handleLogSession}>
          <LuClock size={16} aria-hidden="true" />
          Log a session
        </button>
        <button
          type="button"
          className="nph__btn nph__btn--ghost"
          onClick={handleFinish}
          disabled={finishing}
        >
          <LuCheck size={16} aria-hidden="true" />
          Finish
        </button>
        {canAsk && (
          <button
            type="button"
            className="nph__btn nph__btn--ghost"
            style={STUCK_BTN_STYLE}
            onClick={handleStuck}
          >
            Stuck? Ask
          </button>
        )}
      </div>
    </section>
  )
}

export default HomeNowPlayingHero

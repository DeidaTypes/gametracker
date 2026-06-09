// SessionPill — a persistent floating pill shown at the bottom of the screen
// whenever a play session is active. Tapping the game title navigates to the
// game's detail page; the Stop button opens the confirmation sheet.
//
// Positioned above the BottomNav with a z-index that keeps it below modals.

import React, { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../contexts/SessionContext'
import './SessionPill.css'

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function SessionPill() {
  const { session, elapsed, isStopping, stopGameSession } = useSession()
  const navigate = useNavigate()

  const handleStop = useCallback(
    (e) => {
      e.stopPropagation()
      stopGameSession()
    },
    [stopGameSession]
  )

  const handleNavigate = useCallback(() => {
    if (session?.igdb_game_id) {
      navigate(`/game/${session.igdb_game_id}`, {
        state: { coverImage: session.game_image },
      })
    }
  }, [navigate, session])

  if (!session) return null

  return (
    <div
      className="session-pill"
      role="status"
      aria-label={`Playing ${session.game_title ?? 'a game'} — ${formatElapsed(elapsed)}`}
    >
      <button
        className="session-pill__info"
        onClick={handleNavigate}
        type="button"
        aria-label={`Go to ${session.game_title ?? 'game'}`}
      >
        {/* Live dot */}
        <span className="session-pill__dot" aria-hidden="true" />

        <span className="session-pill__title">
          {session.game_title ?? 'Playing'}
        </span>

        <span className="session-pill__timer" aria-live="off">
          {formatElapsed(elapsed)}
        </span>
      </button>

      <button
        className="session-pill__stop"
        onClick={handleStop}
        disabled={isStopping}
        type="button"
        aria-label="Stop session"
      >
        {isStopping ? '…' : 'Stop'}
      </button>
    </div>
  )
}

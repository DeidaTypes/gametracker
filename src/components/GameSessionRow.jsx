import React from 'react'
import { Clock, ChevronRight, Plus } from 'lucide-react'
import { formatActivityDate } from '../utils/formatActivityDate'
import './GameSessionRow.css'

// Interprets a 'YYYY-MM-DD' played_on string as local noon so the
// relative/absolute date split in formatActivityDate reads naturally
// regardless of the reader's timezone offset from UTC midnight.
function playedOnToDate(playedOn) {
  if (!playedOn) return null
  const [y, mo, d] = playedOn.split('-').map(Number)
  return new Date(y, mo - 1, d, 12, 0, 0)
}

function formatHoursLabel(hours) {
  const n = Number(hours) || 0
  const rounded = Math.round(n * 100) / 100
  const label = rounded % 1 === 0 ? `${rounded}` : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${label}h`
}

/**
 * GameSessionRow — compact "latest session" row on Game Detail, rendered
 * directly under the status tiles. Always reflects `latestSession`
 * (sessions[0] from the caller, which is sorted newest-first) so it
 * updates automatically the moment a new session is logged.
 *
 * Zero-sessions state renders a plain text affordance instead of an empty
 * bordered box — no card, no placeholder numbers.
 *
 * Tapping the row (or the empty-state affordance) is the only entry point
 * into the full per-game session-history sub-screen / log form; this
 * component owns no data fetching of its own.
 *
 * Props:
 *   latestSession   { minutes: number, playedOn: string, hours: number } | null
 *   sessionCount    number
 *   onOpenHistory   () => void   opens GameSessionHistorySheet
 *   onLogSession    () => void   opens LogSessionModal (add mode) — used
 *                                only for the zero-sessions affordance
 */
function GameSessionRow({ latestSession, sessionCount = 0, onOpenHistory, onLogSession }) {
  if (sessionCount === 0 || !latestSession) {
    return (
      <div className="gsr-wrap">
        <button type="button" className="gsr-empty-cta" onClick={onLogSession}>
          <Plus size={15} aria-hidden="true" />
          <span>Log a session</span>
        </button>
      </div>
    )
  }

  const dateLabel = formatActivityDate(playedOnToDate(latestSession.playedOn))

  return (
    <div className="gsr-wrap">
      <button
        type="button"
        className="gsr-row"
        onClick={onOpenHistory}
        aria-label={`View session history — ${formatHoursLabel(latestSession.hours)} played, ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'} logged`}
      >
        <span className="gsr-icon" aria-hidden="true">
          <Clock size={18} />
        </span>
        <span className="gsr-content">
          <span className="gsr-primary">{formatHoursLabel(latestSession.hours)} played</span>
          <span className="gsr-secondary">
            {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}
            {dateLabel ? ` · logged ${dateLabel}` : ''}
          </span>
        </span>
        <span className="gsr-view">
          View sessions
          <ChevronRight size={14} aria-hidden="true" />
        </span>
      </button>
    </div>
  )
}

export default GameSessionRow

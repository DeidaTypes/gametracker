import React from 'react'
import { Clock, ChevronRight } from 'lucide-react'
import { formatActivityDate } from '../utils/formatActivityDate'
import { getTotalHoursForGame } from '../services/hoursService'
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
 * GameSessionRow — compact session-total row on Game Detail, rendered
 * directly under the status tiles. Hours come from getTotalHoursForGame
 * (the same function the Session History sheet uses) so the number is
 * the SUM of this game's sessions, not the latest row.
 *
 * Hidden entirely when there are no sessions — logging stays reachable
 * from the FAB, the Now Playing hero, the status sheet's Log play, and
 * this card's "View sessions" → history sheet once a session exists.
 *
 * Props:
 *   sessions        Array<{ hours: number, playedOn: string }>  newest first
 *   onOpenHistory   () => void   navigates to /game/:id/sessions
 */
function GameSessionRow({ sessions = [], onOpenHistory }) {
  const sessionCount = sessions.length
  const latestSession = sessions[0] || null
  const totalHours = getTotalHoursForGame(sessions)

  if (sessionCount === 0 || !latestSession) return null

  const dateLabel = formatActivityDate(playedOnToDate(latestSession.playedOn))

  return (
    <div className="gsr-wrap">
      <button
        type="button"
        className="gsr-row"
        onClick={onOpenHistory}
        aria-label={`View session history — ${formatHoursLabel(totalHours)} played, ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'} logged`}
      >
        <span className="gsr-icon" aria-hidden="true">
          <Clock size={18} />
        </span>
        <span className="gsr-content">
          <span className="gsr-primary">{formatHoursLabel(totalHours)} played</span>
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

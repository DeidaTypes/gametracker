import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { Gamepad2, ChevronRight } from 'lucide-react'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import { useNavDim } from '../../hooks/useNavDim'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import './WeekDetailSheet.css'

/**
 * WeekDetailSheet — bottom sheet opened by tapping the Home "This week"
 * card. Shows every real play_sessions row logged this week (game, hours,
 * timestamp, note) plus a day-by-day activity tracker for the week.
 *
 * The day tracker reuses the exact same local-date-key + "active if ≥1
 * logged" logic as the streak strip's day dots (see buildCalendarWeekCells
 * in statsService.js / useWeekData.js) — just rendered with visible weekday
 * labels since this is a detail view, not a glanceable strip.
 *
 * All data is passed down from useWeekData via HomeWeekRow — this
 * component does no fetching of its own, so the card and the sheet can
 * never disagree about what "this week" contains.
 *
 * Props:
 *   isOpen        {boolean}
 *   onClose       {() => void}
 *   sessions      {Array}   see getSessionsForWeek's return shape
 *   dayCells      {Array}   see buildCalendarWeekCells
 *   sessionCount  {number}
 *   totalHours    {number}
 *   loading       {boolean}
 *   weekStart     {Date}
 *   weekEnd       {Date}    exclusive upper bound
 */

function formatWeekRange(weekStart, weekEnd) {
  if (!weekStart || !weekEnd) return ''
  const lastDay = new Date(weekEnd)
  lastDay.setDate(lastDay.getDate() - 1)

  const sameMonth = weekStart.getMonth() === lastDay.getMonth()
  const startStr = weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const endStr = sameMonth
    ? lastDay.toLocaleDateString(undefined, { day: 'numeric' })
    : lastDay.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${startStr} – ${endStr}`
}

function formatSessionMeta(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  const weekday = date.toLocaleDateString(undefined, { weekday: 'short' })
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${weekday} · ${time}`
}

function formatSessionHours(hours) {
  const n = Number(hours) || 0
  const rounded = Math.round(n * 100) / 100
  const label = rounded % 1 === 0 ? `${rounded}` : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${label}h`
}

function formatTotalHours(hours) {
  if (!hours || hours <= 0) return '0h'
  const rounded = Math.round(hours * 10) / 10
  return rounded % 1 === 0 ? `${rounded}h` : `${rounded.toFixed(1)}h`
}

export default function WeekDetailSheet({
  isOpen,
  onClose,
  sessions = [],
  dayCells = [],
  sessionCount = 0,
  totalHours = 0,
  loading = false,
  weekStart,
  weekEnd,
}) {
  const navigate = useNavigate()
  const { reduced } = useMotionPreference()

  useNavDim(isOpen)

  useEffect(() => {
    if (!isOpen) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const springProps = reduced ? {} : { type: 'spring', stiffness: 380, damping: 34 }

  function handleSessionTap(session) {
    if (!session.igdbGameId) return
    onClose()
    navigate(`/game/${session.igdbGameId}`)
  }

  const isEmpty = !loading && sessionCount === 0

  const content = (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="wds-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.15 }}
            onClick={onClose}
            aria-hidden="true"
          />

          <motion.div
            className="wds-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="This week's sessions"
            initial={reduced ? {} : { y: '100%' }}
            animate={reduced ? {} : { y: 0 }}
            exit={reduced ? {} : { y: '100%' }}
            transition={springProps}
          >
            <div className="wds-handle" aria-hidden="true" />

            <div className="wds-header">
              <div className="wds-header-text">
                <h2 className="wds-title">This Week</h2>
                <p className="wds-subtitle">{formatWeekRange(weekStart, weekEnd)}</p>
              </div>
              <button type="button" className="wds-close-btn" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>

            {!loading && (
              <p className="wds-summary">
                {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'} · {formatTotalHours(totalHours)} logged
              </p>
            )}

            <div className="wds-tracker" role="group" aria-label="Days active this week">
              {dayCells.map((cell) => (
                <div
                  key={cell.key}
                  className={[
                    'wds-tracker-cell',
                    cell.isFuture ? 'wds-tracker-cell--future' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <span className="wds-tracker-day">{cell.dayLabel}</span>
                  <span
                    className={[
                      'wds-tracker-dot',
                      cell.active ? 'wds-tracker-dot--active' : '',
                      cell.isToday ? 'wds-tracker-dot--today' : '',
                    ].filter(Boolean).join(' ')}
                    aria-hidden="true"
                  />
                </div>
              ))}
            </div>

            <div className="wds-body">
              {loading && (
                <p className="wds-loading" aria-live="polite">Loading…</p>
              )}

              {isEmpty && (
                <div className="wds-empty">
                  <span className="wds-empty-icon" aria-hidden="true">
                    <Gamepad2 size={28} />
                  </span>
                  <p className="wds-empty-text">No sessions logged this week yet.</p>
                </div>
              )}

              {!loading && sessions.length > 0 && (
                <ul className="wds-list" role="list">
                  {sessions.map((session) => {
                    const hasGame = !!session.igdbGameId
                    return (
                      <li key={session.id} className="wds-item">
                        <button
                          type="button"
                          className={`wds-item-btn${hasGame ? '' : ' wds-item-btn--static'}`}
                          onClick={() => hasGame && handleSessionTap(session)}
                          disabled={!hasGame}
                        >
                          <img
                            className="wds-item-cover"
                            src={session.gameImage || COVER_FALLBACK}
                            alt=""
                            loading="lazy"
                            onError={(e) => { e.target.src = COVER_FALLBACK }}
                          />
                          <div className="wds-item-content">
                            <div className="wds-item-top">
                              <span className="wds-item-title">
                                {session.gameTitle || 'Untitled game'}
                              </span>
                              <span className="wds-item-hours">{formatSessionHours(session.hours)}</span>
                            </div>
                            <span className="wds-item-time">{formatSessionMeta(session.startedAt)}</span>
                            {session.note && (
                              <p className="wds-item-note">“{session.note}”</p>
                            )}
                          </div>
                          {hasGame && (
                            <ChevronRight size={14} className="wds-item-chevron" aria-hidden="true" />
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )

  return createPortal(content, document.body)
}

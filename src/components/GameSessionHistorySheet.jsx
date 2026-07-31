import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Clock, X, Pencil, Trash2, Plus } from 'lucide-react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useNavDim } from '../hooks/useNavDim'
import { formatActivityDate } from '../utils/formatActivityDate'
import CenteredModal from './CenteredModal'
import { DestructiveButton, SecondaryButton } from './forms'
import './GameSessionHistorySheet.css'

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
 * GameSessionHistorySheet — per-game session-history sub-screen (Direction
 * 2 layout). Opened by tapping the "latest session" row (GameSessionRow)
 * or its zero-state "Log a session" affordance on Game Detail.
 *
 * Shows a total-playtime hero for THIS game (`totalHours` — the same
 * game_trackers.hours_played value the Profile "Played" stat sums across
 * every game), the session count, then every play_sessions row logged for
 * this game with edit + delete. Delete always confirms first — no bare
 * one-tap trash.
 *
 * This component owns no data fetching or mutation of its own: `sessions`
 * / `totalHours` are passed down from GameDetail (the single owner of that
 * state, same as it already is for LogSessionModal) and every CRUD action
 * delegates back up via props, so there is exactly one source of truth and
 * the row underneath stays in sync the instant this sheet's list changes.
 *
 * Props:
 *   isOpen          boolean
 *   onClose         () => void
 *   gameTitle       string
 *   totalHours      number    game_trackers.hours_played for this game
 *   sessions        Array<{ id, playedOn, minutes, hours }>  newest first
 *   onAddSession    () => void          opens LogSessionModal (add mode)
 *   onEditSession   (session) => void   opens LogSessionModal (edit mode)
 *   onDeleteSession (sessionId, minutes) => Promise<void>
 */
function GameSessionHistorySheet({
  isOpen,
  onClose,
  gameTitle,
  totalHours = 0,
  sessions = [],
  onAddSession,
  onEditSession,
  onDeleteSession,
}) {
  const { reduced } = useMotionPreference()
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useNavDim(isOpen)

  // Reset any in-flight confirm if the sheet itself closes (e.g. backdrop
  // tap) so a stale confirm modal can't reappear on next open.
  useEffect(() => {
    if (!isOpen) setPendingDelete(null)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function onKey(e) { if (e.key === 'Escape' && !pendingDelete) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose, pendingDelete])

  const springProps = reduced ? {} : { type: 'spring', stiffness: 380, damping: 34 }

  async function handleConfirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await onDeleteSession(pendingDelete.id, pendingDelete.minutes)
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }

  const isEmpty = sessions.length === 0

  const content = (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="gshs-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.15 }}
            onClick={onClose}
            aria-hidden="true"
          />

          <motion.div
            className="gshs-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`${gameTitle || 'Game'} session history`}
            initial={reduced ? {} : { y: '100%' }}
            animate={reduced ? {} : { y: 0 }}
            exit={reduced ? {} : { y: '100%' }}
            transition={springProps}
          >
            <div className="gshs-handle" aria-hidden="true" />

            <div className="gshs-header">
              <h2 className="gshs-title">Session History</h2>
              <button type="button" className="gshs-close-btn" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className="gshs-hero">
              <span className="gshs-hero-icon" aria-hidden="true">
                <Clock size={20} />
              </span>
              <div className="gshs-hero-text">
                <span className="gshs-hero-hours">{formatHoursLabel(totalHours)}</span>
                <span className="gshs-hero-label">
                  total played · {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
                </span>
              </div>
            </div>

            <button type="button" className="gshs-add-btn" onClick={onAddSession}>
              <Plus size={15} aria-hidden="true" />
              <span>Log a session</span>
            </button>

            <div className="gshs-body">
              {isEmpty && (
                <div className="gshs-empty">
                  <span className="gshs-empty-icon" aria-hidden="true">
                    <Clock size={28} />
                  </span>
                  <p className="gshs-empty-text">No sessions logged for this game yet.</p>
                </div>
              )}

              {!isEmpty && (
                <ul className="gshs-list" role="list">
                  {sessions.map((session) => (
                    <li key={session.id} className="gshs-item">
                      <div className="gshs-item-content">
                        <span className="gshs-item-hours">{formatHoursLabel(session.hours)}</span>
                        <span className="gshs-item-sep" aria-hidden="true">·</span>
                        <span className="gshs-item-date">
                          {formatActivityDate(playedOnToDate(session.playedOn))}
                        </span>
                      </div>
                      <div className="gshs-item-actions">
                        <button
                          type="button"
                          className="gshs-item-btn"
                          onClick={() => onEditSession(session)}
                          aria-label={`Edit session from ${session.playedOn}`}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="gshs-item-btn gshs-item-btn--danger"
                          onClick={() => setPendingDelete(session)}
                          aria-label={`Delete session from ${session.playedOn}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )

  return (
    <>
      {createPortal(content, document.body)}

      {/* ── Delete confirmation — no bare one-tap trash ── */}
      <CenteredModal
        isOpen={!!pendingDelete}
        onClose={() => { if (!deleting) setPendingDelete(null) }}
        ariaLabel="Delete session"
        maxWidth={340}
      >
        <div className="gshs-confirm">
          <h3 className="gshs-confirm-title">Delete this session?</h3>
          <p className="gshs-confirm-body">
            {pendingDelete
              ? `Removing this ${formatHoursLabel(pendingDelete.hours)} session will subtract it from your total playtime. This can\u2019t be undone.`
              : ''}
          </p>
          <div className="gshs-confirm-footer">
            <DestructiveButton onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete session'}
            </DestructiveButton>
            <SecondaryButton onClick={() => setPendingDelete(null)} disabled={deleting} autoFocus>
              Cancel
            </SecondaryButton>
          </div>
        </div>
      </CenteredModal>
    </>
  )
}

export default GameSessionHistorySheet

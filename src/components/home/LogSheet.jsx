import React, { useEffect, useRef, useState } from 'react'
import { LuClock, LuMinus, LuPlus, LuX } from 'react-icons/lu'
import CenteredModal from '../CenteredModal'
import { COVER_FALLBACK } from '../../utils/coverFallback'
import './LogSheet.css'

const MIN_HOURS = 0.25
const MAX_HOURS = 24
const STEP = 0.25
const MAX_NOTES = 500

function clampHours(val) {
  const n = Number(val)
  if (!Number.isFinite(n)) return MIN_HOURS
  return Math.max(MIN_HOURS, Math.min(MAX_HOURS, Math.round(n * 100) / 100))
}

/**
 * LogSheet — THE single log-a-session surface, app-wide.
 *
 * Centered modal (not a bottom sheet): hours stepper + optional notes.
 * Replaces HomeLogSessionModal and LogSessionModal's "add" mode — every
 * caller that logs a NEW session opens this (Home hero, HomeFAB radial,
 * Game Detail, session history, status sheet, tracker list).
 *
 * This component owns no network calls — same convention as before
 * (`onLogIt`) — so each caller's post-log needs stay with the caller.
 * Mood chips were removed from the UI; the write still sends `mood: null`
 * so the existing logSession payload shape is unchanged.
 *
 * Props:
 *   isOpen    boolean
 *   onClose   () => void
 *   game      { id, title, image } — required; caller resolves it first
 *   onLogIt   ({ game, hours, notes, mood }) => void
 */
function LogSheet({ isOpen, onClose, game, onLogIt }) {
  const [hours, setHours] = useState(1)
  const [notes, setNotes] = useState('')
  const hoursInputRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      setHours(1)
      setNotes('')
    }
  }, [isOpen])

  const canSave = !!game && clampHours(hours) > 0

  const step = (delta) => {
    setHours((prev) => clampHours((Number(prev) || 0) + delta))
  }

  const handleHoursChange = (e) => {
    const raw = e.target.value
    if (raw === '') {
      setHours('')
      return
    }
    setHours(raw)
  }

  const handleHoursBlur = () => {
    setHours((prev) => clampHours(prev))
  }

  const handleSubmit = () => {
    if (!canSave) return
    const targetGame = game
    const payload = {
      game: targetGame,
      hours: clampHours(hours),
      notes: notes.trim() || null,
      mood: null,
    }
    onClose()
    onLogIt?.(payload)
  }

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Log a session"
      maxWidth={360}
      className="ls-modal"
    >
      <div className="ls-header">
        <div className="ls-header__icon" aria-hidden="true">
          <LuClock size={16} />
        </div>
        <h2 className="ls-title">Log a Session</h2>
        <button type="button" className="ls-close" onClick={onClose} aria-label="Close">
          <LuX size={18} />
        </button>
      </div>

      {game && (
        <div className="ls-game-row">
          <img
            src={game.image || COVER_FALLBACK}
            alt=""
            className="ls-game-cover"
            onError={(e) => { e.target.src = COVER_FALLBACK }}
          />
          <span className="ls-game-title">{game.title}</span>
        </div>
      )}

      <div className="ls-body">
        <label className="ls-field-label" htmlFor="ls-hours-input">Hours played</label>
        <div className="ls-stepper">
          <button
            type="button"
            className="ls-stepper-btn"
            onClick={() => step(-STEP)}
            aria-label="Decrease hours"
          >
            <LuMinus size={16} />
          </button>
          <input
            ref={hoursInputRef}
            id="ls-hours-input"
            className="ls-hours-input"
            type="number"
            inputMode="decimal"
            min={MIN_HOURS}
            max={MAX_HOURS}
            step={STEP}
            value={hours}
            onChange={handleHoursChange}
            onBlur={handleHoursBlur}
            onFocus={(e) => e.target.select()}
            aria-label="Hours played"
          />
          <button
            type="button"
            className="ls-stepper-btn"
            onClick={() => step(STEP)}
            aria-label="Increase hours"
          >
            <LuPlus size={16} />
          </button>
        </div>

        <label className="ls-field-label" htmlFor="ls-notes-input">Notes (optional)</label>
        <textarea
          id="ls-notes-input"
          className="ls-textarea"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add a quick note about this session..."
          maxLength={MAX_NOTES}
          aria-label="Notes (optional)"
        />
      </div>

      <div className="ls-footer">
        <button type="button" className="ls-btn ls-btn--cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="ls-btn ls-btn--save"
          onClick={handleSubmit}
          disabled={!canSave}
        >
          Log Session
        </button>
      </div>
    </CenteredModal>
  )
}

export default LogSheet

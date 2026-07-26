import React, { useState, useEffect, useRef } from 'react'
import { LuClock, LuMinus, LuPlus, LuX } from 'react-icons/lu'
import CenteredModal from '../CenteredModal'
import { logSession } from '../../services/sessionService'
import { showToast } from '../Toast'
import './HomeLogSessionModal.css'

const MIN_HOURS = 0.25
const MAX_HOURS = 24
const STEP = 0.25
const MAX_NOTES = 500

function clampHours(val) {
  const n = Number(val)
  if (!Number.isFinite(n)) return MIN_HOURS
  return Math.max(MIN_HOURS, Math.min(MAX_HOURS, Math.round(n * 100) / 100))
}

function formatHours(h) {
  const rounded = Math.round(h * 100) / 100
  const label = rounded % 1 === 0 ? `${rounded}` : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${label} ${rounded === 1 ? 'hour' : 'hours'}`
}

/**
 * submitLoggedSession — fires the actual write, independent of the modal's
 * lifecycle. Called once right away, and again from the failure toast's
 * "Retry" action (no need to reopen the modal / re-focus the keyboard —
 * that would be the exact jank this modal is designed to avoid).
 */
async function submitLoggedSession({ game, hours, notes }) {
  const result = await logSession({
    gameId: game.id,
    hours,
    notes: notes || null,
    gameTitle: game.title,
    gameImage: game.image,
  })

  if (result) {
    showToast(`Logged ${formatHours(hours)} of ${game.title}`, 'success')
  } else {
    showToast('Could not log session — try again', 'error', 5000, {
      label: 'Retry',
      onClick: () => submitLoggedSession({ game, hours, notes }),
    })
  }
}

/**
 * HomeLogSessionModal — premium "Log a Session" popup for Home's FAB.
 *
 * Exactly two inputs: Hours played (numeric stepper) and Notes (optional,
 * multiline). No rating, no vibe tags, no status picker — those belong to
 * the separate review composer.
 *
 * Submit is optimistic: the modal closes immediately (the request runs in
 * the background via logSession), so the sheet never blocks on the network
 * and there's no reopen/refocus cycle to jank the keyboard. On failure a
 * toast surfaces the error with a "Retry" action that re-attempts the same
 * write. Home's streak strip / continue breadcrumb already listen for the
 * `activityUpdated` / `libraryUpdated` events logSession() dispatches, so
 * they reflect the new session on their own the moment it lands.
 *
 * Props:
 *   isOpen   boolean
 *   onClose  () => void
 *   game     { id, title, image } — required; caller resolves the game
 *            (smart default or game picker) before opening this modal.
 */
function HomeLogSessionModal({ isOpen, onClose, game }) {
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
    const finalHours = clampHours(hours)
    const finalNotes = notes.trim()
    const targetGame = game
    onClose()
    submitLoggedSession({ game: targetGame, hours: finalHours, notes: finalNotes })
  }

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Log a session"
      maxWidth={360}
      className="hlsm-modal"
    >
      <div className="hlsm-header">
        <div className="hlsm-header__icon" aria-hidden="true">
          <LuClock size={16} />
        </div>
        <h2 className="hlsm-title">Log a Session</h2>
        <button type="button" className="hlsm-close" onClick={onClose} aria-label="Close">
          <LuX size={18} />
        </button>
      </div>

      {game && (
        <div className="hlsm-game-row">
          {game.image ? (
            <img src={game.image} alt="" className="hlsm-game-cover" aria-hidden="true" />
          ) : (
            <div className="hlsm-game-cover hlsm-game-cover--placeholder" aria-hidden="true">
              {game.title?.[0] ?? '?'}
            </div>
          )}
          <span className="hlsm-game-title">{game.title}</span>
        </div>
      )}

      <div className="hlsm-body">
        <label className="hlsm-field-label" htmlFor="hlsm-hours-input">Hours played</label>
        <div className="hlsm-stepper">
          <button
            type="button"
            className="hlsm-stepper-btn"
            onClick={() => step(-STEP)}
            aria-label="Decrease hours"
          >
            <LuMinus size={16} />
          </button>
          <input
            ref={hoursInputRef}
            id="hlsm-hours-input"
            className="hlsm-hours-input"
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
            className="hlsm-stepper-btn"
            onClick={() => step(STEP)}
            aria-label="Increase hours"
          >
            <LuPlus size={16} />
          </button>
        </div>

        <label className="hlsm-field-label" htmlFor="hlsm-notes-input">Notes (optional)</label>
        <div className="hlsm-textarea-wrap">
          <textarea
            id="hlsm-notes-input"
            className="hlsm-textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add a quick note about this session…"
            maxLength={MAX_NOTES}
            aria-label="Notes (optional)"
          />
          {notes.length > MAX_NOTES * 0.85 && (
            <p className="hlsm-char-count" aria-live="polite">{notes.length}/{MAX_NOTES}</p>
          )}
        </div>
      </div>

      <div className="hlsm-footer">
        <button type="button" className="hlsm-btn hlsm-btn--cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="hlsm-btn hlsm-btn--save"
          onClick={handleSubmit}
          disabled={!canSave}
        >
          Log Session
        </button>
      </div>
    </CenteredModal>
  )
}

export default HomeLogSessionModal

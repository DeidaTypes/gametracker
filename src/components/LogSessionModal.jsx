import React, { useState, useEffect, useRef } from 'react'
import CenteredModal from './CenteredModal'
import './LogSessionModal.css'

function todayLocalDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * LogSessionModal — centered modal for logging a manual play session.
 * Doubles as the edit form for an existing session when `editingSession`
 * is passed: the duration/date fields pre-fill from it and the header
 * switches to "Edit Session" copy. `onSave` keeps the same payload shape
 * either way — the caller decides whether that means an insert or an
 * update based on whether it opened the modal with an `editingSession`.
 *
 * Props:
 *   isOpen           boolean
 *   onClose          () => void
 *   onSave           ({ totalMinutes: number, playedOn: string }) => void
 *   isSaving         boolean
 *   editingSession   { minutes: number, playedOn: string } | null
 */
function LogSessionModal({ isOpen, onClose, onSave, isSaving = false, editingSession = null }) {
  const [hours, setHours] = useState(0)
  const [minutes, setMinutes] = useState(0)
  const [playedOn, setPlayedOn] = useState(todayLocalDate())
  const hoursRef = useRef(null)
  const isEditing = !!editingSession

  useEffect(() => {
    if (isOpen) {
      if (editingSession) {
        setHours(Math.floor((editingSession.minutes || 0) / 60))
        setMinutes((editingSession.minutes || 0) % 60)
        setPlayedOn(editingSession.playedOn || todayLocalDate())
      } else {
        setHours(0)
        setMinutes(0)
        setPlayedOn(todayLocalDate())
      }
      const t = setTimeout(() => hoursRef.current?.focus(), 120)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const totalMinutes = Number(hours) * 60 + Number(minutes)
  const canSave = totalMinutes > 0 && !isSaving

  const handleSave = () => {
    if (!canSave) return
    onSave({ totalMinutes, playedOn })
  }

  const clampHours = (val) => Math.max(0, Math.min(99, parseInt(val) || 0))
  const clampMins = (val) => Math.max(0, Math.min(59, parseInt(val) || 0))

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Log a play session"
      maxWidth={340}
    >
      <div className="lsm-header">
        <h2 className="lsm-title">{isEditing ? 'Edit Session' : 'Log Play'}</h2>
        <button className="lsm-close" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="lsm-body">
        <label className="lsm-field-label">Duration</label>
        <div className="lsm-duration-row">
          <div className="lsm-unit-group">
            <input
              ref={hoursRef}
              className="lsm-num-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              value={hours}
              onChange={e => setHours(clampHours(e.target.value))}
              onFocus={e => e.target.select()}
              aria-label="Hours"
            />
            <span className="lsm-unit">hr</span>
          </div>
          <span className="lsm-sep">:</span>
          <div className="lsm-unit-group">
            <input
              className="lsm-num-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              value={minutes}
              onChange={e => setMinutes(clampMins(e.target.value))}
              onFocus={e => e.target.select()}
              aria-label="Minutes"
            />
            <span className="lsm-unit">min</span>
          </div>
        </div>

        <label className="lsm-field-label" htmlFor="lsm-date">Date</label>
        <input
          id="lsm-date"
          className="lsm-date-input"
          type="date"
          value={playedOn}
          max={todayLocalDate()}
          onChange={e => setPlayedOn(e.target.value)}
        />
      </div>

      <div className="lsm-footer">
        <button
          className="lsm-btn lsm-btn--cancel"
          onClick={onClose}
          disabled={isSaving}
        >
          Cancel
        </button>
        <button
          className="lsm-btn lsm-btn--save"
          onClick={handleSave}
          disabled={!canSave}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </CenteredModal>
  )
}

export default LogSessionModal

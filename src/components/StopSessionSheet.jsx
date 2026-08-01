// StopSessionSheet — brief confirmation shown after a play session ends.
//
// Displays the time added and the new hours total, then offers a single
// optional journal-line input. stopSession() (in sessionService) already
// created a journal_entries row for this session with a blank body — the
// note isn't known until the user types it here. Tapping Done fills that
// same entry in via updateJournalEntry(); it never inserts a second,
// parallel diary row (this sheet used to write to a separate `game_journal`
// table — that write path has been retired in favor of the one canonical
// Diary schema, journal_entries, shared with "Add to Journal").

import React, { useState, useEffect, useRef } from 'react'
import { updateJournalEntry } from '../services/journalService'
import { useSession } from '../contexts/SessionContext'
import KeyboardAwareView from './KeyboardAwareView'
import './StopSessionSheet.css'

function formatHours(h) {
  if (!h && h !== 0) return '—'
  const rounded = Math.round(h * 10) / 10
  return rounded % 1 === 0 ? `${rounded} hrs` : `${rounded.toFixed(1)} hrs`
}

function formatAdded(h) {
  if (!h || h <= 0) return null
  const totalMins = Math.round(h * 60)
  if (totalMins < 1) return null
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hours > 0 && mins > 0) return `+${hours}h ${mins}m`
  if (hours > 0) return `+${hours}h`
  return `+${mins}m`
}

export default function StopSessionSheet() {
  const { stopResult, dismissStopResult } = useSession()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const inputRef = useRef(null)

  // Reset state whenever a new result arrives
  useEffect(() => {
    if (stopResult) {
      setNote('')
      setSaved(false)
    }
  }, [stopResult])

  if (!stopResult) return null

  const addedLabel = formatAdded(stopResult.addedHours)
  const newLabel = formatHours(stopResult.newHours)

  async function handleDone() {
    if (note.trim() && !saved && stopResult.journalEntryId) {
      setSaving(true)
      try {
        await updateJournalEntry(stopResult.journalEntryId, { body: note.trim() })
        setSaved(true)
      } catch {
        // Non-fatal: dismiss anyway — the session's diary entry still
        // exists with a blank body, it just won't have this note.
      } finally {
        setSaving(false)
      }
    }
    dismissStopResult()
  }

  return (
    <div className="sss-backdrop" onClick={handleDone} aria-modal="true" role="dialog">
      <KeyboardAwareView mode="sheet" className="sss-anchor">
      <div
        className="sss-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="sss-handle" aria-hidden="true" />

        {/* Title */}
        <p className="sss-heading">Session saved</p>

        {/* Summary pill */}
        {addedLabel && (
          <div className="sss-summary">
            <span className="sss-added">{addedLabel}</span>
            <span className="sss-arrow" aria-hidden="true">→</span>
            <span className="sss-total">{newLabel}</span>
          </div>
        )}

        {stopResult.gameTitle && (
          <p className="sss-game-name">{stopResult.gameTitle}</p>
        )}

        {/* Journal note */}
        <div className="sss-note-area">
          <label className="sss-note-label" htmlFor="sss-note">
            Add a note <span className="sss-optional">(optional)</span>
          </label>
          <input
            id="sss-note"
            ref={inputRef}
            className="sss-note-input"
            type="text"
            placeholder="How did it go?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleDone() }}
            maxLength={280}
            autoComplete="off"
          />
        </div>

        {/* Done */}
        <button
          className="sss-done-btn"
          onClick={handleDone}
          disabled={saving}
          type="button"
        >
          {saving ? 'Saving…' : 'Done'}
        </button>
      </div>
      </KeyboardAwareView>
    </div>
  )
}

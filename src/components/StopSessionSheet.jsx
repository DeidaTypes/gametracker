// StopSessionSheet — brief confirmation shown after a play session ends.
//
// Displays the time added and the new hours total, then offers a single
// optional journal-line input. The note is written to game_journal by
// stopSession in sessionService; here we just collect it before the call.
//
// Because the session has ALREADY been stopped by the time this sheet mounts
// (stopGameSession in SessionContext does the DB write), the note is forwarded
// to the service via a re-write path: if the user types a note and taps Done,
// we write a journal entry directly here using Supabase.

import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSession } from '../contexts/SessionContext'
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
  const { user } = useAuth()
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
    if (note.trim() && !saved) {
      setSaving(true)
      try {
        await supabase.from('game_journal').insert({
          user_id: user.id,
          game_id: Number(stopResult.igdbGameId),
          body: note.trim(),
        })
        setSaved(true)
      } catch {
        // Non-fatal: dismiss anyway
      } finally {
        setSaving(false)
      }
    }
    dismissStopResult()
  }

  return (
    <div className="sss-backdrop" onClick={handleDone} aria-modal="true" role="dialog">
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
    </div>
  )
}

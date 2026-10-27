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
import { useNavDim } from '../hooks/useNavDim'
import { hapticSuccess } from '../utils/haptics'
import CenteredModal from './CenteredModal'
import { ugcErrorMessage } from '../services/moderationService'
import { getGamesFromList } from '../services/libraryService'
import { openQaAsk, qaGamePreset } from '../pages/qa/qaComposer'
import './forms/forms.css'
import './StopSessionSheet.css'

// A text button, not a second Done: tokens only, so it needs no stylesheet.
const STUCK_LINK_STYLE = {
  alignSelf: 'center',
  minHeight: 'var(--space-40)',
  padding: '0 var(--space-12)',
  border: 'none',
  background: 'none',
  color: 'var(--accent)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--font-size-caption)',
  fontWeight: 'var(--font-weight-semibold)',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
}

// The stop result carries the id and title but not the cover, so borrow it
// from the library entry the session was started from.
function libraryCover(igdbGameId) {
  const id = String(igdbGameId)
  for (const listId of ['currently-playing', 'played']) {
    const hit = getGamesFromList(listId).find((g) => String(g?.id) === id)
    if (hit?.image) return hit.image
  }
  return null
}

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
  const [noteError, setNoteError] = useState(null)
  const rejectedNoteRef = useRef(null)
  const inputRef = useRef(null)
  // The popup fades out after the result is dismissed; keep showing it.
  const lastResultRef = useRef(null)
  if (stopResult) lastResultRef.current = stopResult
  const result = stopResult || lastResultRef.current

  // Reset state whenever a new result arrives
  useEffect(() => {
    if (stopResult) {
      setNote('')
      setSaved(false)
      setNoteError(null)
      rejectedNoteRef.current = null
    }
  }, [stopResult])

  // Mounted globally in App.jsx, reachable from every screen — must drop
  // the bottom nav below it while open (see BottomNav.css).
  useNavDim(!!stopResult)

  if (!result) return null

  const addedLabel = formatAdded(result.addedHours)
  const newLabel = formatHours(result.newHours)

  const askGame = {
    igdbId: result.igdbGameId,
    title: result.gameTitle,
    image: libraryCover(result.igdbGameId),
  }
  // No usable IGDB id (or title) means Ask could not name the game: no link.
  const canAsk = qaGamePreset(askGame) != null

  // Open Ask inside the tap (it raises the keyboard in the same gesture), then
  // close this sheet the way Done does so a typed note is still saved.
  function handleStuck() {
    openQaAsk({ game: askGame })
    void handleDone()
  }

  async function handleDone() {
    if (!stopResult) return
    // Closing again without editing a rejected note leaves the entry blank.
    const changedSinceRejected = note.trim() !== rejectedNoteRef.current
    if (note.trim() && !saved && stopResult.journalEntryId && changedSinceRejected) {
      setSaving(true)
      setNoteError(null)
      try {
        await updateJournalEntry(stopResult.journalEntryId, { body: note.trim() })
        setSaved(true)
        hapticSuccess()
      } catch (err) {
        // Other failures are non-fatal: dismiss anyway — the session's diary
        // entry still exists with a blank body, it just won't have this note.
        const blocked = ugcErrorMessage(err)
        if (blocked) {
          rejectedNoteRef.current = note.trim()
          setNoteError(blocked)
          return
        }
      } finally {
        setSaving(false)
      }
    }
    dismissStopResult()
  }

  return (
    <CenteredModal
      isOpen={!!stopResult}
      onClose={() => { void handleDone() }}
      ariaLabel="Session saved"
      maxWidth={360}
    >
      <div className="sss-sheet">
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

        {result.gameTitle && (
          <p className="sss-game-name">{result.gameTitle}</p>
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
          {noteError && (
            <p className="form-field__error" role="alert">{noteError}</p>
          )}
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

        {canAsk && (
          <button type="button" style={STUCK_LINK_STYLE} onClick={handleStuck} disabled={saving}>
            Stuck somewhere? Ask players who&apos;ve been there
          </button>
        )}
      </div>
    </CenteredModal>
  )
}

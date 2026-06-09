import React, { useState, useEffect, useCallback, useRef } from 'react'
import CenteredModal from './CenteredModal'
import IOSSwitch from './IOSSwitch'
import { saveJournalEntry } from '../services/journalService'
import { showToast } from './Toast'
import '../pages/JournalNew.css'

const MAX_TITLE = 100
const MAX_BODY = 2000

/**
 * JournalEntryModal — inline pop-up for writing a new titled journal entry.
 *
 * Opens directly on the game detail page (no route change).
 * Fields: required title (1–100 chars), optional notes textarea, spoiler toggle.
 * Saves to journal_entries { title, body, is_spoiler, igdb_game_id, user_id }.
 * Dispatches 'journalEntryAdded' on success so GameJournalSection refreshes.
 *
 * Props:
 *   isOpen   boolean
 *   onClose  () => void
 *   game     { id, title, image, year, developers }
 */
function JournalEntryModal({ isOpen, onClose, game }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [isSpoiler, setIsSpoiler] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const titleRef = useRef(null)

  // Reset fields when reopened
  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setBody('')
      setIsSpoiler(false)
      setSubmitting(false)
      const t = setTimeout(() => titleRef.current?.focus(), 150)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  const canSave = !submitting && title.trim().length > 0 && title.length <= MAX_TITLE

  const handleClose = useCallback(() => {
    if ((title.trim().length > 0 || body.trim().length > 0) && !window.confirm('Discard this entry?')) return
    onClose()
  }, [title, body, onClose])

  const handleSave = useCallback(async () => {
    if (!canSave || !game) return
    setSubmitting(true)
    try {
      await saveJournalEntry({
        igdbGameId: game.id,
        title: title.trim(),
        body: body.trim(),
        isSpoiler,
        gameTitle: game.title,
        gameImage: game.image,
      })
      showToast('Entry saved!', 'success')
      onClose()
    } catch (err) {
      console.error('[JournalEntryModal] save failed:', err)
      showToast('Could not save your entry. Please try again.', 'error')
      setSubmitting(false)
    }
  }, [canSave, game, title, body, isSpoiler, onClose])

  const coverSrc = game?.image ?? null
  const developer = game?.developers?.[0] ?? null
  const gameMeta = [game?.year, developer].filter(Boolean).join(' · ')

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={handleClose}
      ariaLabel="New journal entry"
      maxWidth={360}
    >
      {/* Top row: Cancel | New journal entry | Save */}
      <div className="jnc-topbar">
        <button className="jnc-topbar-cancel" onClick={handleClose} type="button">
          Cancel
        </button>
        <span className="jnc-topbar-title">New journal entry</span>
        <button
          className={`jnc-topbar-save${!canSave ? ' jnc-topbar-save--disabled' : ''}`}
          onClick={handleSave}
          disabled={!canSave}
          type="button"
          aria-disabled={!canSave}
        >
          {submitting ? (
            <span className="jnc-save-spinner" aria-label="Saving…" />
          ) : (
            'Save'
          )}
        </button>
      </div>

      <div className="jnc-scroll cm-scroll">
        {/* Game header */}
        <div className="jnc-game-header">
          {coverSrc
            ? <img src={coverSrc} alt={game.title} className="jnc-game-cover" />
            : <div className="jnc-game-cover jnc-game-cover--placeholder" aria-hidden="true" />
          }
          <div className="jnc-game-info">
            <p className="jnc-game-title">{game?.title}</p>
            {gameMeta && <p className="jnc-game-meta">{gameMeta}</p>}
          </div>
        </div>

        {/* Title input — required */}
        <div className="jnc-title-wrap">
          <input
            ref={titleRef}
            className="jnc-title-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Name your entry"
            maxLength={MAX_TITLE}
            aria-label="Entry title (required)"
            autoComplete="off"
            autoCorrect="on"
          />
          {title.length > MAX_TITLE * 0.85 && (
            <p
              className={`jnc-char-count${title.length >= MAX_TITLE ? ' jnc-char-count--warn' : ''}`}
              aria-live="polite"
            >
              {title.length}/{MAX_TITLE}
            </p>
          )}
        </div>

        {/* Notes textarea — optional */}
        <div className="jnc-textarea-wrap">
          <textarea
            className="jnc-textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What happened? Jot a note about your playthrough…"
            maxLength={MAX_BODY}
            aria-label="Journal entry notes"
          />
          {body.length > MAX_BODY * 0.85 && (
            <p
              className={`jnc-char-count${body.length > MAX_BODY * 0.9 ? ' jnc-char-count--warn' : ''}`}
              aria-live="polite"
            >
              {body.length}/{MAX_BODY}
            </p>
          )}
        </div>

        {/* Contains spoilers toggle */}
        <div className="jnc-group" role="group" aria-label="Journal entry options">
          <div className="jnc-group-row">
            <span className="jnc-group-label">Contains spoilers</span>
            <IOSSwitch
              checked={isSpoiler}
              onChange={setIsSpoiler}
              label="Contains spoilers"
            />
          </div>
        </div>
      </div>
    </CenteredModal>
  )
}

export default JournalEntryModal

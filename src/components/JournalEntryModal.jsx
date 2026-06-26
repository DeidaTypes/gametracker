import React, { useState, useEffect, useCallback, useRef } from 'react'
import CenteredModal from './CenteredModal'
import IOSSwitch from './IOSSwitch'
import { saveJournalEntry, updateJournalEntry, MOOD_OPTIONS } from '../services/journalService'
import { showToast } from './Toast'
import '../pages/JournalNew.css'

const MAX_TITLE = 100
const MAX_BODY = 2000

/**
 * JournalEntryModal — pop-up for writing OR editing a titled journal entry.
 *
 * New entry: omit entryId. Calls saveJournalEntry, dispatches journalEntryAdded.
 * Edit entry: pass entryId + initialTitle/initialBody/initialIsSpoiler.
 *             Calls updateJournalEntry, dispatches journalEntryUpdated.
 *
 * Props:
 *   isOpen             boolean
 *   onClose            () => void
 *   game               { id, title, image, year, developers }
 *   entryId?           string  — UUID of entry to edit (omit for new)
 *   initialTitle?      string  — pre-fill for edit mode
 *   initialBody?       string  — pre-fill for edit mode
 *   initialIsSpoiler?  boolean — pre-fill for edit mode
 *   initialMood?       string  — pre-fill for edit mode
 *   initialHours?      number  — pre-fill for edit mode
 */
function JournalEntryModal({
  isOpen,
  onClose,
  game,
  entryId,
  initialTitle = '',
  initialBody = '',
  initialIsSpoiler = false,
  initialMood = null,
  initialHours = null,
}) {
  const isEditing = !!entryId
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [isSpoiler, setIsSpoiler] = useState(false)
  const [mood, setMood] = useState(null)
  const [hours, setHours] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const titleRef = useRef(null)

  // Reset / pre-fill whenever the modal opens.
  useEffect(() => {
    if (isOpen) {
      setTitle(isEditing ? initialTitle : '')
      setBody(isEditing ? initialBody : '')
      setIsSpoiler(isEditing ? initialIsSpoiler : false)
      setMood(isEditing ? (initialMood ?? null) : null)
      setHours(isEditing && initialHours != null ? String(initialHours) : '')
      setSubmitting(false)
      const t = setTimeout(() => titleRef.current?.focus(), 150)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const canSave = !submitting && title.trim().length > 0 && title.length <= MAX_TITLE

  const handleClose = useCallback(() => {
    const isDirty = isEditing
      ? title.trim() !== initialTitle.trim() || body.trim() !== initialBody.trim() || isSpoiler !== initialIsSpoiler || mood !== initialMood || String(hours) !== String(initialHours ?? '')
      : title.trim().length > 0 || body.trim().length > 0
    if (isDirty && !window.confirm(isEditing ? 'Discard changes?' : 'Discard this entry?')) return
    onClose()
  }, [isEditing, title, body, isSpoiler, mood, hours, initialTitle, initialBody, initialIsSpoiler, initialMood, initialHours, onClose])

  const handleSave = useCallback(async () => {
    if (!canSave) return
    setSubmitting(true)
    try {
      const parsedHours = hours !== '' && hours != null ? parseFloat(hours) : null
      if (isEditing) {
        await updateJournalEntry(entryId, {
          title: title.trim(),
          body: body.trim(),
          isSpoiler,
          mood,
          hoursPlayed: parsedHours,
        })
        showToast('Entry updated!', 'success')
      } else {
        if (!game) return
        await saveJournalEntry({
          igdbGameId: game.id,
          title: title.trim(),
          body: body.trim(),
          isSpoiler,
          gameTitle: game.title,
          gameImage: game.image,
          mood,
          hoursPlayed: parsedHours,
        })
        showToast('Entry saved!', 'success')
      }
      onClose()
    } catch (err) {
      console.error('[JournalEntryModal] save failed:', err)
      showToast('Could not save your entry. Please try again.', 'error')
      setSubmitting(false)
    }
  }, [canSave, isEditing, entryId, game, title, body, isSpoiler, mood, hours, onClose])

  const coverSrc = game?.image ?? null
  const developer = game?.developers?.[0] ?? null
  const gameMeta = [game?.year, developer].filter(Boolean).join(' · ')

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={handleClose}
      ariaLabel={isEditing ? 'Edit journal entry' : 'New journal entry'}
      maxWidth={360}
    >
      {/* Top row: Cancel | [New / Edit] journal entry | Save */}
      <div className="jnc-topbar">
        <button className="jnc-topbar-cancel" onClick={handleClose} type="button">
          Cancel
        </button>
        <span className="jnc-topbar-title">{isEditing ? 'Edit entry' : 'New journal entry'}</span>
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

        {/* Mood picker */}
        <div className="jnc-section-label">How are you feeling?</div>
        <div className="jnc-mood-grid" role="group" aria-label="Mood">
          {MOOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`jnc-mood-btn${mood === opt.value ? ' jnc-mood-btn--active' : ''}`}
              onClick={() => setMood(mood === opt.value ? null : opt.value)}
              aria-pressed={mood === opt.value}
              aria-label={opt.label}
            >
              <span className="jnc-mood-emoji" aria-hidden="true">{opt.emoji}</span>
              <span className="jnc-mood-label">{opt.label}</span>
            </button>
          ))}
        </div>

        {/* Hours played */}
        <div className="jnc-hours-row">
          <label className="jnc-hours-label" htmlFor="jnc-hours-input">
            Hours played
          </label>
          <div className="jnc-hours-input-wrap">
            <input
              id="jnc-hours-input"
              className="jnc-hours-input"
              type="number"
              min="0"
              max="999"
              step="0.5"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="0"
              aria-label="Hours played in this session"
            />
            <span className="jnc-hours-unit">hrs</span>
          </div>
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

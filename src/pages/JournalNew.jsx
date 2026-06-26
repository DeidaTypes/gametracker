import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import CenteredModal from '../components/CenteredModal'
import IOSSwitch from '../components/IOSSwitch'
import { getGameById } from '../services/igdb'
import { saveJournalEntry, MOOD_OPTIONS } from '../services/journalService'
import { useAuth } from '../contexts/AuthContext'
import { showToast } from '../components/Toast'
import './JournalNew.css'

const MAX_CHARS = 2000

function JournalNew() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()

  const gameIdParam = searchParams.get('gameId')

  const [game, setGame] = useState(location.state?.game ?? null)
  const [loadingGame, setLoadingGame] = useState(false)
  const [gameError, setGameError] = useState(null)

  const [text, setText] = useState('')
  const [containsSpoilers, setContainsSpoilers] = useState(false)
  const [mood, setMood] = useState(null)
  const [hours, setHours] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Drives the popup enter/exit animation. We keep the route mounted until
  // the close animation finishes, then run the queued navigation so the popup
  // closes smoothly without a jump.
  const [open, setOpen] = useState(true)
  const pendingNavRef = useRef(null)

  const closeWith = useCallback((action) => {
    pendingNavRef.current = action ?? null
    setOpen(false)
  }, [])

  const handleExited = useCallback(() => {
    const action = pendingNavRef.current
    pendingNavRef.current = null
    if (action) action()
    else navigate(-1)
  }, [navigate])

  // Load game by ID if we have a param but no pre-loaded state.
  useEffect(() => {
    if (!gameIdParam) {
      setGame(null)
      return
    }
    if (location.state?.game && String(location.state.game.id) === gameIdParam) {
      setGame(location.state.game)
      return
    }
    let cancelled = false
    setLoadingGame(true)
    setGameError(null)
    getGameById(gameIdParam)
      .then((g) => { if (!cancelled) setGame(g) })
      .catch((err) => {
        console.error('[JournalNew] failed to load game:', err)
        if (!cancelled) setGameError('Could not load game details.')
      })
      .finally(() => { if (!cancelled) setLoadingGame(false) })
    return () => { cancelled = true }
  }, [gameIdParam, location.state?.game])

  const canSave = !submitting && text.trim().length > 0 && text.length <= MAX_CHARS

  const handleCancel = useCallback(() => {
    if (text.trim().length > 0 && !window.confirm('Discard this entry?')) return
    closeWith(() => navigate(-1))
  }, [text, navigate, closeWith])

  const handleSave = useCallback(async () => {
    if (!canSave || !game) return
    setSubmitting(true)
    try {
      const deadline = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Request timed out. Please check your connection.')),
          12000
        )
      )
      await Promise.race([
        saveJournalEntry({
          igdbGameId: game.id,
          body: text.trim(),
          isSpoiler: !!containsSpoilers,
          gameTitle: game.title,
          gameImage: game.image,
          mood,
          hoursPlayed: hours !== '' ? parseFloat(hours) : null,
        }),
        deadline,
      ])
      showToast('Entry saved!', 'success')
      closeWith(() => navigate(-1))
    } catch (err) {
      console.error('[JournalNew] saveJournalEntry failed:', err)
      showToast('Could not save your entry. Please try again.', 'error')
      setSubmitting(false)
    }
  }, [canSave, game, text, containsSpoilers, navigate, closeWith])

  const coverSrc = game?.image ?? null
  const developer = game?.developers?.[0] ?? game?.developer ?? null
  const gameMeta = [game?.year, developer].filter(Boolean).join(' · ')

  // ── No gameId → navigate away ────────────────────────────────────────────

  if (!gameIdParam && !loadingGame) {
    navigate(-1)
    return null
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loadingGame) {
    return (
      <CenteredModal
        isOpen={open}
        onClose={() => closeWith(() => navigate(-1))}
        onExited={handleExited}
        ariaLabel="Loading game"
        maxWidth={360}
      >
        <div className="jnc-topbar">
          <button className="jnc-topbar-cancel" onClick={() => closeWith(() => navigate(-1))} type="button">
            Cancel
          </button>
          <span className="jnc-topbar-title">New journal entry</span>
          <span className="jnc-topbar-save jnc-topbar-save--disabled" aria-hidden="true">Save</span>
        </div>
        <div className="jnc-loading-body">
          <span className="jnc-inline-spinner" aria-label="Loading game…" />
        </div>
      </CenteredModal>
    )
  }

  // ── Game load error ───────────────────────────────────────────────────────

  if (gameError) {
    return (
      <CenteredModal
        isOpen={open}
        onClose={() => closeWith(() => navigate(-1))}
        onExited={handleExited}
        ariaLabel="New journal entry"
        maxWidth={360}
      >
        <div className="jnc-topbar">
          <button className="jnc-topbar-cancel" onClick={() => closeWith(() => navigate(-1))} type="button">
            Cancel
          </button>
          <span className="jnc-topbar-title">New journal entry</span>
          <span className="jnc-topbar-save jnc-topbar-save--disabled" aria-hidden="true">Save</span>
        </div>
        <div className="jnc-error-body">
          <p className="jnc-error-text">{gameError}</p>
        </div>
      </CenteredModal>
    )
  }

  // ── Composer ──────────────────────────────────────────────────────────────

  return (
    <CenteredModal
      isOpen={open}
      onClose={handleCancel}
      onExited={handleExited}
      ariaLabel="New journal entry"
      maxWidth={360}
    >
      {/* Top row: Cancel | New journal entry | Save */}
      <div className="jnc-topbar">
        <button className="jnc-topbar-cancel" onClick={handleCancel} type="button">
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

        {/* Thoughts textarea */}
        <div className="jnc-textarea-wrap">
          <textarea
            className="jnc-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What happened? Jot a note about your playthrough…"
            maxLength={MAX_CHARS}
            aria-label="Journal entry text"
          />
          <p
            className={`jnc-char-count${text.length > MAX_CHARS * 0.9 ? ' jnc-char-count--warn' : ''}`}
            aria-live="polite"
          >
            {text.length}/{MAX_CHARS}
          </p>
        </div>

        {/* Tips line */}
        <p className="jnc-tip">
          Tip: use <em>*italics*</em> and <code>[spoiler]…[/spoiler]</code> for spoiler tags.
        </p>

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
          <label className="jnc-hours-label" htmlFor="jnc-hours-input-new">
            Hours played
          </label>
          <div className="jnc-hours-input-wrap">
            <input
              id="jnc-hours-input-new"
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

        {/* Toggles: Contains spoilers */}
        <div className="jnc-group" role="group" aria-label="Journal entry options">
          <div className="jnc-group-row">
            <span className="jnc-group-label">Contains spoilers</span>
            <IOSSwitch
              checked={containsSpoilers}
              onChange={setContainsSpoilers}
              label="Contains spoilers"
            />
          </div>
        </div>
      </div>
    </CenteredModal>
  )
}

export default JournalNew

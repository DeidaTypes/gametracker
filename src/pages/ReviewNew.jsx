import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { StarRating } from '../components/forms'
import GamePickerSheet from '../components/GamePickerSheet'
import CenteredModal from '../components/CenteredModal'
import IOSSwitch from '../components/IOSSwitch'
import { getGameById } from '../services/igdb'
import { postReview, updateReview } from '../services/reviewService'
import { setGameStatus } from '../services/libraryService'
import { useAuth } from '../contexts/AuthContext'
import { showToast } from '../components/Toast'
import './ReviewNew.css'

function ReviewNew() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()

  const gameIdParam = searchParams.get('gameId')

  // Edit mode: location.state.editReview is a ReviewCard-shape object
  // (id, rating, body, hoursPlayed, liked, hasSpoilers, game.*) set by
  // the parent page when the user taps "Edit review" on their own card.
  const editReview = location.state?.editReview ?? null
  const isEditMode = !!editReview

  const [game, setGame] = useState(location.state?.game ?? null)
  const [loadingGame, setLoadingGame] = useState(false)
  const [gameError, setGameError] = useState(null)

  // Composer state — initialised from the existing review in edit mode.
  const [rating, setRating] = useState(isEditMode ? (editReview.rating ?? 0) : 0)
  const [text, setText] = useState(isEditMode ? (editReview.body ?? '') : '')
  const [hoursRaw, setHoursRaw] = useState(() => {
    if (!isEditMode) return '0'
    const h = editReview.hoursPlayed ?? 0
    return h % 1 === 0 ? String(h) : Number(h).toFixed(1)
  })
  const [loved, setLoved] = useState(isEditMode ? (editReview.liked ?? false) : false)
  const [containsSpoilers, setContainsSpoilers] = useState(
    isEditMode ? (editReview.hasSpoilers ?? false) : false
  )
  // markCompleted is a create-only action — irrelevant when editing an
  // existing review, so we hide the toggle entirely in edit mode.
  const [markCompleted, setMarkCompleted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Drives the popup enter/exit animation.
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
        console.error('[ReviewNew] failed to load game:', err)
        if (!cancelled) setGameError('Could not load game details.')
      })
      .finally(() => { if (!cancelled) setLoadingGame(false) })

    return () => { cancelled = true }
  }, [gameIdParam, location.state?.game])

  const hasInput = rating > 0 || text.trim().length > 0
  const canSave = !submitting && hasInput

  // In edit mode, only ask for discard confirmation when something changed.
  const isDirty = isEditMode
    ? rating !== (editReview.rating ?? 0) ||
      text.trim() !== (editReview.body ?? '').trim() ||
      (parseFloat(hoursRaw) || 0) !== (editReview.hoursPlayed ?? 0) ||
      loved !== (editReview.liked ?? false) ||
      containsSpoilers !== (editReview.hasSpoilers ?? false)
    : hasInput

  const handleCancel = useCallback(() => {
    if (isDirty && !window.confirm(isEditMode ? 'Discard changes?' : 'Discard this review?')) return
    closeWith(() => navigate(-1))
  }, [isDirty, isEditMode, navigate, closeWith])

  const handleSave = useCallback(async () => {
    if (!canSave) return
    if (!isEditMode && !game) return
    setSubmitting(true)
    try {
      const deadline = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Request timed out. Please check your connection.')),
          12000
        )
      )

      if (isEditMode) {
        await Promise.race([
          updateReview(editReview.id, {
            body: text.trim(),
            rating: Number(rating),
            liked: !!loved,
            hasSpoilers: !!containsSpoilers,
            hoursPlayed: Math.min(parseFloat(hoursRaw) || 0, 9999),
          }),
          deadline,
        ])
      } else {
        await Promise.race([
          postReview({
            igdbGameId: game.id,
            body: text.trim(),
            rating: Number(rating),
            liked: !!loved,
            hasSpoilers: !!containsSpoilers,
            gameTitle: game.title,
            gameImage: game.image,
            hoursPlayed: Math.min(parseFloat(hoursRaw) || 0, 9999),
          }),
          deadline,
        ])

        if (markCompleted) {
          setGameStatus(game.id, 'played', game)
        }
      }

      window.dispatchEvent(new Event('reviewAdded'))
      showToast(isEditMode ? 'Review updated!' : 'Review saved!', 'success')
      closeWith(() => navigate(-1))
    } catch (err) {
      console.error('[ReviewNew] save failed:', err)
      showToast('Could not save your review. Please try again.', 'error')
      setSubmitting(false)
    }
  }, [
    canSave, isEditMode, editReview, game,
    text, rating, loved, containsSpoilers, hoursRaw, markCompleted,
    navigate, closeWith,
  ])

  const handleGamePicked = useCallback((picked) => {
    navigate(`/review/new?gameId=${picked.id}`, {
      replace: true,
      state: { game: picked },
    })
  }, [navigate])

  // Permit: empty, up-to-4 digits, optionally followed by a dot + one digit.
  const handleHoursChange = (e) => {
    const v = e.target.value
    if (!/^(\d{0,4}(\.\d?)?)?$/.test(v)) return
    setHoursRaw(v)
  }

  const handleHoursBlur = () => {
    const n = parseFloat(hoursRaw)
    if (!hoursRaw || isNaN(n) || n < 0) {
      setHoursRaw('0')
    } else {
      const clamped = Math.min(n, 9999)
      setHoursRaw(clamped % 1 === 0 ? String(clamped) : clamped.toFixed(1))
    }
  }

  const adjustHours = (delta) => {
    const current = parseFloat(hoursRaw) || 0
    const next = Math.max(0, Math.min(9999, Math.round((current + delta) * 10) / 10))
    setHoursRaw(next % 1 === 0 ? String(next) : next.toFixed(1))
  }

  const hoursInputRef = useRef(null)

  const coverSrc = game?.image ?? null
  const developer = game?.developers?.[0] ?? game?.developer ?? null
  const gameMeta = [game?.year, developer].filter(Boolean).join(' · ')

  // ── No gameId + not edit mode → pick a game first; cancel goes back ────

  if (!gameIdParam && !loadingGame && !isEditMode) {
    return (
      <GamePickerSheet
        isOpen
        onSelect={handleGamePicked}
        onCancel={() => navigate(-1)}
      />
    )
  }

  // ── Loading the game → quiet centered popup ─────────────────────────────

  if (loadingGame) {
    return (
      <CenteredModal isOpen={open} onClose={() => closeWith(() => navigate(-1))} onExited={handleExited} ariaLabel="Loading game" maxWidth={360}>
        <div className="rnc-topbar">
          <button className="rnc-topbar-cancel" onClick={() => closeWith(() => navigate(-1))} type="button">
            Cancel
          </button>
          <span className="rnc-topbar-title">{isEditMode ? 'Edit review' : 'Write review'}</span>
          <span className="rnc-topbar-post rnc-topbar-post--disabled" aria-hidden="true">
            {isEditMode ? 'Save' : 'Post'}
          </span>
        </div>
        <div className="rnc-loading-body">
          <span className="rnc-inline-spinner" aria-label="Loading game…" />
        </div>
      </CenteredModal>
    )
  }

  // ── Game load error ──────────────────────────────────────────────────────

  if (gameError) {
    return (
      <CenteredModal isOpen={open} onClose={() => closeWith(() => navigate(-1))} onExited={handleExited} ariaLabel="Write review" maxWidth={360}>
        <div className="rnc-topbar">
          <button className="rnc-topbar-cancel" onClick={() => closeWith(() => navigate(-1))} type="button">
            Cancel
          </button>
          <span className="rnc-topbar-title">{isEditMode ? 'Edit review' : 'Write review'}</span>
          <span className="rnc-topbar-post rnc-topbar-post--disabled" aria-hidden="true">
            {isEditMode ? 'Save' : 'Post'}
          </span>
        </div>
        <div className="rnc-error-body">
          <p className="rnc-error-text">{gameError}</p>
        </div>
      </CenteredModal>
    )
  }

  // ── Composer ─────────────────────────────────────────────────────────────

  return (
    <CenteredModal
      isOpen={open}
      onClose={handleCancel}
      onExited={handleExited}
      ariaLabel={isEditMode ? 'Edit review' : 'Write review'}
      maxWidth={360}
    >
      {/* Top row: Cancel | Write review / Edit review | Post / Save */}
      <div className="rnc-topbar">
        <button className="rnc-topbar-cancel" onClick={handleCancel} type="button">
          Cancel
        </button>
        <span className="rnc-topbar-title">
          {isEditMode ? 'Edit review' : 'Write review'}
        </span>
        <button
          className={`rnc-topbar-post${!canSave ? ' rnc-topbar-post--disabled' : ''}`}
          onClick={handleSave}
          disabled={!canSave}
          type="button"
          aria-disabled={!canSave}
        >
          {submitting ? (
            <span className="rnc-post-spinner" aria-label={isEditMode ? 'Saving…' : 'Posting…'} />
          ) : (
            isEditMode ? 'Save' : 'Post'
          )}
        </button>
      </div>

      <div className="rnc-scroll cm-scroll">
        {/* Game header */}
        <div className="rnc-game-header">
          {coverSrc
            ? <img src={coverSrc} alt={game?.title} className="rnc-game-cover" />
            : <div className="rnc-game-cover rnc-game-cover--placeholder" aria-hidden="true" />
          }
          <div className="rnc-game-info">
            <p className="rnc-game-title">{game?.title}</p>
            {gameMeta && <p className="rnc-game-meta">{gameMeta}</p>}
          </div>
        </div>

        {/* Star rating */}
        <div className="rnc-rating-block">
          <StarRating
            value={rating}
            onChange={setRating}
            size="md"
            aria-label="Your rating out of 5"
            className="rnc-stars"
          />
          <p className="rnc-rating-hint" aria-live="polite">
            {rating === 0 ? 'Tap to rate' : `${rating} out of 5`}
          </p>
        </div>

        {/* Hours played */}
        <div className="rnc-hours-row">
          <span className="rnc-group-label">Hours played</span>
          <div className="rnc-stepper">
            <button
              type="button"
              className="rnc-stepper-btn"
              onClick={() => adjustHours(-0.5)}
              aria-label="Decrease hours played"
            >−</button>
            <input
              ref={hoursInputRef}
              type="text"
              inputMode="decimal"
              className="rnc-stepper-input"
              value={hoursRaw}
              onChange={handleHoursChange}
              onBlur={handleHoursBlur}
              aria-label="Hours played"
              maxLength={6}
            />
            <button
              type="button"
              className="rnc-stepper-btn"
              onClick={() => adjustHours(0.5)}
              aria-label="Increase hours played"
            >+</button>
          </div>
        </div>

        {/* Review text box */}
        <div className="rnc-textarea-wrap">
          <textarea
            className="rnc-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write your thoughts…"
            maxLength={5000}
            aria-label="Review text"
          />
          <p className="rnc-char-count" aria-live="polite">{text.length}/5000</p>
        </div>

        {/* Tips line */}
        <p className="rnc-tip">
          Tip: use <em>*italics*</em> and <code>[spoiler]…[/spoiler]</code> for spoiler tags.
        </p>

        {/* Toggles */}
        <div className="rnc-group" role="group" aria-label="Review options">
          <div className="rnc-group-row">
            <span className="rnc-group-label">Liked</span>
            <IOSSwitch
              checked={loved}
              onChange={setLoved}
              label="Mark as liked"
            />
          </div>

          <div className="rnc-group-divider" aria-hidden="true" />

          <div className="rnc-group-row">
            <span className="rnc-group-label">Contains spoilers</span>
            <IOSSwitch
              checked={containsSpoilers}
              onChange={setContainsSpoilers}
              label="Contains spoilers"
            />
          </div>

          {/* Mark as completed is create-only: irrelevant when editing. */}
          {!isEditMode && (
            <>
              <div className="rnc-group-divider" aria-hidden="true" />
              <div className="rnc-group-row">
                <span className="rnc-group-label">Mark as completed</span>
                <IOSSwitch
                  checked={markCompleted}
                  onChange={setMarkCompleted}
                  label="Mark game as completed"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </CenteredModal>
  )
}

export default ReviewNew

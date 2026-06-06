import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { LuSearch } from 'react-icons/lu'
import { StarRating } from '../components/forms'
import GamePickerSheet from '../components/GamePickerSheet'
import { getGameById } from '../services/igdb'
import { postReview } from '../services/reviewService'
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

  const [game, setGame] = useState(location.state?.game ?? null)
  const [loadingGame, setLoadingGame] = useState(false)
  const [gameError, setGameError] = useState(null)
  const [showPicker, setShowPicker] = useState(false)

  // Composer state
  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  const [hoursPlayed, setHoursPlayed] = useState(0)
  const [loved, setLoved] = useState(false)
  const [containsSpoilers, setContainsSpoilers] = useState(false)
  const [markCompleted, setMarkCompleted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Load game by ID if we have a param but no pre-loaded state
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

  const handleCancel = useCallback(() => {
    if (hasInput && !window.confirm('Discard this review?')) return
    navigate(-1)
  }, [hasInput, navigate])

  const canPost = !submitting && (rating > 0 || text.trim().length >= 10)

  const handlePost = useCallback(async () => {
    if (!canPost || !game) return
    setSubmitting(true)
    try {
      await postReview({
        igdbGameId: game.id,
        body: text.trim(),
        rating: Number(rating),
        liked: !!loved,
        hasSpoilers: !!containsSpoilers,
        gameTitle: game.title,
        gameImage: game.image,
        hoursPlayed: Number(hoursPlayed) || 0,
      })

      if (markCompleted) {
        setGameStatus(game.id, 'played', game)
      }

      window.dispatchEvent(new Event('reviewAdded'))
      showToast('Review saved!', 'success')
      navigate(-1)
    } catch (err) {
      console.error('[ReviewNew] postReview failed:', err)
      showToast('Could not save your review. Please try again.', 'error')
    } finally {
      setSubmitting(false)
    }
  }, [canPost, game, text, rating, loved, containsSpoilers, hoursPlayed, markCompleted, navigate])

  const handleGamePicked = useCallback((picked) => {
    setShowPicker(false)
    navigate(`/review/new?gameId=${picked.id}`, {
      replace: true,
      state: { game: picked },
    })
  }, [navigate])

  const adjustHours = (delta) => {
    setHoursPlayed((prev) => Math.max(0, (Number(prev) || 0) + delta))
  }

  const coverSrc = game?.image ?? null
  const developer = game?.developers?.[0] ?? game?.developer ?? null
  const gameMeta = [game?.year, developer].filter(Boolean).join(' · ')

  // ── Shared top bar ───────────────────────────────────────────────────────

  const TopBar = ({ postDisabled = true, onPost }) => (
    <div className="rnc-topbar">
      <button className="rnc-topbar-cancel" onClick={handleCancel} type="button">
        Cancel
      </button>
      <span className="rnc-topbar-title">Write review</span>
      <button
        className={`rnc-topbar-post${postDisabled ? ' rnc-topbar-post--disabled' : ''}`}
        onClick={onPost}
        disabled={postDisabled}
        type="button"
        aria-disabled={postDisabled}
      >
        {submitting ? '…' : 'Post'}
      </button>
    </div>
  )

  // ── No gameId → open picker immediately; cancel goes back ───────────────

  if (!gameIdParam && !loadingGame) {
    return (
      <div className="rnc-page">
        <GamePickerSheet
          isOpen
          onSelect={handleGamePicked}
          onCancel={() => navigate(-1)}
        />
      </div>
    )
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loadingGame) {
    return (
      <div className="rnc-page rnc-page--loading">
        <div className="rnc-spinner" aria-label="Loading game…" />
      </div>
    )
  }

  // ── Game load error ──────────────────────────────────────────────────────

  if (gameError) {
    return (
      <div className="rnc-page">
        <TopBar />
        <div className="rnc-empty">
          <p className="rnc-empty-body rnc-empty-body--error">{gameError}</p>
          <button className="rnc-choose-btn" onClick={() => setShowPicker(true)}>
            <LuSearch size={18} aria-hidden="true" />
            Try another game
          </button>
        </div>
        {showPicker && (
          <GamePickerSheet onSelect={handleGamePicked} onCancel={() => setShowPicker(false)} />
        )}
      </div>
    )
  }

  // ── Composer ─────────────────────────────────────────────────────────────

  return (
    <div className="rnc-page">
      <TopBar postDisabled={!canPost} onPost={handlePost} />

      <div className="rnc-scroll">
        {/* 1. Game header */}
        <div className="rnc-game-header">
          {coverSrc
            ? <img src={coverSrc} alt={game.title} className="rnc-game-cover" />
            : <div className="rnc-game-cover rnc-game-cover--placeholder" aria-hidden="true" />
          }
          <div className="rnc-game-info">
            <p className="rnc-game-title">{game?.title}</p>
            {gameMeta && <p className="rnc-game-meta">{gameMeta}</p>}
          </div>
        </div>

        {/* 2. Rating row */}
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

        {/* 3. Meta group: hours played + completed */}
        <div className="rnc-group" role="group" aria-label="Tracking info">
          <div className="rnc-group-row">
            <span className="rnc-group-label">Hours played</span>
            <div className="rnc-stepper">
              <button
                type="button"
                className="rnc-stepper-btn"
                onClick={() => adjustHours(-0.5)}
                aria-label="Decrease hours played"
              >−</button>
              <span className="rnc-stepper-value">{hoursPlayed}</span>
              <button
                type="button"
                className="rnc-stepper-btn"
                onClick={() => adjustHours(0.5)}
                aria-label="Increase hours played"
              >+</button>
            </div>
          </div>

          <div className="rnc-group-divider" aria-hidden="true" />

          <div className="rnc-group-row">
            <span className="rnc-group-label">Completed</span>
            <label className="rnc-switch">
              <input
                type="checkbox"
                checked={markCompleted}
                onChange={(e) => setMarkCompleted(e.target.checked)}
              />
              <span className="rnc-switch-track" aria-hidden="true">
                <span className="rnc-switch-thumb" />
              </span>
            </label>
          </div>
        </div>

        {/* 4. Review textarea */}
        <div className="rnc-textarea-wrap">
          <textarea
            className="rnc-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write your thoughts… (no spoilers — toggle below if needed)"
            maxLength={5000}
            aria-label="Review text"
          />
          <p className="rnc-char-count" aria-live="polite">{text.length}/5000</p>
        </div>

        {/* 5. Meta group: loved it + contains spoilers */}
        <div className="rnc-group" role="group" aria-label="Review options">
          <div className="rnc-group-row">
            <span className="rnc-group-label">Loved it</span>
            <button
              type="button"
              className={`rnc-heart-btn${loved ? ' rnc-heart-btn--on' : ''}`}
              onClick={() => setLoved((v) => !v)}
              aria-label={loved ? 'Remove loved' : 'Mark as loved'}
              aria-pressed={loved}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill={loved ? 'var(--accent)' : 'none'}
                stroke={loved ? 'var(--accent)' : 'var(--text-secondary)'}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
          </div>

          <div className="rnc-group-divider" aria-hidden="true" />

          <div className="rnc-group-row">
            <span className="rnc-group-label">Contains spoilers</span>
            <label className="rnc-switch">
              <input
                type="checkbox"
                checked={containsSpoilers}
                onChange={(e) => setContainsSpoilers(e.target.checked)}
              />
              <span className="rnc-switch-track" aria-hidden="true">
                <span className="rnc-switch-thumb" />
              </span>
            </label>
          </div>
        </div>

        {/* 6. Tip */}
        <p className="rnc-tip">
          Tip: use <em>*italics*</em> and <code>[spoiler]…[/spoiler]</code> for spoiler tags.
        </p>
      </div>

      {showPicker && (
        <GamePickerSheet onSelect={handleGamePicked} onCancel={() => setShowPicker(false)} />
      )}
    </div>
  )
}

export default ReviewNew

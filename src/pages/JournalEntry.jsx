import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LuChevronLeft } from 'react-icons/lu'
import { getJournalEntryById, deleteJournalEntry, getMoodMeta } from '../services/journalService'
import { useAuth } from '../contexts/AuthContext'
import JournalEntryModal from '../components/JournalEntryModal'
import { showToast } from '../components/Toast'
import './JournalEntry.css'

/**
 * JournalEntry — cinematic full-screen view for a single journal_entries row.
 *
 * Route: /journal/:entryId
 *
 * Layout:
 *  - Cover hero: full-width game cover with gradient overlay.
 *  - Floating game title + date on the cover.
 *  - Mood badge + hours pill in a meta row below the hero.
 *  - Entry body (spoiler-gated).
 *  - Owner actions: Edit / Delete.
 */
function JournalEntry() {
  const { entryId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [entry, setEntry] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    if (!entryId) return
    setLoading(true)
    try {
      const data = await getJournalEntryById(entryId)
      if (!data) {
        setNotFound(true)
      } else {
        setEntry(data)
        setRevealed(false)
      }
    } catch (err) {
      console.error('[JournalEntry] load failed:', err)
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [entryId])

  useEffect(() => {
    load()
  }, [load])

  // Refresh after an in-place edit.
  useEffect(() => {
    window.addEventListener('journalEntryUpdated', load)
    return () => window.removeEventListener('journalEntryUpdated', load)
  }, [load])

  const handleDelete = useCallback(async () => {
    if (!entry) return
    if (!window.confirm('Delete this journal entry?')) return
    setDeleting(true)
    try {
      await deleteJournalEntry(entry.id)
      showToast('Entry deleted.', 'success')
      navigate(-1)
    } catch (err) {
      console.error('[JournalEntry] delete failed:', err)
      showToast('Could not delete entry.', 'error')
      setDeleting(false)
    }
  }, [entry, navigate])

  const isOwner = !!(user && entry && user.id === entry.user_id)
  const isSpoilerBlocked = !!(entry?.is_spoiler && !revealed)

  // ── Header overlay (shared across states) ────────────────────────────

  const BackHeader = ({ transparent = false }) => (
    <header className={`je-header${transparent ? ' je-header--transparent' : ''}`}>
      <button
        type="button"
        className="je-back"
        onClick={() => navigate(-1)}
        aria-label="Go back"
      >
        <LuChevronLeft size={22} aria-hidden="true" />
      </button>
      {!transparent && <h1 className="je-header__title">Journal Entry</h1>}
      <div className="je-header__right">
        {isOwner && !transparent ? (
          <button
            type="button"
            className="je-edit-btn"
            onClick={() => setShowEdit(true)}
            aria-label="Edit entry"
          >
            Edit
          </button>
        ) : (
          <span className="je-header__spacer" aria-hidden="true" />
        )}
      </div>
    </header>
  )

  // ── Loading ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="je-page">
        <BackHeader />
        <div className="je-hero-skel" aria-hidden="true" />
        <div className="je-loading">
          <div className="skeleton je-skel-title" />
          <div className="skeleton je-skel-meta" />
          <div className="skeleton je-skel-body" />
          <div className="skeleton je-skel-body" />
          <div className="skeleton je-skel-body je-skel-body--short" />
        </div>
      </div>
    )
  }

  // ── Not found ────────────────────────────────────────────────────────

  if (notFound || !entry) {
    return (
      <div className="je-page">
        <BackHeader />
        <div className="je-not-found">
          <p className="je-not-found__text">This entry is no longer available.</p>
          <button
            type="button"
            className="je-not-found__back"
            onClick={() => navigate(-1)}
          >
            Go back
          </button>
        </div>
      </div>
    )
  }

  // ── Derived display values ───────────────────────────────────────────

  const formattedDate = new Date(entry.created_at).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const moodMeta = entry.mood ? getMoodMeta(entry.mood) : null

  const hoursLabel = entry.hours_played != null
    ? `${entry.hours_played % 1 === 0 ? entry.hours_played : entry.hours_played} hr${entry.hours_played !== 1 ? 's' : ''}`
    : null

  const gameForModal = {
    id: entry.igdb_game_id,
    title: entry.game_title || '',
    image: entry.game_image || null,
  }

  // ── Main render ──────────────────────────────────────────────────────

  return (
    <div className="je-page">
      {/* ── Cover hero ─────────────────────────────────────────────── */}
      <div className="je-hero" aria-hidden="true">
        {entry.game_image ? (
          <img
            src={entry.game_image}
            alt=""
            className="je-hero__img"
          />
        ) : (
          <div className="je-hero__placeholder" />
        )}
        <div className="je-hero__gradient" />

        {/* Back button floats over the hero */}
        <header className="je-header je-header--overlay">
          <button
            type="button"
            className="je-back je-back--glass"
            onClick={() => navigate(-1)}
            aria-label="Go back"
          >
            <LuChevronLeft size={22} aria-hidden="true" />
          </button>
          <span aria-hidden="true" />
          {isOwner && (
            <button
              type="button"
              className="je-edit-btn je-edit-btn--glass"
              onClick={() => setShowEdit(true)}
              aria-label="Edit entry"
            >
              Edit
            </button>
          )}
        </header>

        {/* Game title + date float at hero bottom */}
        <div className="je-hero__caption">
          <p className="je-hero__game">{entry.game_title || 'Unknown game'}</p>
          <time className="je-hero__date" dateTime={entry.created_at}>
            {formattedDate}
          </time>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────── */}
      <div className="je-scroll">

        {/* Entry title */}
        {entry.title ? (
          <h2 className="je-title">{entry.title}</h2>
        ) : null}

        {/* Mood + hours + spoiler badges */}
        {(moodMeta || hoursLabel || entry.is_spoiler) && (
          <div className="je-badges-row">
            {moodMeta && (
              <span className="je-mood-badge" data-mood={entry.mood}>
                <span className="je-mood-badge__emoji" aria-hidden="true">{moodMeta.emoji}</span>
                {moodMeta.label}
              </span>
            )}
            {hoursLabel && (
              <span className="je-hours-badge">
                ⏱ {hoursLabel}
              </span>
            )}
            {entry.is_spoiler && (
              <span className="je-spoiler-badge">spoiler</span>
            )}
          </div>
        )}

        {/* Body */}
        {entry.body ? (
          <div className={`je-body-wrap${isSpoilerBlocked ? ' je-body-wrap--blurred' : ''}`}>
            <p className="je-body">{entry.body}</p>
            {isSpoilerBlocked && (
              <button
                type="button"
                className="je-reveal-btn"
                onClick={() => setRevealed(true)}
                aria-label="Reveal spoiler content"
              >
                Tap to reveal spoiler
              </button>
            )}
          </div>
        ) : null}

        {/* Game context block — the ONLY route to game detail */}
        {entry.igdb_game_id && (
          <button
            type="button"
            className="je-game-block"
            onClick={() =>
              navigate(
                `/game/${entry.igdb_game_id}`,
                entry.game_image ? { state: { coverImage: entry.game_image } } : undefined,
              )
            }
            aria-label={`View ${entry.game_title || 'game'} detail`}
          >
            {entry.game_image ? (
              <img
                src={entry.game_image}
                alt={entry.game_title || ''}
                className="je-game-cover"
              />
            ) : (
              <div
                className="je-game-cover je-game-cover--placeholder"
                aria-hidden="true"
              />
            )}
            <div className="je-game-info">
              <p className="je-game-label">From game</p>
              <p className="je-game-title">{entry.game_title || 'Unknown game'}</p>
            </div>
            <svg
              className="je-game-chevron"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}

        {/* Delete — owner only */}
        {isOwner && (
          <div className="je-owner-actions">
            <button
              type="button"
              className="je-delete-btn"
              onClick={handleDelete}
              disabled={deleting}
              aria-label="Delete this entry"
            >
              {deleting ? 'Deleting…' : 'Delete entry'}
            </button>
          </div>
        )}
      </div>

      {/* Edit modal — pre-filled, updates in place */}
      {isOwner && (
        <JournalEntryModal
          isOpen={showEdit}
          onClose={() => setShowEdit(false)}
          game={gameForModal}
          entryId={entry.id}
          initialTitle={entry.title || ''}
          initialBody={entry.body || ''}
          initialIsSpoiler={entry.is_spoiler || false}
          initialMood={entry.mood || null}
          initialHours={entry.hours_played ?? null}
        />
      )}
    </div>
  )
}

export default JournalEntry

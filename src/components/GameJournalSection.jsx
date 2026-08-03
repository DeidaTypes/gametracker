import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { NotebookText } from 'lucide-react'
import {
  getJournalEntriesForGame,
  deleteJournalEntry,
} from '../services/journalService'
import { showToast } from './Toast'
import EmptyState from './EmptyState'
import './GameJournalSection.css'

/**
 * GameJournalSection — "Your Journal" block on the game detail page.
 *
 * Shows the signed-in user's dated notes for THIS game, newest first.
 * Spoiler entries are blurred until tapped. The user can delete their
 * own entries via a long-press / delete button.
 *
 * Visibility rules:
 *   - Always hidden when user is not signed in.
 *   - Hidden (returns null) when loading is done, entries are empty, AND
 *     the game is not in the user's library. This keeps game pages clean
 *     for games the user has never interacted with.
 *   - Shows (with empty-state + add button) when the game IS in the
 *     library but no entries have been written yet.
 *   - Always shows real entries regardless of current library status —
 *     entries written before a game was removed from the library are
 *     still surfaced here.
 *
 * Props:
 *   game        — the game object (id, title, image, year, developers)
 *   user        — the authenticated user (or null)
 *   status      — library status string (null means not in library)
 *   onAddEntry  — () => void — called when the user taps the "+" button;
 *                 parent opens the inline journal modal
 */
function GameJournalSection({ game, user, status, onAddEntry }) {
  const navigate = useNavigate()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [revealedIds, setRevealedIds] = useState(new Set())
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(async () => {
    if (!game?.id || !user) return
    setLoading(true)
    try {
      const rows = await getJournalEntriesForGame(game.id)
      setEntries(rows)
    } catch (err) {
      console.error('[GameJournalSection] load failed:', err)
    } finally {
      setLoading(false)
    }
  }, [game?.id, user])

  useEffect(() => {
    load()
  }, [load])

  // Re-load whenever a new entry is saved from the composer.
  useEffect(() => {
    window.addEventListener('journalEntryAdded', load)
    return () => window.removeEventListener('journalEntryAdded', load)
  }, [load])

  const handleAddEntry = useCallback(() => {
    if (!game) return
    onAddEntry?.()
  }, [game, onAddEntry])

  const handleReveal = useCallback((id) => {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const handleDelete = useCallback(async (entryId) => {
    if (!window.confirm('Delete this journal entry?')) return
    setDeletingId(entryId)
    try {
      await deleteJournalEntry(entryId)
      setEntries((prev) => prev.filter((e) => e.id !== entryId))
      showToast('Entry deleted.', 'success')
    } catch (err) {
      console.error('[GameJournalSection] delete failed:', err)
      showToast('Could not delete entry.', 'error')
    } finally {
      setDeletingId(null)
    }
  }, [])

  if (!user) return null

  // After the initial load resolves: hide entirely when there are no
  // entries AND the game isn't tracked. This keeps unvisited game pages
  // clean while still surfacing orphaned entries (game removed from
  // library after writing).
  if (!loading && entries.length === 0 && !status) return null

  return (
    <>
      <div className="gd-divider" />
      <div className="gjs-section">
      <div className="gjs-header-row">
        <h2 className="gjs-heading">Your Journal</h2>
        <button
          type="button"
          className="gjs-add-btn"
          onClick={handleAddEntry}
          aria-label="Add journal entry"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {loading && entries.length === 0 ? (
        <div className="gjs-skeleton-wrap" aria-hidden="true">
          <div className="gjs-skeleton gjs-skeleton--line" />
          <div className="gjs-skeleton gjs-skeleton--line gjs-skeleton--short" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState icon={NotebookText} size="inline" body="No journal entries yet — jot a note as you play." />
      ) : (
        <ul className="gjs-list" aria-label="Journal entries">
          {entries.map((entry) => {
            const isSpoiler = entry.is_spoiler && !revealedIds.has(entry.id)
            return (
              <li key={entry.id} className="gjs-entry">
                {/* Tappable card area — navigates to the entry detail page */}
                <button
                  type="button"
                  className="gjs-entry-btn"
                  onClick={() => navigate(`/journal/${entry.id}`)}
                  aria-label={`Open journal entry: ${entry.title || formatRelativeDate(entry.created_at)}`}
                >
                  {/* Title + date row */}
                  <div className="gjs-entry-header">
                    {entry.title && (
                      <p className="gjs-entry-title">{entry.title}</p>
                    )}
                    <div className="gjs-entry-meta">
                      <time
                        className="gjs-entry-date"
                        dateTime={entry.created_at}
                        title={new Date(entry.created_at).toLocaleString()}
                      >
                        {formatRelativeDate(entry.created_at)}
                      </time>
                      {entry.is_spoiler && (
                        <span className="gjs-spoiler-badge">spoiler</span>
                      )}
                    </div>
                  </div>

                  {/* Notes body — blurred if spoiler */}
                  {entry.body ? (
                    <div className={`gjs-entry-body-wrap${isSpoiler ? ' gjs-entry-body-wrap--blurred' : ''}`}>
                      <p className="gjs-entry-body">{entry.body}</p>
                      {isSpoiler && (
                        <span className="gjs-spoiler-hint" aria-hidden="true">
                          Tap to reveal
                        </span>
                      )}
                    </div>
                  ) : null}
                </button>

                <button
                  type="button"
                  className="gjs-delete-btn"
                  onClick={() => handleDelete(entry.id)}
                  disabled={deletingId === entry.id}
                  aria-label="Delete this entry"
                >
                  {deletingId === entry.id ? '…' : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
    </>
  )
}

/* ── Relative date helper ────────────────────────────────────────────────── */

function formatRelativeDate(isoString) {
  if (!isoString) return ''
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now - date
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay === 1) return 'yesterday'
  if (diffDay < 7) return `${diffDay}d ago`
  if (diffDay < 365) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default GameJournalSection

import React, { useState, useEffect, useRef } from 'react'
import { searchGames } from '../services/searchService'
import CenteredModal from './CenteredModal'
import './CreateListModal.css'

const NAME_MAX = 60
const SEARCH_DEBOUNCE_MS = 300

function CreateListModal({ isOpen, onClose, onCreate }) {
  const [listName, setListName]           = useState('')
  const [selectedGames, setSelectedGames] = useState([])
  const [searchTerm, setSearchTerm]       = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching]     = useState(false)
  const [searchError, setSearchError]     = useState(null)
  const [lastQuery, setLastQuery]         = useState('')
  const [isSubmitting, setIsSubmitting]   = useState(false)
  const [submitError, setSubmitError]     = useState(null)

  const nameInputRef    = useRef(null)
  const debounceRef     = useRef(null)
  const searchCallIdRef = useRef(0)

  /* ─── Derived state ──────────────────────────────────────────────────────── */
  const showGamesPanel = listName.trim().length > 0
  const isValid        = listName.trim().length > 0 && selectedGames.length > 0
  const hasAnyInput    = listName.trim() !== '' || selectedGames.length > 0 || searchTerm.trim() !== ''

  /* ─── Reset when sheet closes ────────────────────────────────────────────── */
  const resetForm = () => {
    setListName('')
    setSelectedGames([])
    setSearchTerm('')
    setSearchResults([])
    setSearchError(null)
    setLastQuery('')
    setIsSubmitting(false)
    setSubmitError(null)
    setIsSearching(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }

  useEffect(() => {
    if (!isOpen) {
      resetForm()
    } else {
      // Autofocus on open — short delay lets the sheet animate in first.
      const t = setTimeout(() => nameInputRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  /* ─── Debounced game search ───────────────────────────────────────────────── */
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = searchTerm.trim()
    if (!trimmed) {
      setSearchResults([])
      setIsSearching(false)
      setSearchError(null)
      setLastQuery('')
      return
    }

    setIsSearching(true)
    setSearchError(null)
    const callId = ++searchCallIdRef.current

    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchGames(trimmed, 20)
        if (callId !== searchCallIdRef.current) return
        setSearchResults(results)
        setLastQuery(trimmed)
      } catch {
        if (callId !== searchCallIdRef.current) return
        setSearchError('Search failed. Please try again.')
        setSearchResults([])
        setLastQuery(trimmed)
      } finally {
        if (callId === searchCallIdRef.current) setIsSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchTerm])

  /* ─── Toggle selection ───────────────────────────────────────────────────── */
  const toggleGame = (game) => {
    const alreadySelected = !!selectedGames.find((g) => g.id === game.id)
    if (alreadySelected) {
      setSelectedGames((prev) => prev.filter((g) => g.id !== game.id))
    } else {
      setSelectedGames((prev) => [...prev, game])
    }
  }

  /* ─── Submit ─────────────────────────────────────────────────────────────── */
  const handleSubmit = async () => {
    if (!isValid || isSubmitting) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      // Pass empty description — users can add one via the edit screen later.
      await onCreate(listName.trim(), '', selectedGames)
      onClose()
    } catch (err) {
      console.error('[CreateListModal] onCreate failed:', err)
      setSubmitError('Failed to create list. Please try again.')
      setIsSubmitting(false)
    }
  }

  /* ─── Cancel / discard ───────────────────────────────────────────────────── */
  const handleCancel = () => {
    if (hasAnyInput) {
      if (!window.confirm('Discard list?')) return
    }
    onClose()
  }

  /* ─── Keyboard: Enter on name field should NOT submit ────────────────────── */
  const handleNameKeyDown = (e) => {
    if (e.key === 'Enter') e.preventDefault()
  }

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={handleCancel}
      ariaLabel="Create a list"
      maxWidth={400}
      className="clm-card"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="clm-header">
        <button
          type="button"
          className="clm-cancel-btn"
          onClick={handleCancel}
          aria-label="Cancel"
        >
          ✕
        </button>
        <span className="clm-header-title">New List</span>
        <button
          type="button"
          className="clm-create-btn"
          onClick={handleSubmit}
          disabled={!isValid || isSubmitting}
        >
          {isSubmitting ? 'Creating…' : 'Create'}
        </button>
      </div>

      {/* ── Pinned name input — stays fixed below the header, always
           visible above the keyboard, never scrolls away ── */}
      <div className="clm-name-pinned">
        <input
          ref={nameInputRef}
          className="clm-name-input"
          type="text"
          placeholder="Name your list…"
          value={listName}
          onChange={(e) => setListName(e.target.value.slice(0, NAME_MAX))}
          onKeyDown={handleNameKeyDown}
          autoComplete="off"
          maxLength={NAME_MAX}
        />
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────── */}
      <div className="clm-body cm-scroll">
        {/* Games panel — appears as soon as name has ≥1 character */}
        {showGamesPanel && (
          <div className="clm-games-panel">

            {/* Selected strip — hidden until ≥1 game selected */}
            {selectedGames.length > 0 && (
              <div className="clm-selected-section">
                <p className="clm-selected-label">
                  Selected&thinsp;({selectedGames.length})
                </p>
                <div className="clm-selected-strip">
                  {selectedGames.map((game) => (
                    <div key={game.id} className="clm-selected-thumb">
                      {game.image ? (
                        <img
                          src={game.image}
                          alt={game.title}
                          className="clm-selected-img"
                          draggable={false}
                        />
                      ) : (
                        <div className="clm-selected-img clm-selected-img--placeholder">
                          {game.title?.charAt(0) || '?'}
                        </div>
                      )}
                      <button
                        type="button"
                        className="clm-selected-remove"
                        onClick={() => toggleGame(game)}
                        aria-label={`Remove ${game.title}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Search input */}
            <div className="clm-search-row">
              <input
                className="clm-search-input"
                type="search"
                placeholder="Search games to add"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>

            {/* Status lines */}
            {isSearching && (
              <p className="clm-status" aria-live="polite">Searching…</p>
            )}
            {searchError && (
              <p className="clm-status clm-status--error">{searchError}</p>
            )}
            {!isSearching &&
              searchTerm.trim() !== '' &&
              searchTerm.trim() === lastQuery &&
              searchResults.length === 0 &&
              !searchError && (
                <p className="clm-status">No games found for &ldquo;{searchTerm}&rdquo;.</p>
              )}

            {/* 2-column cover grid */}
            {searchResults.length > 0 && (
              <div className="clm-results-grid" role="list">
                {searchResults.map((game) => {
                  const isSelected = !!selectedGames.find((g) => g.id === game.id)
                  return (
                    <button
                      key={game.id}
                      type="button"
                      role="listitem"
                      className={`clm-result-item${isSelected ? ' clm-result-item--selected' : ''}`}
                      onClick={() => toggleGame(game)}
                      aria-label={`${isSelected ? 'Remove' : 'Add'} ${game.title}`}
                      aria-pressed={isSelected}
                    >
                      <div className="clm-result-cover">
                        {game.image ? (
                          <img
                            src={game.image}
                            alt=""
                            className="clm-result-img"
                            draggable={false}
                          />
                        ) : (
                          <div className="clm-result-img clm-result-img--placeholder">
                            {game.title?.charAt(0) || '?'}
                          </div>
                        )}
                        {isSelected && (
                          <div className="clm-checkmark" aria-hidden="true">✓</div>
                        )}
                      </div>
                      <p className="clm-result-title">{game.title}</p>
                    </button>
                  )
                })}
              </div>
            )}

            {submitError && (
              <p className="clm-status clm-status--error" role="alert">{submitError}</p>
            )}
          </div>
        )}
      </div>
    </CenteredModal>
  )
}

export default CreateListModal

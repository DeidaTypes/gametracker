import React, { useState, useEffect, useRef } from 'react'
import { Globe, Lock, ChevronLeft, Plus, Check, X, SearchX } from 'lucide-react'
import { searchGames } from '../services/searchService'
import { hapticImpact } from '../utils/haptics'
import CenteredModal from './CenteredModal'
import EmptyState from './EmptyState'
import './CreateListModal.css'

const NAME_MAX = 60
const SEARCH_DEBOUNCE_MS = 300

/**
 * CreateListModal — two-step "New List" flow on the shared CenteredModal shell.
 *
 * Step 1 (identity): name + optional description + Public/Private visibility.
 * Held in local state only — nothing is created yet.
 *
 * Step 2 (game picker): search + pick games. "Create" commits everything in
 * one flow: createList({ name, description, isPublic }) then addGameToList
 * for each picked game (see Library.jsx's handleCreateList), then navigate
 * to the new list. `onCreate` performs that sequence; this component only
 * collects the inputs and calls it once.
 */
function CreateListModal({ isOpen, onClose, onCreate }) {
  const [step, setStep] = useState(1)

  // ── Step 1 fields ────────────────────────────────────────────────────────
  const [listName, setListName]     = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic]     = useState(true)

  // ── Step 2 — game picker ────────────────────────────────────────────────
  const [selectedGames, setSelectedGames] = useState([])
  const [searchTerm, setSearchTerm]       = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching]     = useState(false)
  const [searchError, setSearchError]     = useState(null)
  const [lastQuery, setLastQuery]         = useState('')
  const [isSubmitting, setIsSubmitting]   = useState(false)
  const [submitError, setSubmitError]     = useState(null)

  const nameInputRef    = useRef(null)
  const searchInputRef  = useRef(null)
  const debounceRef     = useRef(null)
  const searchCallIdRef = useRef(0)

  /* ─── Derived state ──────────────────────────────────────────────────────── */
  const trimmedName  = listName.trim()
  const isNameValid  = trimmedName.length > 0
  const isCreateValid = isNameValid && selectedGames.length > 0
  const hasAnyInput = (
    trimmedName !== '' ||
    description.trim() !== '' ||
    selectedGames.length > 0 ||
    searchTerm.trim() !== ''
  )

  /* ─── Reset when sheet closes ────────────────────────────────────────────── */
  const resetForm = () => {
    setStep(1)
    setListName('')
    setDescription('')
    setIsPublic(true)
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
      // Autofocus the name field — short delay lets the popup animate in first.
      const t = setTimeout(() => nameInputRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  // Autofocus the search field whenever step 2 becomes active.
  useEffect(() => {
    if (isOpen && step === 2) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [isOpen, step])

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

  /* ─── Step navigation ────────────────────────────────────────────────────── */
  const handleNext = () => {
    if (!isNameValid) return
    setSubmitError(null)
    setStep(2)
  }

  const handleBack = () => {
    setSubmitError(null)
    setStep(1)
  }

  /* ─── Submit — commits name + description + visibility + games ─────────── */
  const handleSubmit = async () => {
    if (!isCreateValid || isSubmitting) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      await onCreate(trimmedName, description.trim(), selectedGames, isPublic)
      hapticImpact('Medium')
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

  /* ─── Keyboard: Enter on name field advances to step 2, doesn't submit ──── */
  const handleNameKeyDown = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    handleNext()
  }

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={handleCancel}
      ariaLabel={step === 1 ? 'Create a list' : `Add games to ${trimmedName || 'list'}`}
      maxWidth={400}
      className="clm-card"
    >
      {step === 1 ? (
        /* ══════════════════════ STEP 1 — Identity ══════════════════════ */
        <div className="clm-step1">
          <p className="clm-eyebrow">New List</p>

          <div className={`clm-name-field${isNameValid ? ' clm-name-field--filled' : ''}`}>
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

          <textarea
            className="clm-desc-input"
            placeholder="Add a description… (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 300))}
            rows={2}
            maxLength={300}
          />

          <div className="clm-step1-footer">
            <button
              type="button"
              className="clm-visibility-pill"
              onClick={() => setIsPublic((p) => !p)}
              aria-pressed={isPublic}
              aria-label={`Visibility: ${isPublic ? 'Public' : 'Private'}. Tap to toggle.`}
            >
              {isPublic ? <Globe size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
              <span>{isPublic ? 'Public' : 'Private'}</span>
            </button>

            <div className="clm-step1-actions">
              <button type="button" className="clm-cancel-link" onClick={handleCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="clm-next-btn"
                onClick={handleNext}
                disabled={!isNameValid}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ══════════════════════ STEP 2 — Game picker ══════════════════════ */
        <div className="clm-step2">
          <div className="clm-step2-header">
            <button type="button" className="clm-back-btn" onClick={handleBack} aria-label="Back">
              <ChevronLeft size={18} aria-hidden="true" />
              <span>Back</span>
            </button>
            <span className="clm-step2-title">Add games</span>
            <button
              type="button"
              className="clm-create-btn"
              onClick={handleSubmit}
              disabled={!isCreateValid || isSubmitting}
            >
              {isSubmitting ? 'Creating…' : `Create · ${selectedGames.length}`}
            </button>
          </div>

          <div className="clm-progress-dots" aria-hidden="true">
            <span className="clm-dot" />
            <span className="clm-dot clm-dot--active" />
          </div>

          <p className="clm-step2-subtitle">Building {trimmedName}</p>

          {/* ── Pinned search input — stays fixed, visible above the keyboard ── */}
          <div className="clm-search-pinned">
            <div className="clm-search-row">
              <svg
                className="clm-search-icon"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                ref={searchInputRef}
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
          </div>

          {/* ── Scrollable body ─────────────────────────────────────────────── */}
          <div className="clm-body cm-scroll">
            {/* Picked games — pinned horizontal strip, tap-to-remove */}
            {selectedGames.length > 0 && (
              <div className="clm-selected-section">
                <p className="clm-selected-label">
                  In this list&thinsp;·&thinsp;{selectedGames.length}
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
                        <X size={12} aria-hidden="true" strokeWidth={2.5} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                <EmptyState icon={SearchX} size="inline" body={`No games found for "${searchTerm}".`} />
              )}

            {/* Results — row list: cover + title + year/dev + add/added toggle */}
            {searchResults.length > 0 && (
              <div className="clm-row-list-section">
                <p className="clm-selected-label">Results</p>
                <div className="clm-row-list" role="list">
                  {searchResults.map((game) => {
                    const isSelected = !!selectedGames.find((g) => g.id === game.id)
                    const meta = [game.year, game.developer].filter(Boolean).join(' · ')
                    return (
                      <button
                        key={game.id}
                        type="button"
                        role="listitem"
                        className="clm-row-item"
                        onClick={() => toggleGame(game)}
                        aria-label={`${isSelected ? 'Remove' : 'Add'} ${game.title}`}
                        aria-pressed={isSelected}
                      >
                        {game.image ? (
                          <img
                            src={game.image}
                            alt=""
                            className="clm-row-cover"
                            draggable={false}
                          />
                        ) : (
                          <div className="clm-row-cover clm-row-cover--placeholder">
                            {game.title?.charAt(0) || '?'}
                          </div>
                        )}
                        <div className="clm-row-info">
                          <p className="clm-row-title">{game.title}</p>
                          {meta && <p className="clm-row-meta">{meta}</p>}
                        </div>
                        <span
                          className={`clm-row-toggle${isSelected ? ' clm-row-toggle--selected' : ''}`}
                          aria-hidden="true"
                        >
                          {isSelected ? <Check size={14} strokeWidth={2.5} /> : <Plus size={14} strokeWidth={2.5} />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {submitError && (
              <p className="clm-status clm-status--error" role="alert">{submitError}</p>
            )}
          </div>
        </div>
      )}
    </CenteredModal>
  )
}

export default CreateListModal

import React, { useState, useEffect, useRef } from 'react'
import { useAutoAnimateMotion } from '../hooks/useMotionPreference'
import { searchGames } from '../services/searchService'
import {
  TextField,
  TextArea,
  SubmitButton,
  SecondaryButton,
} from './forms'
import { showToast } from './Toast'
import './CreateListModal.css'

const NAME_MAX = 60
const DESCRIPTION_MAX = 500
const SEARCH_DEBOUNCE_MS = 300

/** Fanned cover preview using the last 3 selected games */
function ListCoverPreview({ selectedGames }) {
  const n = selectedGames.length

  let slots = []
  if (n === 0) {
    slots = [
      { key: 'p0', kind: 'placeholder', rotate: -8, z: 1 },
      { key: 'p1', kind: 'placeholder', rotate: 0, z: 3 },
      { key: 'p2', kind: 'placeholder', rotate: 8, z: 2 },
    ]
  } else if (n === 1) {
    slots = [
      { key: selectedGames[0].id, kind: 'game', game: selectedGames[0], rotate: -8, z: 1 },
    ]
  } else if (n === 2) {
    slots = [
      { key: selectedGames[0].id, kind: 'game', game: selectedGames[0], rotate: -6, z: 1 },
      { key: selectedGames[1].id, kind: 'game', game: selectedGames[1], rotate: 6, z: 2 },
    ]
  } else {
    const last3 = selectedGames.slice(-3)
    slots = [
      { key: last3[0].id, kind: 'game', game: last3[0], rotate: -8, z: 1 },
      { key: last3[1].id, kind: 'game', game: last3[1], rotate: 0, z: 3 },
      { key: last3[2].id, kind: 'game', game: last3[2], rotate: 8, z: 2 },
    ]
  }

  return (
    <section className="list-cover-preview" aria-label="List cover preview">
      <div className="list-cover-preview__fan">
        {slots.map((slot) => (
          <div
            key={slot.key}
            className="list-cover-preview__card-wrap"
            style={{ zIndex: slot.z, transform: `rotate(${slot.rotate}deg)` }}
          >
            {slot.kind === 'placeholder' ? (
              <div
                className="list-cover-preview__card list-cover-preview__card--placeholder"
                aria-hidden
              />
            ) : slot.game.image ? (
              <img
                src={slot.game.image}
                alt=""
                className="list-cover-preview__card list-cover-preview__card--image"
                draggable={false}
              />
            ) : (
              <div
                className="list-cover-preview__card list-cover-preview__card--fallback"
                aria-hidden
              >
                {slot.game.title?.charAt(0) || '?'}
              </div>
            )}
          </div>
        ))}
      </div>
      {n === 0 && (
        <p className="list-cover-preview__hint">Add games to see your list cover</p>
      )}
    </section>
  )
}

function CreateListModal({ isOpen, onClose, onCreate }) {
  const [listName, setListName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedGames, setSelectedGames] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [lastCompletedQuery, setLastCompletedQuery] = useState('')
  const [gamesError, setGamesError] = useState('')
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)

  const debounceRef = useRef(null)
  const searchCallIdRef = useRef(0)
  const dragGameIdRef = useRef(null)
  const [selectedStripRef] = useAutoAnimateMotion()

  const resetForm = () => {
    setListName('')
    setDescription('')
    setSelectedGames([])
    setSearchTerm('')
    setSearchResults([])
    setSearchError(null)
    setLastCompletedQuery('')
    setGamesError('')
    setSubmitAttempted(false)
    setIsSubmitting(false)
    setSubmitError(null)
    setIsSearching(false)
    setDragOverId(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }

  useEffect(() => {
    if (!isOpen) resetForm()
  }, [isOpen])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = searchTerm.trim()
    if (!trimmed) {
      setSearchResults([])
      setIsSearching(false)
      setSearchError(null)
      setLastCompletedQuery('')
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
        setLastCompletedQuery(trimmed)
      } catch (err) {
        if (callId !== searchCallIdRef.current) return
        console.error('Search error:', err)
        setSearchError('Failed to search games. Please try again.')
        setSearchResults([])
        setLastCompletedQuery(trimmed)
      } finally {
        if (callId === searchCallIdRef.current) setIsSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchTerm])

  const hasAnyInput =
    listName.trim() !== '' ||
    description.trim() !== '' ||
    selectedGames.length > 0 ||
    searchTerm.trim() !== ''

  const isValid = listName.trim().length > 0 && selectedGames.length > 0

  const handleAddGame = (game) => {
    if (selectedGames.find((g) => g.id === game.id)) return
    setSelectedGames((prev) => [...prev, game])
    setSearchTerm('')
    setSearchResults([])
    if (submitAttempted) setGamesError('')
    showToast('Added to list', 'success', 1800)
  }

  const handleRemoveGame = (gameId) => {
    setSelectedGames((prev) => prev.filter((g) => g.id !== gameId))
  }

  const handleDragStart = (e, gameId) => {
    dragGameIdRef.current = gameId
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e, gameId) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(gameId)
  }

  const handleDrop = (e, targetId) => {
    e.preventDefault()
    const sourceId = dragGameIdRef.current
    if (!sourceId || sourceId === targetId) {
      setDragOverId(null)
      return
    }
    setSelectedGames((prev) => {
      const arr = [...prev]
      const fromIdx = arr.findIndex((g) => g.id === sourceId)
      const toIdx = arr.findIndex((g) => g.id === targetId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const [moved] = arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, moved)
      return arr
    })
    setDragOverId(null)
    dragGameIdRef.current = null
  }

  const handleDragEnd = () => {
    setDragOverId(null)
    dragGameIdRef.current = null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitAttempted(true)

    const nameOk = listName.trim().length > 0
    const gamesOk = selectedGames.length > 0
    setGamesError(gamesOk ? '' : 'Add at least one game to the list.')

    if (!nameOk || !gamesOk) return

    setIsSubmitting(true)
    setSubmitError(null)
    try {
      await onCreate(listName.trim(), description.trim(), selectedGames)
      onClose()
    } catch (err) {
      console.error('[CreateListModal] onCreate failed:', err)
      setSubmitError('Failed to create list. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    if (hasAnyInput) {
      const ok = window.confirm('Discard this list? Your changes will not be saved.')
      if (!ok) return
    }
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div
        className="modal-content create-list-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="modal-header">
          <div className="modal-header__text">
            <span className="modal-eyebrow">List</span>
            <h2 className="modal-title">Create new list</h2>
          </div>
          <button
            type="button"
            className="modal-close-button"
            onClick={handleCancel}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <form
          id="create-list-form"
          onSubmit={handleSubmit}
          noValidate
          className="modal-body create-list-body"
        >
          <ListCoverPreview selectedGames={selectedGames} />

          <TextField
            label="List name"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            placeholder="e.g., Best JRPGs of the 2010s"
            maxLength={NAME_MAX}
            required
            autoFocus
          />

          <TextArea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What ties these games together?"
            maxLength={DESCRIPTION_MAX}
            hint="Optional"
          />

          {/* ── Add games section ── */}
          <div className={`create-list-games-block${gamesError ? ' has-error' : ''}`}>
            <div className="create-list-games-header">
              <p className="create-list-games-title">Add games</p>
              <p className="create-list-games-caption">Search and tap to add. Drag to reorder.</p>
            </div>

            <TextField
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search games..."
              autoComplete="off"
            />

            {isSearching && (
              <p className="create-list-search-status" aria-live="polite">Searching…</p>
            )}

            {searchError && <div className="search-error">{searchError}</div>}

            {searchResults.length > 0 && (
              <div className="search-results-container">
                <div className="search-results-list">
                  {searchResults.map((game) => {
                    const isSelected = !!selectedGames.find((g) => g.id === game.id)
                    return (
                      <div
                        key={game.id}
                        className={`search-result-item${isSelected ? ' selected' : ''}`}
                        onClick={() => !isSelected && handleAddGame(game)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (!isSelected && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault()
                            handleAddGame(game)
                          }
                        }}
                      >
                        {game.image ? (
                          <img
                            src={game.image}
                            alt={game.title}
                            className="result-game-image"
                          />
                        ) : (
                          <div className="result-game-image result-game-image--placeholder">
                            {game.title?.charAt(0) || '?'}
                          </div>
                        )}
                        <div className="result-game-info">
                          <div className="result-game-title">{game.title}</div>
                          <div className="result-game-meta">
                            {[game.year, game.developer].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        {isSelected ? (
                          <div className="result-game-added">✓</div>
                        ) : (
                          <button
                            type="button"
                            className="result-game-add-btn"
                            tabIndex={-1}
                            aria-hidden="true"
                          >
                            +
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {!isSearching &&
              searchTerm.trim() !== '' &&
              searchTerm.trim() === lastCompletedQuery &&
              searchResults.length === 0 &&
              !searchError && (
                <p className="form-hint no-results-hint">
                  No games found for &ldquo;{searchTerm}&rdquo;.
                </p>
              )}

            {gamesError && (
              <p className="field-error" role="alert">{gamesError}</p>
            )}

            {/* Selected games horizontal strip */}
            {selectedGames.length > 0 && (
              <div className="selected-games-section">
                <span className="selected-games-section__label">
                  Selected ({selectedGames.length})
                </span>
                <div className="selected-games-strip" ref={selectedStripRef}>
                  {selectedGames.map((game) => (
                    <div
                      key={game.id}
                      className={`selected-game-thumb${dragOverId === game.id ? ' drag-over' : ''}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, game.id)}
                      onDragOver={(e) => handleDragOver(e, game.id)}
                      onDrop={(e) => handleDrop(e, game.id)}
                      onDragEnd={handleDragEnd}
                    >
                      {game.image ? (
                        <img
                          src={game.image}
                          alt={game.title}
                          className="selected-game-thumb__img"
                          draggable={false}
                        />
                      ) : (
                        <div className="selected-game-thumb__img selected-game-thumb__img--placeholder">
                          {game.title?.charAt(0) || '?'}
                        </div>
                      )}
                      <button
                        type="button"
                        className="selected-game-thumb__remove"
                        onClick={() => handleRemoveGame(game.id)}
                        aria-label={`Remove ${game.title}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </form>

        {/* ── Sticky footer ── */}
        <div className="modal-footer">
          {submitError && (
            <p className="field-error" role="alert" style={{ marginBottom: '0.5rem' }}>
              {submitError}
            </p>
          )}
          <SubmitButton
            form="create-list-form"
            type="submit"
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? 'Creating…' : 'Create list'}
          </SubmitButton>
          <SecondaryButton onClick={handleCancel} disabled={isSubmitting}>Cancel</SecondaryButton>
        </div>
      </div>
    </div>
  )
}

export default CreateListModal

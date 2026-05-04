import React, { useState, useEffect, useRef } from 'react'
import { searchGames } from '../services/searchService'
import { isGameInList, getGamesFromList } from '../services/libraryService'
import {
  addGameToList as sbAddGameToList,
  getListById,
  isTrackerList,
} from '../services/listService'
import { TextField, SecondaryButton } from './forms'
import { showToast } from './Toast'
import './CreateListModal.css'
import './AddGamesModal.css'

const SEARCH_DEBOUNCE_MS = 300

/**
 * AddGamesModal
 *
 * For CUSTOM lists (Supabase UUIDs): each game tap immediately writes to
 * list_games via addGameToList. There is no batch-save on "Done".
 *
 * For TRACKER lists (currently-playing, etc.): games are collected in
 * addedGames state and flushed via the onAddGames callback when the user
 * taps "Done" (unchanged behaviour from before this migration).
 */
function AddGamesModal({
  isOpen,
  onClose,
  listId,
  listName,
  listDescription,
  onAddGames,
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [lastCompletedQuery, setLastCompletedQuery] = useState('')
  const [addedGames, setAddedGames] = useState([])
  const [existingGames, setExistingGames] = useState([])
  const [existingExpanded, setExistingExpanded] = useState(false)

  const debounceRef = useRef(null)
  const searchCallIdRef = useRef(0)

  const isCustom = listId ? !isTrackerList(listId) : false

  // Load existing games when opening.
  // Custom lists: fetch from Supabase; tracker lists: from localStorage.
  useEffect(() => {
    if (isOpen) {
      if (isCustom && listId) {
        getListById(listId).then((list) => {
          setExistingGames(list?.games || [])
        })
      } else {
        setExistingGames(getGamesFromList(listId) || [])
      }
    } else {
      setSearchTerm('')
      setSearchResults([])
      setIsSearching(false)
      setSearchError(null)
      setLastCompletedQuery('')
      setAddedGames([])
      setExistingExpanded(false)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [isOpen, listId, isCustom])

  // Search debounce
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
        // Filter out games already in the list (existing + just-added this session)
        const alreadyIn = new Set([
          ...existingGames.map((g) => String(g.id ?? g.igdb_game_id)),
          ...addedGames.map((g) => String(g.id)),
        ])
        const filtered = results.filter((g) => !alreadyIn.has(String(g.id)))
        setSearchResults(filtered)
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
  }, [searchTerm, listId, existingGames, addedGames])

  const handleAddGame = async (game) => {
    if (addedGames.find((g) => g.id === game.id)) return

    if (isCustom) {
      // Inline write: persist immediately to Supabase
      const position = existingGames.length + addedGames.length
      try {
        await sbAddGameToList(listId, game.id, position, {
          title: game.title,
          image: game.image,
        })
      } catch (err) {
        console.error('[AddGamesModal] addGameToList failed:', err)
        showToast('Failed to add game. Please try again.', 'error')
        return
      }
    }

    setAddedGames((prev) => [...prev, game])
    setSearchResults((prev) => prev.filter((g) => g.id !== game.id))
    showToast('Added to list', 'success', 1800)
  }

  const handleDone = () => {
    if (!isCustom && addedGames.length > 0 && onAddGames) {
      // Tracker lists: batch-flush to parent (libraryService)
      onAddGames(addedGames)
    }
    onClose()
  }

  if (!isOpen) return null

  const allExistingGames = [...existingGames, ...addedGames]

  return (
    <div className="modal-overlay" onClick={handleDone}>
      <div
        className="modal-content add-games-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="modal-header">
          <div className="modal-header__text">
            <span className="modal-eyebrow">Adding to</span>
            <h2 className="modal-title">{listName || 'List'}</h2>
            {listDescription && (
              <p className="modal-subtitle">{listDescription}</p>
            )}
          </div>
          <button
            type="button"
            className="modal-close-button"
            onClick={handleDone}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="modal-body add-games-body">
          <TextField
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search games to add..."
            autoFocus
            autoComplete="off"
          />

          {isSearching && (
            <p className="create-list-search-status" aria-live="polite">
              Searching…
            </p>
          )}

          {searchError && <div className="search-error">{searchError}</div>}

          {searchResults.length > 0 && (
            <div className="search-results-container">
              <div className="search-results-list">
                {searchResults.map((game) => {
                  const isAdded = !!addedGames.find((g) => g.id === game.id)
                  return (
                    <div
                      key={game.id}
                      className={`search-result-item${isAdded ? ' selected' : ''}`}
                      onClick={() => !isAdded && handleAddGame(game)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (!isAdded && (e.key === 'Enter' || e.key === ' ')) {
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
                      {isAdded ? (
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

          {/* Already in this list */}
          {allExistingGames.length > 0 && (
            <div className="already-in-list">
              <button
                type="button"
                className="already-in-list__toggle"
                onClick={() => setExistingExpanded((s) => !s)}
                aria-expanded={existingExpanded}
              >
                <span>Already in this list ({allExistingGames.length})</span>
                <span
                  className={`already-in-list__chevron${existingExpanded ? ' expanded' : ''}`}
                  aria-hidden="true"
                >
                  ›
                </span>
              </button>

              {existingExpanded && (
                <div className="already-in-list__strip">
                  {allExistingGames.map((game) => (
                    <div
                      key={game.id ?? game.igdb_game_id}
                      className="selected-game-thumb selected-game-thumb--readonly"
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="modal-footer">
          <SecondaryButton onClick={handleDone}>Done</SecondaryButton>
        </div>
      </div>
    </div>
  )
}

export default AddGamesModal

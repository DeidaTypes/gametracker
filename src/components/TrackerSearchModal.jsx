import React, { useState, useEffect, useRef } from 'react'
import { SearchX } from 'lucide-react'
import { searchGames } from '../services/searchService'
import {
  setGameStatus,
  getGameStatus,
} from '../services/libraryService'
import CenteredModal from './CenteredModal'
import { showToast } from './Toast'
import EmptyState from './EmptyState'
import './TrackerSearchModal.css'

const SEARCH_DEBOUNCE_MS = 300

/**
 * TrackerSearchModal — focused, centered search popup for adding a game to a
 * tracker (Currently Playing / Want to Play / Played).
 *
 * Replaces the old "navigate to Explore" behaviour: the user stays on the
 * current screen, types a game, taps a result, and it is added to the given
 * tracker with the correct status. The add is optimistic — setGameStatus
 * writes to the local library synchronously and dispatches `libraryUpdated`,
 * so the dashboard reflects it immediately — then the popup closes.
 *
 * Presentation reuses the shared CenteredModal shell (centered, keyboard-aware,
 * NOT a slide-up sheet). Content is intentionally minimal: a pinned search bar
 * on top and a scrollable results list below. Nothing else.
 *
 * Props:
 *   isOpen   boolean
 *   onClose  () => void
 *   status   'want' | 'currently' | 'played' — the tracker to add into
 */
const STATUS_LABELS = {
  want: 'Want to Play',
  currently: 'Currently Playing',
  played: 'Played',
  dropped: 'Dropped',
}

function TrackerSearchModal({ isOpen, onClose, status = 'currently' }) {
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [lastQuery, setLastQuery] = useState('')

  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const searchCallIdRef = useRef(0)

  const label = STATUS_LABELS[status] || 'Library'

  // Reset on close; autofocus on open (short delay lets the card animate in).
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('')
      setResults([])
      setIsSearching(false)
      setSearchError(null)
      setLastQuery('')
      if (debounceRef.current) clearTimeout(debounceRef.current)
      return
    }
    const t = setTimeout(() => inputRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [isOpen])

  // Debounced game search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = searchTerm.trim()
    if (!trimmed) {
      setResults([])
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
        const found = await searchGames(trimmed, 20)
        if (callId !== searchCallIdRef.current) return
        setResults(found)
        setLastQuery(trimmed)
      } catch (err) {
        if (callId !== searchCallIdRef.current) return
        console.error('[TrackerSearchModal] search failed:', err)
        setSearchError('Search failed. Please try again.')
        setResults([])
        setLastQuery(trimmed)
      } finally {
        if (callId === searchCallIdRef.current) setIsSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchTerm])

  // Optimistic add: setGameStatus writes to the local library and dispatches
  // `libraryUpdated` synchronously, so the dashboard updates before the popup
  // even finishes closing.
  const handleAdd = (game) => {
    const already = getGameStatus(game.id) === status
    if (already) {
      showToast(`Already in ${label}`, 'success', 1600)
      onClose?.()
      return
    }

    const ok = setGameStatus(game.id, status, game)
    if (ok) {
      showToast(`Added to ${label}`, 'success', 1800)
    } else {
      showToast('Couldn’t add game. Please try again.', 'error')
    }
    onClose?.()
  }

  const showNoResults =
    !isSearching &&
    searchTerm.trim() !== '' &&
    searchTerm.trim() === lastQuery &&
    results.length === 0 &&
    !searchError

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={`Add a game to ${label}`}
      maxWidth={400}
      className="tsm-card"
    >
      {/* ── Pinned search band ── */}
      <div className="tsm-search-pinned">
        <div className="tsm-search-row">
          <svg
            className="tsm-search-icon"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M10.5 10.5L14 14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="tsm-search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`Add to ${label}…`}
            aria-label={`Search games to add to ${label}`}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
          />
        </div>
      </div>

      {/* ── Scrollable results body ── */}
      <div className="tsm-body cm-scroll">
        {isSearching && (
          <p className="tsm-status" aria-live="polite">
            Searching…
          </p>
        )}

        {searchError && (
          <p className="tsm-status tsm-status--error" role="alert">
            {searchError}
          </p>
        )}

        {showNoResults && (
          <EmptyState icon={SearchX} size="inline" body={`No games found for "${searchTerm.trim()}".`} />
        )}

        {results.length > 0 && (
          <div className="tsm-results-list" role="list">
            {results.map((game) => {
              const inThisTracker = getGameStatus(game.id) === status
              return (
                <button
                  type="button"
                  key={game.id}
                  role="listitem"
                  className="tsm-game-row"
                  onClick={() => handleAdd(game)}
                  aria-label={`Add ${game.title} to ${label}`}
                >
                  {game.image ? (
                    <img src={game.image} alt="" className="tsm-game-cover" />
                  ) : (
                    <div className="tsm-game-cover tsm-game-cover--placeholder">
                      {game.title?.charAt(0) || '?'}
                    </div>
                  )}

                  <div className="tsm-game-info">
                    <span className="tsm-game-title">{game.title}</span>
                    <span className="tsm-game-meta">
                      {[game.year, game.developer].filter(Boolean).join(' · ')}
                    </span>
                  </div>

                  {inThisTracker ? (
                    <span className="tsm-check-badge" aria-label={`Already in ${label}`}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                        <path
                          d="M2 7l3.5 3.5L12 3"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  ) : (
                    <span className="tsm-add-btn" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path
                          d="M7 1v12M1 7h12"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </CenteredModal>
  )
}

export default TrackerSearchModal

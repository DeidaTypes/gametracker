import React, { useState, useEffect, useRef, useCallback } from 'react'
import { LuX, LuSearch } from 'react-icons/lu'
import { searchGames } from '../services/igdb'
import { getGamesFromList } from '../services/libraryService'
import CenteredModal from './CenteredModal'
import './GamePickerSheet.css'

/**
 * Game picker — centered popup (CenteredModal) for choosing a game.
 *
 * Props:
 *   isOpen    boolean — whether the dialog is open.
 *             Backwards-compat: when omitted, defaults to true so old
 *             callers that mount/unmount the component still work.
 *   onSelect  (game) => void — called when user taps a game
 *   onCancel  ()     => void — called when user dismisses
 */
function GamePickerSheet({ isOpen = true, onSelect, onCancel }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  const recentlyPlayed = getGamesFromList('played').slice(-6).reverse()

  useEffect(() => {
    if (!isOpen) return
    const id = setTimeout(() => inputRef.current?.focus(), 120)
    return () => clearTimeout(id)
  }, [isOpen])

  const handleQueryChange = useCallback((e) => {
    const val = e.target.value
    setQuery(val)

    clearTimeout(debounceRef.current)

    if (!val.trim()) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    debounceRef.current = setTimeout(async () => {
      try {
        const games = await searchGames(val.trim(), 20)
        setResults(games)
      } catch (err) {
        console.error('[GamePickerSheet] search failed:', err)
        setError('Search failed. Please try again.')
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [])

  const handleGameSelect = useCallback((game) => {
    onSelect(game)
  }, [onSelect])

  const showRecentlyPlayed = recentlyPlayed.length > 0 && !query.trim()

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onCancel}
      ariaLabel="Pick a game"
      maxWidth={480}
      className="gps-sheet"
    >
      {/* Header */}
      <div className="gps-header">
        <h2 className="gps-title">What did you play?</h2>

        {/* Search input */}
        <div className="gps-search-row">
          <LuSearch size={18} className="gps-search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            className="gps-search-input"
            placeholder="Search games…"
            value={query}
            onChange={handleQueryChange}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              className="gps-search-clear"
              onClick={() => {
                setQuery('')
                setResults([])
                inputRef.current?.focus()
              }}
              aria-label="Clear search"
            >
              <LuX size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Body — scrollable */}
      <div className="gps-body cm-scroll">
        {showRecentlyPlayed && (
          <section className="gps-section">
            <p className="gps-section-label">Recently played</p>
            <div className="gps-recent-row">
              {recentlyPlayed.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  className="gps-recent-cover-btn"
                  onClick={() => handleGameSelect(game)}
                  aria-label={game.title}
                  title={game.title}
                >
                  {game.image ? (
                    <img
                      src={game.image}
                      alt={game.title}
                      className="gps-recent-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="gps-recent-cover gps-recent-cover--placeholder">
                      <span>{game.title?.[0] ?? '?'}</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {query.trim() && (
          <section className="gps-section">
            {loading && (
              <div className="gps-state-row gps-state-row--loading" aria-live="polite">
                <span className="gps-spinner" aria-hidden="true" />
                Searching…
              </div>
            )}

            {!loading && error && (
              <p className="gps-state-row gps-state-row--error" aria-live="assertive">
                {error}
              </p>
            )}

            {!loading && !error && results.length === 0 && (
              <p className="gps-state-row gps-state-row--empty" aria-live="polite">
                No games found for &ldquo;{query}&rdquo;
              </p>
            )}

            {!loading && !error && results.length > 0 && (
              <ul className="gps-results" role="listbox" aria-label="Search results">
                {results.map((game) => (
                  <li key={game.id} role="option" aria-selected="false">
                    <button
                      type="button"
                      className="gps-result-row"
                      onClick={() => handleGameSelect(game)}
                    >
                      <div className="gps-result-cover-wrap">
                        {game.image ? (
                          <img
                            src={game.image}
                            alt={game.title}
                            className="gps-result-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="gps-result-cover gps-result-cover--placeholder">
                            {game.title?.[0] ?? '?'}
                          </div>
                        )}
                      </div>
                      <div className="gps-result-info">
                        <span className="gps-result-title">{game.title}</span>
                        <span className="gps-result-meta">
                          {[game.year, game.developer].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!query.trim() && !showRecentlyPlayed && (
          <p className="gps-state-row gps-state-row--empty">
            Search above to find a game
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="gps-footer">
        <button type="button" className="gps-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </CenteredModal>
  )
}

export default GamePickerSheet

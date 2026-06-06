import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { LuX, LuSearch } from 'react-icons/lu'
import { searchGames } from '../services/igdb'
import { getGamesFromList } from '../services/libraryService'
import { useMotionPreference } from '../hooks/useMotionPreference'
import './GamePickerSheet.css'

/**
 * Full-height game picker sheet.
 *
 * Animation: backdrop fades 0 → 1 over 150 ms; sheet slides up from
 * y: 100% to 0 on a spring (380 / 32). Driven by Framer Motion +
 * AnimatePresence so the sheet exits smoothly when isOpen flips
 * back to false.
 *
 * Props:
 *   isOpen    boolean — whether the sheet is open.
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
  const { reduced } = useMotionPreference()

  const recentlyPlayed = getGamesFromList('played').slice(-6).reverse()

  useEffect(() => {
    if (!isOpen) return
    const id = setTimeout(() => inputRef.current?.focus(), 80)
    return () => clearTimeout(id)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onCancel])

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

  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.15 }
  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="gps-overlay"
          onClick={onCancel}
          role="dialog"
          aria-modal="true"
          aria-label="Pick a game"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <motion.div
            className="gps-sheet"
            onClick={(e) => e.stopPropagation()}
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? { y: 0 } : { y: '100%' }}
            transition={sheetTransition}
          >
            {/* Header */}
            <div className="gps-header">
              <div className="gps-handle" aria-hidden="true" />
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
            <div className="gps-body">
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export default GamePickerSheet

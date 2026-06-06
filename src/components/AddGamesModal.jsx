import React, { useState, useEffect, useRef, useCallback } from 'react'
import { searchGames } from '../services/searchService'
import {
  getGamesFromList,
  addGameToList as localAddGameToList,
  removeGameFromList as localRemoveGameFromList,
} from '../services/libraryService'
import {
  addGameToList as sbAddGameToList,
  removeGameFromList as sbRemoveGameFromList,
  getListById,
  isTrackerList,
} from '../services/listService'
import { showToast } from './Toast'
import './CreateListModal.css'
import './AddGamesModal.css'

const SEARCH_DEBOUNCE_MS = 300
const COLLAPSE_THRESHOLD = 5

// ── Shared row component used for both search results and "In this list" ──
function GameRow({ game, mode, isInList, onAdd, onRemove }) {
  const handleRowClick = () => {
    if (mode === 'existing') return
    if (isInList) {
      onRemove(game)
    } else {
      onAdd(game)
    }
  }

  return (
    <div
      className={`agm-game-row${mode === 'existing' ? ' agm-game-row--existing' : ''}`}
      onClick={handleRowClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleRowClick()
        }
      }}
      aria-label={
        mode === 'existing'
          ? game.title
          : isInList
          ? `Remove ${game.title} from list`
          : `Add ${game.title} to list`
      }
    >
      {game.image ? (
        <img
          src={game.image}
          alt={game.title}
          className="agm-game-cover"
        />
      ) : (
        <div className="agm-game-cover agm-game-cover--placeholder">
          {game.title?.charAt(0) || '?'}
        </div>
      )}

      <div className="agm-game-info">
        <div className="agm-game-title">{game.title}</div>
        <div className="agm-game-meta">
          {[game.year, game.developer].filter(Boolean).join(' · ')}
        </div>
      </div>

      {mode === 'existing' ? (
        <button
          type="button"
          className="agm-remove-btn"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(game)
          }}
          aria-label={`Remove ${game.title} from list`}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2 4h12M5.333 4V2.667A1.333 1.333 0 016.667 1.333h2.666A1.333 1.333 0 0110.667 2.667V4m2 0v9.333A1.333 1.333 0 0111.333 14.667H4.667A1.333 1.333 0 013.333 13.333V4h9.334z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : isInList ? (
        <div className="agm-check-badge" aria-label="Already in list">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M2 7l3.5 3.5L12 3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ) : (
        <button
          type="button"
          className="agm-add-btn"
          tabIndex={-1}
          aria-hidden="true"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M7 1v12M1 7h12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}

/**
 * AddGamesModal
 *
 * For CUSTOM lists (Supabase UUIDs): each game tap immediately writes to
 * list_games via addGameToList. Removals also write immediately.
 *
 * For TRACKER lists: games are collected in addedGames state and flushed
 * via the onAddGames callback when the user taps "Done".
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
  const sheetRef = useRef(null)

  const isCustom = listId ? !isTrackerList(listId) : false

  // ── Keyboard-aware sizing ──────────────────────────────────────────────
  // Measure the visible viewport (the area ABOVE the keyboard) and feed it to
  // the sheet as CSS variables. `--agm-avail` caps the sheet height so the
  // pinned input + scrollable results always fit above the keyboard, and
  // `--agm-bottom` lifts the bottom-anchored sheet off the keyboard in the
  // (rare) case the WebView isn't natively resized. Works whether the
  // Capacitor Keyboard `resize` mode is `native` or not.
  const syncSheetMetrics = useCallback(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    const winH = typeof window !== 'undefined' ? window.innerHeight : 0
    const availH = vv ? vv.height : winH
    const bottomInset = vv
      ? Math.max(0, winH - vv.height - (vv.offsetTop || 0))
      : 0
    sheet.style.setProperty('--agm-avail', `${Math.round(availH)}px`)
    sheet.style.setProperty('--agm-bottom', `${Math.round(bottomInset)}px`)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    syncSheetMetrics()

    let kbShow
    let kbHide
    ;(async () => {
      try {
        const { Keyboard } = await import('@capacitor/keyboard')
        const settle = () => {
          // The visual viewport settles a beat after the event fires, so
          // sample a few times across the keyboard animation window.
          syncSheetMetrics()
          requestAnimationFrame(syncSheetMetrics)
          setTimeout(syncSheetMetrics, 80)
          setTimeout(syncSheetMetrics, 280)
        }
        kbShow = await Keyboard.addListener('keyboardWillShow', settle)
        kbHide = await Keyboard.addListener('keyboardWillHide', settle)
      } catch {
        /* no-op on web or when the plugin is unavailable */
      }
    })()

    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    vv?.addEventListener('resize', syncSheetMetrics)
    vv?.addEventListener('scroll', syncSheetMetrics)
    window.addEventListener('resize', syncSheetMetrics)

    return () => {
      kbShow?.remove?.()
      kbHide?.remove?.()
      vv?.removeEventListener('resize', syncSheetMetrics)
      vv?.removeEventListener('scroll', syncSheetMetrics)
      window.removeEventListener('resize', syncSheetMetrics)
    }
  }, [isOpen, syncSheetMetrics])

  // Load existing games on open; reset on close.
  useEffect(() => {
    if (isOpen) {
      const loadGames = async () => {
        let games = []
        if (isCustom && listId) {
          const list = await getListById(listId)
          games = list?.games || []
        } else {
          games = getGamesFromList(listId) || []
        }
        setExistingGames(games)
        // Auto-expand when the list is small enough to show in full
        setExistingExpanded(games.length <= COLLAPSE_THRESHOLD && games.length > 0)
      }
      loadGames()
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

  // Search debounce — results include in-list games (shown with checkmark)
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

  const isGameInList = (game) => {
    const id = String(game.id ?? game.igdb_game_id)
    return (
      existingGames.some((g) => String(g.id ?? g.igdb_game_id) === id) ||
      addedGames.some((g) => String(g.id) === id)
    )
  }

  // Optimistic ADD: the game appears in the list immediately, then we confirm
  // with the store. On failure we roll the optimistic state back and toast.
  const handleAddGame = async (game) => {
    if (isGameInList(game)) return

    const gameId = String(game.id ?? game.igdb_game_id)
    const position = existingGames.length + addedGames.length

    // 1) Optimistic UI — show it added right away.
    setAddedGames((prev) => [...prev, game])

    // 2) Persist, rolling back on any failure.
    try {
      if (isCustom) {
        await sbAddGameToList(listId, game.id, position, {
          title: game.title,
          image: game.image,
        })
      } else {
        const ok = localAddGameToList(listId, game)
        if (!ok) throw new Error('Local list write failed')
        window.dispatchEvent(new Event('libraryUpdated'))
      }
    } catch (err) {
      console.error('[AddGamesModal] add failed:', err)
      setAddedGames((prev) => prev.filter((g) => String(g.id) !== gameId))
      showToast('Couldn’t add game. Please try again.', 'error')
      return
    }

    showToast('Added to list', 'success', 1800)
  }

  // Optimistic REMOVE / toggle-off: reflect the removal instantly, then sync.
  // On failure, restore the previous state and toast.
  const handleRemoveGame = async (game) => {
    const gameId = String(game.id ?? game.igdb_game_id)
    const prevAdded = addedGames
    const prevExisting = existingGames

    // 1) Optimistic removal from whichever bucket holds it.
    setAddedGames((prev) => prev.filter((g) => String(g.id) !== gameId))
    setExistingGames((prev) =>
      prev.filter((g) => String(g.id ?? g.igdb_game_id) !== gameId)
    )

    // 2) Persist, rolling back on failure.
    try {
      if (isCustom) {
        await sbRemoveGameFromList(listId, game.id ?? game.igdb_game_id)
      } else {
        localRemoveGameFromList(listId, game.id ?? game.igdb_game_id)
        window.dispatchEvent(new Event('libraryUpdated'))
      }
    } catch (err) {
      console.error('[AddGamesModal] remove failed:', err)
      setAddedGames(prevAdded)
      setExistingGames(prevExisting)
      showToast('Couldn’t remove game. Please try again.', 'error')
    }
  }

  // Writes now persist on each tap (custom → Supabase, tracker → local store),
  // so "Done" just closes. `onAddGames` is still notified for any caller that
  // wants the session's added games, but persistence no longer depends on it.
  const handleDone = () => {
    if (addedGames.length > 0 && onAddGames) {
      onAddGames(addedGames)
    }
    onClose()
  }

  if (!isOpen) return null

  const allExistingGames = [...existingGames, ...addedGames]
  const hasMoreThanThreshold = allExistingGames.length > COLLAPSE_THRESHOLD
  const visibleExistingGames = existingExpanded
    ? allExistingGames
    : allExistingGames.slice(0, COLLAPSE_THRESHOLD)

  return (
    <div className="modal-overlay" onClick={handleDone}>
      <div
        ref={sheetRef}
        className="modal-content add-games-modal agm-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Grab handle ── */}
        <div className="agm-grab-handle" aria-hidden="true" />

        {/* ── Header row ── */}
        <div className="agm-header">
          <h2 className="agm-header-title">Add to {listName || 'List'}</h2>
          <button type="button" className="agm-done-link" onClick={handleDone}>
            Done
          </button>
        </div>

        {/* ── Pinned search input — stays fixed below the header, always
             visible above the keyboard, never scrolls away ── */}
        <div className="agm-search-pinned">
          <div className="agm-search-row">
            <svg
              className="agm-search-icon"
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
              type="text"
              className="agm-search-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search games…"
              autoComplete="off"
              autoFocus
            />
          </div>
        </div>

        {/* ── Scrollable results body — shrinks to the space above the
             keyboard; results scroll here without covering the input ── */}
        <div className="agm-body">
          {/* Status */}
          {isSearching && (
            <p className="agm-status" aria-live="polite">
              Searching…
            </p>
          )}
          {searchError && (
            <p className="agm-status agm-status--error" role="alert">
              {searchError}
            </p>
          )}

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="agm-results-list" role="list">
              {searchResults.map((game) => (
                <GameRow
                  key={game.id}
                  game={game}
                  mode="search"
                  isInList={isGameInList(game)}
                  onAdd={handleAddGame}
                  onRemove={handleRemoveGame}
                />
              ))}
            </div>
          )}

          {/* No results */}
          {!isSearching &&
            searchTerm.trim() !== '' &&
            searchTerm.trim() === lastCompletedQuery &&
            searchResults.length === 0 &&
            !searchError && (
              <p className="agm-status agm-status--hint">
                No games found for &ldquo;{searchTerm}&rdquo;.
              </p>
            )}

          {/* ── In this list section ── */}
          {allExistingGames.length > 0 && (
            <div className="agm-in-list">
              <div className="agm-in-list-header">
                <span className="agm-in-list-label">
                  In this list ({allExistingGames.length})
                </span>
                {hasMoreThanThreshold && (
                  <button
                    type="button"
                    className="agm-show-all-btn"
                    onClick={() => setExistingExpanded((s) => !s)}
                  >
                    {existingExpanded ? 'Show less' : 'Show all'}
                  </button>
                )}
              </div>
              <div className="agm-results-list" role="list">
                {visibleExistingGames.map((game) => (
                  <GameRow
                    key={game.id ?? game.igdb_game_id}
                    game={game}
                    mode="existing"
                    isInList={true}
                    onAdd={handleAddGame}
                    onRemove={handleRemoveGame}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AddGamesModal

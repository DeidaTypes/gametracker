import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Gamepad2, Search, SearchX, X } from 'lucide-react'
import { searchGames } from '../services/searchService'
import { getGamesFromList } from '../services/libraryService'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { contentSwap } from '../motion/xMotion'
import CenteredModal from './CenteredModal'
import EmptyState from './EmptyState'
import { statusLabelForListId } from './StatusChip'
import './GamePickerSheet.css'

/**
 * Game picker: the "What did you play?" box.
 *
 * A CenteredModal in the same language as every box you type in: Cancel on
 * the left, the title centered, a hairline under the bar, one field, grouped
 * content, no footer. The Q&A Ask form's game step builds on the same
 * Picker* pieces below, so both pickers look the same.
 *
 * Size is decided from the data, never from the keyboard:
 *   - nothing to show (no library, nothing typed): the card hugs its content
 *     and shows one centered empty state;
 *   - otherwise (a library, or the user has typed): the card is the steady
 *     full height and the list scrolls inside it. Typing swaps the list for
 *     results in place; the card does not resize.
 * The field never focuses itself: the keyboard comes up when it is tapped.
 *
 * Picking a game only calls onSelect. The caller closes this box and opens
 * the next one in the same commit, and CenteredModal's shared dim keeps
 * steady across the swap (the cards crossfade).
 *
 * Props:
 *   isOpen    boolean — whether the dialog is open.
 *             Backwards-compat: when omitted, defaults to true so old
 *             callers that mount/unmount the component still work.
 *   onSelect  (game) => void — called when user taps a game
 *   onCancel  ()     => void — called when user dismisses
 *   onExited  ()     => void — optional, after the fade-out completes
 */

const LIBRARY_LISTS = ['currently-playing', 'played', 'want-to-play', 'dropped']
const RECENT_LISTS = new Set(['currently-playing', 'played'])
const RECENT_MAX = 8

/** Every game the user has a status for, newest first. Real data only. */
function readLibrary() {
  const seen = new Set()
  const rows = []
  for (const listId of LIBRARY_LISTS) {
    for (const game of getGamesFromList(listId)) {
      if (!game?.title) continue
      const id = String(game.id)
      if (seen.has(id)) continue
      seen.add(id)
      rows.push({ game, listId })
    }
  }
  rows.sort((a, b) => String(b.game.addedAt || '').localeCompare(String(a.game.addedAt || '')))
  return rows
}

// ── Shared pieces (also used by the Q&A Ask form's game step) ──────────────

/** Cancel (left) · title (center) · an equal spacer on the right. */
export function PickerTopBar({ title, onCancel }) {
  return (
    <div className="gps-topbar">
      <button type="button" className="gps-topbar-cancel" onClick={onCancel}>
        Cancel
      </button>
      <h2 className="gps-topbar-title">{title}</h2>
      <span className="gps-topbar-spacer" aria-hidden="true" />
    </div>
  )
}

/** The 44 pt search field. Never focuses itself. */
export function PickerField({ value, onChange, onClear, inputRef }) {
  return (
    <div className="gps-search">
      <div className="gps-search-row">
        <Search size={18} className="gps-search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          className="gps-search-input"
          placeholder="Search games"
          aria-label="Search games"
          value={value}
          onChange={onChange}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
        />
        {value ? (
          <button
            type="button"
            className="gps-search-clear"
            onClick={onClear}
            aria-label="Clear search"
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function PickerLabel({ children }) {
  return <p className="gps-label">{children}</p>
}

/** Nothing to show yet. */
export function PickerEmpty() {
  return (
    <div className="gps-empty">
      <Gamepad2 size={28} strokeWidth={1.6} className="gps-empty-icon" aria-hidden="true" />
      <p className="gps-empty-title">Find the game first</p>
      <p className="gps-empty-body">
        Search by title. Your recent games will show here once you have logged a few.
      </p>
    </div>
  )
}

/** 44 x 60 cover, title 15/600, one muted meta line. */
export function PickerRow({ game, meta, onChoose }) {
  const cover = game.coverUrl || game.image
  return (
    <button type="button" className="gps-row" onClick={() => onChoose(game)}>
      {cover ? (
        <img src={cover} alt="" className="gps-row-cover" loading="lazy" decoding="async" />
      ) : (
        <span className="gps-row-cover gps-row-cover--placeholder" aria-hidden="true" />
      )}
      <span className="gps-row-info">
        <span className="gps-row-title">{game.title}</span>
        {meta ? <span className="gps-row-meta">{meta}</span> : null}
      </span>
    </button>
  )
}

/** Searching row, shared by both pickers. */
export function PickerSearching() {
  return (
    <div className="gps-state-row gps-state-row--loading" aria-live="polite">
      <span className="gps-spinner" aria-hidden="true" />
      Searching…
    </div>
  )
}

// ── The box ────────────────────────────────────────────────────────────────

function GamePickerSheet({ isOpen = true, onSelect, onCancel, onExited }) {
  const { reduced } = useMotionPreference()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // Set once the user has typed during this open, so the card keeps the size
  // it grew to instead of shrinking when the field is cleared.
  const [typed, setTyped] = useState(false)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  // The library is read when the box opens. It is kept as-is while the box
  // fades out, so nothing in it changes during the exit.
  const lastLibrary = useRef([])
  const library = useMemo(() => {
    if (isOpen) lastLibrary.current = readLibrary()
    return lastLibrary.current
  }, [isOpen])
  const recent = useMemo(
    () => library.filter((row) => RECENT_LISTS.has(row.listId)).slice(0, RECENT_MAX),
    [library],
  )

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const clearSearch = useCallback(() => {
    clearTimeout(debounceRef.current)
    setQuery('')
    setResults([])
    setLoading(false)
    setError(null)
  }, [])

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

    setTyped(true)
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

  const handleClear = useCallback(() => {
    clearSearch()
    inputRef.current?.focus()
  }, [clearSearch])

  // The box is back to its first-paint state for the next open, once it has
  // faded out. Resetting earlier would change what is on screen mid-exit.
  const handleExited = useCallback(() => {
    clearSearch()
    setTyped(false)
    onExited?.()
  }, [clearSearch, onExited])

  const trimmed = query.trim()
  const hasContent = library.length > 0 || typed

  // Which pane is showing. Previous results stay up while a new search is in
  // flight; the spinner is only for a search with nothing to show yet.
  let view = 'idle'
  if (trimmed) {
    if (results.length > 0) view = 'results'
    else if (loading) view = 'loading'
    else if (error) view = 'error'
    else view = 'empty'
  }

  let pane
  if (view === 'results') {
    pane = (
      <section>
        <PickerLabel>Results</PickerLabel>
        <div className="gps-list">
          {results.map((game) => (
            <PickerRow
              key={game.id}
              game={game}
              meta={[game.year, game.developer].filter(Boolean).join(' · ')}
              onChoose={onSelect}
            />
          ))}
        </div>
      </section>
    )
  } else if (view === 'loading') {
    pane = <PickerSearching />
  } else if (view === 'error') {
    pane = (
      <p className="gps-state-row gps-state-row--error" aria-live="assertive">
        {error}
      </p>
    )
  } else if (view === 'empty') {
    pane = (
      <div aria-live="polite">
        <EmptyState icon={SearchX} size="inline" body={`No games found for "${trimmed}"`} />
      </div>
    )
  } else if (library.length === 0) {
    pane = <PickerEmpty />
  } else {
    pane = (
      <>
        {recent.length > 0 && (
          <section>
            <PickerLabel>Recently played</PickerLabel>
            <div className="gps-recent">
              {recent.map(({ game }) => (
                <button
                  key={game.id}
                  type="button"
                  className="gps-recent-item"
                  onClick={() => onSelect(game)}
                  aria-label={game.title}
                >
                  {game.image ? (
                    <img
                      src={game.image}
                      alt=""
                      className="gps-recent-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className="gps-recent-cover gps-recent-cover--placeholder" aria-hidden="true" />
                  )}
                  <span className="gps-recent-title">{game.title}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        <section>
          <PickerLabel>Your library</PickerLabel>
          <div className="gps-list">
            {library.map(({ game, listId }) => (
              <PickerRow
                key={game.id}
                game={game}
                meta={[game.year, statusLabelForListId(listId)].filter(Boolean).join(' · ')}
                onChoose={onSelect}
              />
            ))}
          </div>
        </section>
      </>
    )
  }

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onCancel}
      onExited={handleExited}
      ariaLabel="What did you play?"
      maxWidth={360}
      steady={hasContent ? 'fill' : true}
      className="gps-sheet"
    >
      <PickerTopBar title="What did you play?" onCancel={onCancel} />
      <PickerField
        value={query}
        onChange={handleQueryChange}
        onClear={handleClear}
        inputRef={inputRef}
      />

      <div className="gps-body cm-scroll">
        {/* Panes share one grid cell and crossfade in place, so the body never
            changes size while content arrives. */}
        <div className="gps-stack">
          <AnimatePresence initial={false}>
            <motion.div key={view} className="gps-pane" {...contentSwap(reduced)}>
              {pane}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </CenteredModal>
  )
}

export default GamePickerSheet

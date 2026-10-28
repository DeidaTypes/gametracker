import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react'
import { Reorder } from 'motion/react'
import { LuX, LuSearch, LuCheck, LuPencil } from 'react-icons/lu'
import { SearchX } from 'lucide-react'
import { searchGames } from '../services/searchService'
import { getGamesFromList } from '../services/libraryService'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { showToast } from './Toast'
import CenteredModal from './CenteredModal'
import EmptyState from './EmptyState'
import './FavoritesPickerSheet.css'

const MAX_FAVORITES = 4

/**
 * Centered popup (CenteredModal) for editing Favorite Games or Current
 * Obsessions on the Profile.
 *
 * Layout (top → bottom):
 *   Header row: title + Done button
 *   Current selection strip — horizontal, drag-to-reorder via Framer
 *     Motion Reorder.Group. Each card has an X remove button.
 *   Why-editor — on-demand per-cover disclosure for an optional one-line note.
 *     Pencil badge on each cover; one compact input expands beneath the strip.
 *     Only in favorites mode (showWhy=true).
 *   Search input (IGDB search, identical pattern to GamePickerSheet)
 *   Scrollable body: 2-column cover grid of results (or library games
 *     when no query is typed).
 *
 * Behaviour:
 *   - Tapping a result toggles it. Already selected → removes.
 *   - If at cap and tapping a new game → shake animation + toast.
 *   - Done saves the current order (with why notes if showWhy) and closes.
 *   - Reorder.Group persists the dragged order in state; Done flushes it.
 *
 * @param {{
 *   isOpen: boolean,
 *   initialFavorites: Array<{id, title, image, developer, why?}>,
 *   onSave: (favorites) => void,
 *   onClose: () => void,
 *   label?: string,
 *   maxItems?: number,
 *   showWhy?: boolean,
 * }} props
 */
function FavoritesPickerSheet({
  isOpen,
  initialFavorites = [],
  onSave,
  onClose,
  label = 'Favorite Games',
  maxItems = MAX_FAVORITES,
  showWhy = false,
}) {
  const [favorites, setFavorites] = useState([])
  // Map<stringId, whyText> — persists why notes across reorders
  const [whyMap, setWhyMap] = useState({})
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // ID of the grid cell currently shaking (cap-exceeded feedback)
  const [shakingId, setShakingId] = useState(null)
  // Which favorite's why-input is expanded (string id), or null
  const [expandedWhyId, setExpandedWhyId] = useState(null)
  const [whyDraft, setWhyDraft] = useState('')

  const inputRef = useRef(null)
  const whyInputRef = useRef(null)
  const whyEditorRef = useRef(null)
  const debounceRef = useRef(null)
  const { reduced } = useMotionPreference()

  const commitWhyDraft = useCallback((id, draft) => {
    const trimmed = draft.trim()
    setWhyMap((prev) => {
      const next = { ...prev }
      if (trimmed) next[id] = trimmed
      else delete next[id]
      return next
    })
  }, [])

  const collapseWhyEditor = useCallback(() => {
    if (!expandedWhyId) return
    commitWhyDraft(expandedWhyId, whyDraft)
    setExpandedWhyId(null)
    setWhyDraft('')
  }, [expandedWhyId, whyDraft, commitWhyDraft])

  const toggleWhyEditor = useCallback(
    (id) => {
      const key = String(id)
      if (expandedWhyId === key) {
        collapseWhyEditor()
        return
      }
      if (expandedWhyId) {
        commitWhyDraft(expandedWhyId, whyDraft)
      }
      setExpandedWhyId(key)
      setWhyDraft(whyMap[key] || '')
    },
    [expandedWhyId, whyDraft, whyMap, collapseWhyEditor, commitWhyDraft]
  )

  // Reset internal state when the picker opens
  useEffect(() => {
    if (isOpen) {
      setFavorites(initialFavorites.slice())
      // Seed whyMap from existing why values
      const seed = {}
      for (const g of initialFavorites) {
        if (g.why) seed[String(g.id)] = g.why
      }
      setWhyMap(seed)
      setQuery('')
      setResults([])
      setError(null)
      setShakingId(null)
      setExpandedWhyId(null)
      setWhyDraft('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Focus the why-input when a disclosure opens
  useEffect(() => {
    if (!expandedWhyId) return undefined
    const id = setTimeout(() => whyInputRef.current?.focus(), 80)
    return () => clearTimeout(id)
  }, [expandedWhyId])

  // Collapse why-editor when tapping elsewhere
  useEffect(() => {
    if (!expandedWhyId) return undefined
    function handleOutside(e) {
      if (whyEditorRef.current?.contains(e.target)) return
      collapseWhyEditor()
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [expandedWhyId, collapseWhyEditor])

  // Auto-focus search when the picker opens
  useEffect(() => {
    if (!isOpen) return undefined
    const id = setTimeout(() => inputRef.current?.focus(), 120)
    return () => clearTimeout(id)
  }, [isOpen])

  // Library games — shown as suggestions when the search input is empty.
  // Computed once per open event to avoid reshuffling while the user types.
  const libraryGames = useMemo(() => {
    if (!isOpen) return []
    const all = [
      ...getGamesFromList('currently-playing'),
      ...getGamesFromList('played'),
      ...getGamesFromList('want-to-play'),
      ...getGamesFromList('dropped'),
    ]
    const seen = new Set()
    const unique = []
    for (const g of all) {
      const key = String(g.id)
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(g)
    }
    return unique
  }, [isOpen])

  const isPicked = useCallback(
    (id) => favorites.some((f) => String(f.id) === String(id)),
    [favorites]
  )

  const removeFromFavorites = useCallback((id) => {
    const key = String(id)
    setFavorites((prev) => prev.filter((f) => String(f.id) !== key))
    setWhyMap((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    if (expandedWhyId === key) {
      setExpandedWhyId(null)
      setWhyDraft('')
    }
  }, [expandedWhyId])

  const toggleGame = useCallback(
    (game) => {
      if (isPicked(game.id)) {
        removeFromFavorites(game.id)
        return
      }
      if (favorites.length >= maxItems) {
        const key = String(game.id)
        setShakingId(key)
        setTimeout(() => setShakingId(null), 600)
        showToast(`${label} full`, 'error', 2500, null, null, { sub: 'Remove one first' })
        return
      }
      setFavorites((prev) => [
        ...prev,
        {
          id: game.id,
          title: game.title || '',
          image: game.image || null,
          developer:
            (Array.isArray(game.developers) && game.developers[0]) ||
            game.developer ||
            '',
        },
      ])
    },
    [favorites, maxItems, label, isPicked, removeFromFavorites]
  )

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
        console.error('[FavoritesPickerSheet] search failed:', err)
        setError('Search failed. Please try again.')
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [])

  const handleDone = useCallback(() => {
    const finalWhyMap = { ...whyMap }
    if (expandedWhyId) {
      const trimmed = whyDraft.trim()
      if (trimmed) finalWhyMap[expandedWhyId] = trimmed
      else delete finalWhyMap[expandedWhyId]
    }
    const withWhy = favorites.map((g) => ({
      ...g,
      why: (finalWhyMap[String(g.id)] || '').trim() || undefined,
    }))
    onSave(withWhy)
    onClose()
  }, [favorites, whyMap, expandedWhyId, whyDraft, onSave, onClose])

  // Grid source: IGDB results when searching, library otherwise
  const displayGames = query.trim() ? results : libraryGames

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Edit favorite games"
      maxWidth={480}
      className="fps-sheet kb-modal-fill"
    >
      {/* Header: title + Done */}
      <div className="fps-header">
        <h2 className="fps-title">{label}</h2>
        <button
          type="button"
          className="fps-done-btn"
          onClick={handleDone}
        >
          Done
        </button>
      </div>

      {/* Current selection — horizontal drag-to-reorder strip */}
      <div
        className="fps-favorites-section"
        ref={showWhy ? whyEditorRef : undefined}
      >
        <p className="fps-favorites-label">
          {favorites.length} / {maxItems} selected
          {favorites.length > 0 && (
            <span className="fps-favorites-label__hint">
              {' '}· drag to reorder
              {showWhy && ' · tap pencil to add why'}
            </span>
          )}
        </p>
        {favorites.length > 0 ? (
          <>
            <Reorder.Group
              as="div"
              axis="x"
              values={favorites}
              onReorder={setFavorites}
              className="fps-favorites-strip"
            >
              {favorites.map((fav) => {
                const favKey = String(fav.id)
                const hasWhy = Boolean((whyMap[favKey] || '').trim())
                const isWhyOpen = expandedWhyId === favKey
                return (
                  <Reorder.Item
                    key={fav.id}
                    value={fav}
                    className="fps-fav-item"
                    whileDrag={reduced ? {} : { scale: 1.08, zIndex: 10 }}
                  >
                    <div className="fps-fav-cover">
                      {fav.image ? (
                        <img
                          src={fav.image}
                          alt={fav.title}
                          loading="lazy"
                        />
                      ) : (
                        <span className="fps-fav-cover__fallback">
                          {fav.title?.charAt(0) || '?'}
                        </span>
                      )}
                      <button
                        type="button"
                        className="fps-fav-remove"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeFromFavorites(fav.id)
                        }}
                        aria-label={`Remove ${fav.title} from favorites`}
                      >
                        <LuX size={10} strokeWidth={3} />
                      </button>
                      {showWhy && (
                        <button
                          type="button"
                          className={`fps-why-badge${hasWhy ? ' fps-why-badge--filled' : ''}${isWhyOpen ? ' fps-why-badge--open' : ''}`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleWhyEditor(fav.id)
                          }}
                          aria-label={
                            hasWhy
                              ? `Edit why ${fav.title} is a favorite`
                              : `Add why ${fav.title} is a favorite`
                          }
                          aria-expanded={isWhyOpen}
                        >
                          <LuPencil size={10} strokeWidth={2.5} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <span className="fps-fav-name" aria-hidden="true">
                      {fav.title}
                    </span>
                  </Reorder.Item>
                )
              })}
            </Reorder.Group>

            {showWhy && (
              <div
                className={`fps-why-disclosure${expandedWhyId ? ' fps-why-disclosure--open' : ''}`}
                aria-hidden={!expandedWhyId}
              >
                {expandedWhyId && (
                  <div className="fps-why-disclosure__inner">
                    <label
                      className="fps-why-disclosure__label"
                      htmlFor="fps-why-input"
                    >
                      Why this?
                      <span className="fps-why-disclosure__hint"> (optional)</span>
                    </label>
                    <input
                      ref={whyInputRef}
                      id="fps-why-input"
                      type="text"
                      className="fps-why-input"
                      placeholder="One line about why…"
                      maxLength={120}
                      value={whyDraft}
                      onChange={(e) => setWhyDraft(e.target.value)}
                      aria-label={`Why ${favorites.find((f) => String(f.id) === expandedWhyId)?.title || 'this game'} is a favorite`}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="fps-favorites-empty">
            Tap a game below to add it
          </p>
        )}
      </div>

      {/* Search input */}
      <div className="fps-search-wrap">
        <div className="fps-search-row">
          <LuSearch
            size={18}
            className="fps-search-icon"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            className="fps-search-input"
            placeholder="Search all games…"
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
              className="fps-search-clear"
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

      {/* Scrollable body — 2-column cover grid */}
      <div className="fps-body cm-scroll">
        {/* Loading */}
        {query.trim() && loading && (
          <div
            className="fps-state-row fps-state-row--loading"
            aria-live="polite"
          >
            <span className="fps-spinner" aria-hidden="true" />
            Searching…
          </div>
        )}

        {/* Error */}
        {query.trim() && !loading && error && (
          <p
            className="fps-state-row fps-state-row--error"
            aria-live="assertive"
          >
            {error}
          </p>
        )}

        {/* No results */}
        {query.trim() && !loading && !error && results.length === 0 && (
          <div aria-live="polite">
            <EmptyState icon={SearchX} size="inline" body={`No games found for "${query}"`} />
          </div>
        )}

        {/* Section label when showing library */}
        {!query.trim() && libraryGames.length > 0 && (
          <p className="fps-section-label">Your library</p>
        )}

        {/* Empty library state */}
        {!query.trim() && libraryGames.length === 0 && (
          <EmptyState size="inline" body="Add games to your library and they'll appear here." />
        )}

        {/* 2-column cover grid */}
        {displayGames.length > 0 && (!query.trim() || (!loading && !error)) && (
          <ul
            className="fps-grid"
            role="listbox"
            aria-multiselectable="true"
            aria-label="Game results"
          >
            {displayGames.map((game) => {
              const picked = isPicked(game.id)
              const shaking = shakingId === String(game.id)
              return (
                <li
                  key={game.id}
                  className={`fps-grid-cell${shaking ? ' fps-grid-cell--shake' : ''}`}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={picked}
                    className={`fps-grid-tile${picked ? ' fps-grid-tile--picked' : ''}`}
                    onClick={() => toggleGame(game)}
                  >
                    <div className="fps-grid-cover">
                      {game.image ? (
                        <img
                          src={game.image}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <span className="fps-grid-cover__fallback">
                          {game.title?.charAt(0) || '?'}
                        </span>
                      )}
                      {picked && (
                        <span
                          className="fps-grid-check"
                          aria-hidden="true"
                        >
                          <LuCheck size={14} strokeWidth={2.5} />
                        </span>
                      )}
                    </div>
                    <span className="fps-grid-title">
                      {game.title}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </CenteredModal>
  )
}

export default FavoritesPickerSheet

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import {
  SlidersHorizontal,
  CheckSquare,
  Square,
  X,
  Plus,
  Star,
  Clock,
  Calendar,
  ArrowUpDown,
  ChevronDown,
  MoveRight,
  Trash2,
} from 'lucide-react'
import { supabase } from '../services/supabase'
import {
  getGameProgress,
  setGameStatus,
  clearGameStatus,
} from '../services/libraryService'
import { getCachedUserReviews } from '../services/reviewService'
import { logManualSession } from '../services/sessionService'
import ActionSheet from './ActionSheet'
import { showToast } from './Toast'
import { useMotionPreference } from '../hooks/useMotionPreference'
import './TrackerGameList.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const TRACKER_LABELS = {
  'currently-playing': 'Currently Playing',
  played: 'Played',
  'want-to-play': 'Want to Play',
  dropped: 'Dropped',
}

const SORT_OPTIONS = [
  { id: 'recency', label: 'Recently Played' },
  { id: 'added', label: 'Date Added' },
  { id: 'progress', label: 'Progress' },
  { id: 'hours', label: 'Hours Logged' },
  { id: 'rating', label: 'Rating' },
]

const FILTER_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'not-started', label: 'Not Started' },
  { id: 'almost-done', label: 'Almost Done (70%+)' },
]

const MOVE_TARGETS = [
  { id: 'currently', label: 'Currently Playing' },
  { id: 'played', label: 'Played' },
  { id: 'want', label: 'Want to Play' },
  { id: 'dropped', label: 'Drop' },
]

const QUICK_LOG_OPTIONS = [15, 30, 60, 120]

// ─── Utility helpers ──────────────────────────────────────────────────────────

function formatLastPlayed(iso) {
  if (!iso) return null
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffMs = now - then
  const diffDays = Math.floor(diffMs / 86400000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 2) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  if (diffDays < 365) return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function fmtHours(h) {
  if (h == null || h === 0) return null
  if (h < 1) return `${Math.round(h * 60)}m`
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`
}

function fmtRating(r) {
  if (r == null) return null
  return Number(r).toFixed(1)
}

// ─── LogSessionSheet ──────────────────────────────────────────────────────────
// A bespoke bottom sheet with quick-log presets + optional custom input.

function LogSessionSheet({ game, isOpen, onClose, onLogged }) {
  const { reduced } = useMotionPreference()
  const [customMin, setCustomMin] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!isOpen) {
      setCustomMin('')
      setShowCustom(false)
      setSaving(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (showCustom && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [showCustom])

  const handleQuickLog = async (minutes) => {
    if (!game || saving) return
    setSaving(true)
    const today = new Date().toISOString().slice(0, 10)
    const result = await logManualSession(game.id, minutes, today, {
      gameTitle: game.title,
      gameImage: game.image,
    })
    setSaving(false)
    onClose()
    if (result) {
      onLogged(game.id, result)
      const hrs = fmtHours(result.addedHours)
      showToast(`Logged ${hrs || `${minutes}m`} for "${game.title}"`, 'success')
    } else {
      showToast('Could not log session — are you signed in?', 'error')
    }
  }

  const handleCustomSubmit = () => {
    const mins = Math.round(Number(customMin))
    if (!mins || mins <= 0) {
      showToast('Enter a valid number of minutes', 'error')
      return
    }
    handleQuickLog(mins)
  }

  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }
  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.15 }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="tgl-sheet-overlay"
          onClick={onClose}
          aria-modal="true"
          role="dialog"
          aria-label={`Log session for ${game?.title || 'game'}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <motion.div
            className="tgl-sheet"
            onClick={(e) => e.stopPropagation()}
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? { y: 0 } : { y: '100%' }}
            transition={sheetTransition}
          >
            <div className="tgl-sheet-handle" aria-hidden="true" />
            <div className="tgl-sheet-header">
              <p className="tgl-sheet-title">Log session</p>
              {game && (
                <p className="tgl-sheet-game">{game.title}</p>
              )}
            </div>

            {!showCustom ? (
              <div className="tgl-sheet-presets">
                {QUICK_LOG_OPTIONS.map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    className="tgl-sheet-preset"
                    onClick={() => handleQuickLog(mins)}
                    disabled={saving}
                  >
                    {mins < 60 ? `${mins} min` : `${mins / 60} hr`}
                  </button>
                ))}
                <button
                  type="button"
                  className="tgl-sheet-preset tgl-sheet-preset--custom"
                  onClick={() => setShowCustom(true)}
                  disabled={saving}
                >
                  Custom…
                </button>
              </div>
            ) : (
              <div className="tgl-sheet-custom">
                <div className="tgl-sheet-custom-input-row">
                  <input
                    ref={inputRef}
                    type="number"
                    inputMode="numeric"
                    className="tgl-sheet-custom-input"
                    placeholder="Minutes"
                    value={customMin}
                    onChange={(e) => setCustomMin(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCustomSubmit()}
                    min="1"
                    max="9999"
                    aria-label="Custom minutes"
                  />
                  <span className="tgl-sheet-custom-unit">min</span>
                </div>
                <div className="tgl-sheet-custom-actions">
                  <button
                    type="button"
                    className="tgl-sheet-cancel-btn"
                    onClick={() => setShowCustom(false)}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="tgl-sheet-confirm-btn"
                    onClick={handleCustomSubmit}
                    disabled={saving || !customMin}
                  >
                    {saving ? 'Saving…' : 'Log it'}
                  </button>
                </div>
              </div>
            )}

            <div className="tgl-sheet-divider" />
            <button
              type="button"
              className="tgl-sheet-cancel-full"
              onClick={onClose}
            >
              Cancel
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

// ─── BulkActionBar ────────────────────────────────────────────────────────────

function BulkActionBar({ count, listId, onMove, onRate, onRemove, onClear }) {
  const { reduced } = useMotionPreference()
  const showRate = listId === 'played'

  return createPortal(
    <motion.div
      className="tgl-bulk-bar"
      initial={reduced ? false : { y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={reduced ? {} : { y: 80, opacity: 0 }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 360, damping: 30 }}
    >
      <span className="tgl-bulk-bar-count">{count} selected</span>
      <div className="tgl-bulk-bar-actions">
        <button type="button" className="tgl-bulk-btn" onClick={onMove}>
          <MoveRight size={16} />
          Move
        </button>
        {showRate && (
          <button type="button" className="tgl-bulk-btn" onClick={onRate}>
            <Star size={16} />
            Rate
          </button>
        )}
        <button
          type="button"
          className="tgl-bulk-btn tgl-bulk-btn--destructive"
          onClick={onRemove}
        >
          <Trash2 size={16} />
          Remove
        </button>
      </div>
      <button
        type="button"
        className="tgl-bulk-bar-close"
        onClick={onClear}
        aria-label="Exit select mode"
      >
        <X size={18} />
      </button>
    </motion.div>,
    document.body
  )
}

// ─── TrackerGameRow ───────────────────────────────────────────────────────────

function TrackerGameRow({
  game,
  enrich,
  listId,
  selectMode,
  isSelected,
  onToggleSelect,
  onLogSession,
  navigate,
}) {
  const progress = enrich?.progress_override ?? enrich?.progressPercent ?? null
  const hours = enrich?.hours_played != null
    ? Number(enrich.hours_played)
    : (enrich?.hoursPlayed != null ? Number(enrich.hoursPlayed) : null)
  const lastPlayed = enrich?.lastPlayedAt
    ? formatLastPlayed(enrich.lastPlayedAt)
    : (enrich?.updated_at ? formatLastPlayed(enrich.updated_at) : null)
  const rating = enrich?.rating ? fmtRating(enrich.rating) : null
  const showProgress = listId === 'currently-playing'
  const hoursLabel = fmtHours(hours)

  const handleRowClick = () => {
    if (selectMode) {
      onToggleSelect(game.id)
      return
    }
    navigate(`/game/${game.id}`)
  }

  const handleLogClick = (e) => {
    e.stopPropagation()
    onLogSession(game)
  }

  return (
    <div
      className={`tgl-row${isSelected ? ' tgl-row--selected' : ''}${selectMode ? ' tgl-row--selectable' : ''}`}
      onClick={handleRowClick}
      role={selectMode ? 'checkbox' : 'button'}
      aria-checked={selectMode ? isSelected : undefined}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleRowClick()
        }
      }}
      aria-label={game.title}
    >
      {/* Select checkbox */}
      {selectMode && (
        <div className="tgl-row-checkbox" aria-hidden="true">
          {isSelected
            ? <CheckSquare size={20} className="tgl-check-icon tgl-check-icon--on" />
            : <Square size={20} className="tgl-check-icon" />
          }
        </div>
      )}

      {/* Cover */}
      <div className="tgl-row-cover">
        {game.image ? (
          <img
            src={game.image}
            alt=""
            className="tgl-row-cover-img"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="tgl-row-cover-fallback">
            {game.title?.charAt(0) || '?'}
          </div>
        )}
        {/* Progress bar overlay along cover bottom */}
        {showProgress && progress !== null && (
          <div className="tgl-row-cover-progress" aria-hidden="true">
            <div
              className="tgl-row-cover-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="tgl-row-info">
        <p className="tgl-row-title">{game.title || '—'}</p>

        <div className="tgl-row-meta">
          {lastPlayed && (
            <span className="tgl-row-meta-chip tgl-row-meta-chip--muted">
              <Calendar size={10} aria-hidden="true" />
              {lastPlayed}
            </span>
          )}
          {hoursLabel && (
            <span className="tgl-row-meta-chip">
              <Clock size={10} aria-hidden="true" />
              {hoursLabel}
            </span>
          )}
          {rating && (
            <span className="tgl-row-meta-chip tgl-row-meta-chip--rating">
              <Star size={10} aria-hidden="true" />
              {rating}
            </span>
          )}
          {showProgress && progress !== null && (
            <span className="tgl-row-meta-chip tgl-row-meta-chip--progress">
              {progress}%
            </span>
          )}
        </div>

        {/* Full-width progress bar for currently-playing */}
        {showProgress && progress !== null && (
          <div className="tgl-row-progress" aria-hidden="true">
            <div
              className="tgl-row-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Log session CTA — only for currently-playing & played */}
      {!selectMode && (listId === 'currently-playing' || listId === 'played') && (
        <button
          type="button"
          className="tgl-row-log-btn"
          onClick={handleLogClick}
          aria-label={`Log session for ${game.title}`}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

function TrackerGameList({ listId, games }) {
  const navigate = useNavigate()
  const { reduced } = useMotionPreference()

  // ── Enrichment data loaded from Supabase ────────────────────────────────────
  // Shape: { [gameId]: { hours_played, progress_override, updated_at, lastPlayedAt, progressPercent, rating } }
  const [enrichMap, setEnrichMap] = useState({})
  const [enrichLoading, setEnrichLoading] = useState(false)

  // ── UI state ────────────────────────────────────────────────────────────────
  const [sortBy, setSortBy] = useState('recency')
  const [filterBy, setFilterBy] = useState('all')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())

  // Sheet states
  const [logTarget, setLogTarget] = useState(null)
  const [logSheetOpen, setLogSheetOpen] = useState(false)
  const [sortSheetOpen, setSortSheetOpen] = useState(false)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [bulkMoveSheetOpen, setBulkMoveSheetOpen] = useState(false)
  const [bulkRateSheetOpen, setBulkRateSheetOpen] = useState(false)

  // ── Load enrichment data ────────────────────────────────────────────────────

  const loadEnrichment = useCallback(async () => {
    if (!games.length) {
      setEnrichMap({})
      return
    }
    setEnrichLoading(true)

    const gameIds = games.map((g) => String(g.id))

    // localStorage progress (instant, sync)
    const localProgress = {}
    for (const id of gameIds) {
      localProgress[id] = getGameProgress(id)
    }

    // Cached ratings (in-memory, sync)
    const cachedReviews = getCachedUserReviews()
    const ratingMap = {}
    for (const r of cachedReviews) {
      if (r.igdb_game_id != null) {
        ratingMap[String(r.igdb_game_id)] = r.rating
      }
    }

    // Supabase tracker rows (async)
    let trackerRows = {}
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data, error } = await supabase
          .from('game_trackers')
          .select('igdb_game_id, hours_played, progress_override, updated_at')
          .eq('user_id', user.id)
          .in('igdb_game_id', gameIds)

        if (!error && data) {
          for (const row of data) {
            trackerRows[String(row.igdb_game_id)] = row
          }
        }
      }
    } catch (err) {
      console.error('[TrackerGameList] enrichment failed:', err)
    }

    // Merge: Supabase wins for hours/progress; localStorage wins for lastPlayedAt
    const merged = {}
    for (const id of gameIds) {
      const local = localProgress[id] || {}
      const remote = trackerRows[id] || {}
      merged[id] = {
        hours_played: remote.hours_played != null ? Number(remote.hours_played) : (Number(local.hoursPlayed) || 0),
        progress_override: remote.progress_override != null ? Number(remote.progress_override) : (local.progressPercent ?? null),
        updated_at: remote.updated_at || null,
        lastPlayedAt: local.lastPlayedAt || null,
        progressPercent: local.progressPercent ?? null,
        rating: ratingMap[id] ?? null,
      }
    }

    setEnrichMap(merged)
    setEnrichLoading(false)
  }, [games])

  useEffect(() => {
    loadEnrichment()
  }, [loadEnrichment])

  // Re-load when sessions or reviews are updated externally
  useEffect(() => {
    const handler = () => loadEnrichment()
    window.addEventListener('libraryUpdated', handler)
    window.addEventListener('reviewAdded', handler)
    return () => {
      window.removeEventListener('libraryUpdated', handler)
      window.removeEventListener('reviewAdded', handler)
    }
  }, [loadEnrichment])

  // ── Sort & filter ───────────────────────────────────────────────────────────

  const enrichedGames = useMemo(() => {
    return games.map((g) => ({
      ...g,
      _enrich: enrichMap[String(g.id)] || null,
    }))
  }, [games, enrichMap])

  const filteredGames = useMemo(() => {
    return enrichedGames.filter((g) => {
      if (filterBy === 'all') return true
      const e = g._enrich
      const progress = e?.progress_override ?? e?.progressPercent ?? null
      const hours = e?.hours_played ?? 0
      if (filterBy === 'not-started') return hours === 0 && progress === null
      if (filterBy === 'in-progress') return hours > 0 && (progress === null || progress < 100)
      if (filterBy === 'almost-done') return progress !== null && progress >= 70 && progress < 100
      return true
    })
  }, [enrichedGames, filterBy])

  const sortedGames = useMemo(() => {
    const arr = [...filteredGames]
    switch (sortBy) {
      case 'recency': {
        return arr.sort((a, b) => {
          const aTime = new Date(a._enrich?.lastPlayedAt || a._enrich?.updated_at || a.addedAt || 0).getTime()
          const bTime = new Date(b._enrich?.lastPlayedAt || b._enrich?.updated_at || b.addedAt || 0).getTime()
          return bTime - aTime
        })
      }
      case 'added': {
        return arr.sort((a, b) => {
          const aTime = new Date(a.addedAt || 0).getTime()
          const bTime = new Date(b.addedAt || 0).getTime()
          return bTime - aTime
        })
      }
      case 'progress': {
        return arr.sort((a, b) => {
          const ap = a._enrich?.progress_override ?? a._enrich?.progressPercent ?? -1
          const bp = b._enrich?.progress_override ?? b._enrich?.progressPercent ?? -1
          return bp - ap
        })
      }
      case 'hours': {
        return arr.sort((a, b) => {
          const ah = a._enrich?.hours_played ?? 0
          const bh = b._enrich?.hours_played ?? 0
          return bh - ah
        })
      }
      case 'rating': {
        return arr.sort((a, b) => {
          const ar = a._enrich?.rating ?? -1
          const br = b._enrich?.rating ?? -1
          return br - ar
        })
      }
      default:
        return arr
    }
  }, [filteredGames, sortBy])

  // ── Select mode handlers ────────────────────────────────────────────────────

  const toggleSelectMode = () => {
    setSelectMode((v) => !v)
    setSelectedIds(new Set())
  }

  const toggleItem = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    setSelectedIds(new Set(sortedGames.map((g) => String(g.id))))
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
    setSelectMode(false)
  }

  // ── Bulk actions ────────────────────────────────────────────────────────────

  const handleBulkMove = (targetStatus) => {
    let moved = 0
    for (const id of selectedIds) {
      const game = games.find((g) => String(g.id) === id)
      if (game) {
        setGameStatus(id, targetStatus, game)
        moved++
      }
    }
    if (moved > 0) {
      showToast(
        `Moved ${moved} ${moved === 1 ? 'game' : 'games'} to ${TRACKER_LABELS[
          { currently: 'currently-playing', played: 'played', want: 'want-to-play', dropped: 'dropped' }[targetStatus]
        ] || targetStatus}`,
        'success'
      )
      window.dispatchEvent(new Event('libraryUpdated'))
    }
    clearSelection()
    setBulkMoveSheetOpen(false)
  }

  const handleBulkRemove = () => {
    let removed = 0
    for (const id of selectedIds) {
      clearGameStatus(id)
      removed++
    }
    if (removed > 0) {
      showToast(`Removed ${removed} ${removed === 1 ? 'game' : 'games'}`, 'success')
    }
    clearSelection()
  }

  const handleBulkRate = (rating) => {
    // Navigate to first game's review for now — batch rating via postReview
    // is intentionally fire-and-forget since each game needs its own review row
    let count = 0
    const ids = Array.from(selectedIds)
    for (const id of ids) {
      const game = games.find((g) => String(g.id) === id)
      if (!game) continue
      import('../services/reviewService').then(({ postReview, getCachedUserReviews }) => {
        // Don't double-post: check if user already has a review for this game
        const existing = getCachedUserReviews().find(
          (r) => String(r.igdb_game_id) === String(id)
        )
        if (!existing) {
          postReview({
            igdbGameId: id,
            rating,
            gameTitle: game.title,
            gameImage: game.image,
          }).catch(() => {})
        }
      })
      count++
    }
    showToast(`Rating applied to ${count} ${count === 1 ? 'game' : 'games'}`, 'success')
    clearSelection()
    setBulkRateSheetOpen(false)
  }

  // ── Log session callback ────────────────────────────────────────────────────

  const handleLogged = useCallback((gameId, result) => {
    // Optimistically update enrichMap hours
    setEnrichMap((prev) => {
      const existing = prev[String(gameId)] || {}
      return {
        ...prev,
        [String(gameId)]: {
          ...existing,
          hours_played: result.newHours,
          lastPlayedAt: new Date().toISOString(),
        },
      }
    })
  }, [])

  // ── Derived labels ──────────────────────────────────────────────────────────

  const currentSortLabel = SORT_OPTIONS.find((o) => o.id === sortBy)?.label || 'Sort'
  const activeFilterCount = filterBy !== 'all' ? 1 : 0

  // ── Render ──────────────────────────────────────────────────────────────────

  const isCurrentlyPlaying = listId === 'currently-playing'

  return (
    <div className="tgl-root">
      {/* Controls bar */}
      <div className="tgl-controls">
        <div className="tgl-controls-left">
          <button
            type="button"
            className="tgl-sort-btn"
            onClick={() => setSortSheetOpen(true)}
            aria-label={`Sort by: ${currentSortLabel}`}
          >
            <ArrowUpDown size={13} aria-hidden="true" />
            {currentSortLabel}
            <ChevronDown size={13} aria-hidden="true" />
          </button>

          {isCurrentlyPlaying && (
            <button
              type="button"
              className={`tgl-filter-btn${activeFilterCount > 0 ? ' tgl-filter-btn--active' : ''}`}
              onClick={() => setFilterSheetOpen(true)}
              aria-label="Filter games"
            >
              <SlidersHorizontal size={13} aria-hidden="true" />
              {activeFilterCount > 0 ? FILTER_OPTIONS.find((o) => o.id === filterBy)?.label : 'Filter'}
            </button>
          )}
        </div>

        <div className="tgl-controls-right">
          {selectMode ? (
            <>
              <button
                type="button"
                className="tgl-ctrl-link"
                onClick={selectAll}
                aria-label="Select all games"
              >
                All
              </button>
              <button
                type="button"
                className="tgl-ctrl-link tgl-ctrl-link--cancel"
                onClick={clearSelection}
                aria-label="Exit select mode"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="tgl-ctrl-link"
              onClick={toggleSelectMode}
              aria-label="Enter select mode"
            >
              Select
            </button>
          )}
        </div>
      </div>

      {/* Game list */}
      <div className="tgl-list" role="list">
        {sortedGames.length === 0 ? (
          <div className="tgl-empty">
            <p className="tgl-empty-text">
              {filterBy !== 'all' ? 'No games match this filter.' : 'No games here yet.'}
            </p>
            {filterBy !== 'all' && (
              <button
                type="button"
                className="tgl-empty-clear"
                onClick={() => setFilterBy('all')}
              >
                Clear filter
              </button>
            )}
          </div>
        ) : (
          sortedGames.map((game) => (
            <TrackerGameRow
              key={game.id}
              game={game}
              enrich={game._enrich}
              listId={listId}
              selectMode={selectMode}
              isSelected={selectedIds.has(String(game.id))}
              onToggleSelect={(id) => toggleItem(String(id))}
              onLogSession={(g) => {
                setLogTarget(g)
                setLogSheetOpen(true)
              }}
              navigate={navigate}
            />
          ))
        )}
      </div>

      {/* Loading shimmer overlay — visible only during initial enrichment */}
      {enrichLoading && games.length > 0 && (
        <div className="tgl-enrich-loading" aria-hidden="true">
          {Array.from({ length: Math.min(games.length, 3) }).map((_, i) => (
            <div key={i} className="tgl-enrich-shimmer" />
          ))}
        </div>
      )}

      {/* Bulk action bar */}
      <AnimatePresence>
        {selectMode && selectedIds.size > 0 && (
          <BulkActionBar
            key="bulk-bar"
            count={selectedIds.size}
            listId={listId}
            onMove={() => setBulkMoveSheetOpen(true)}
            onRate={() => setBulkRateSheetOpen(true)}
            onRemove={handleBulkRemove}
            onClear={clearSelection}
          />
        )}
      </AnimatePresence>

      {/* Log session sheet */}
      <LogSessionSheet
        game={logTarget}
        isOpen={logSheetOpen}
        onClose={() => {
          setLogSheetOpen(false)
          setLogTarget(null)
        }}
        onLogged={handleLogged}
      />

      {/* Sort action sheet */}
      <ActionSheet
        isOpen={sortSheetOpen}
        onClose={() => setSortSheetOpen(false)}
        title="Sort by"
        items={SORT_OPTIONS.map((o) => ({
          label: o.id === sortBy ? `${o.label} ✓` : o.label,
          onClick: () => setSortBy(o.id),
        }))}
      />

      {/* Filter action sheet (currently-playing only) */}
      <ActionSheet
        isOpen={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="Filter"
        items={FILTER_OPTIONS.map((o) => ({
          label: o.id === filterBy ? `${o.label} ✓` : o.label,
          onClick: () => setFilterBy(o.id),
        }))}
      />

      {/* Bulk move sheet */}
      <ActionSheet
        isOpen={bulkMoveSheetOpen}
        onClose={() => setBulkMoveSheetOpen(false)}
        title={`Move ${selectedIds.size} ${selectedIds.size === 1 ? 'game' : 'games'} to…`}
        items={MOVE_TARGETS
          .filter((t) => {
            const statusMap = { currently: 'currently-playing', played: 'played', want: 'want-to-play', dropped: 'dropped' }
            return statusMap[t.id] !== listId
          })
          .map((t) => ({
            label: t.label,
            onClick: () => handleBulkMove(t.id),
            destructive: t.id === 'dropped',
          }))}
      />

      {/* Bulk rate sheet */}
      <ActionSheet
        isOpen={bulkRateSheetOpen}
        onClose={() => setBulkRateSheetOpen(false)}
        title={`Rate ${selectedIds.size} ${selectedIds.size === 1 ? 'game' : 'games'}`}
        items={[5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].map((r) => ({
          label: `${r} ★`,
          onClick: () => handleBulkRate(r),
        }))}
      />
    </div>
  )
}

export default TrackerGameList

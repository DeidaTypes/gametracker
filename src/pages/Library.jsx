import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search as SearchIcon, List, Pin, ArrowUpDown, Check } from 'lucide-react'
import { useAutoAnimateMotion } from '../hooks/useMotionPreference'
import { useAuth } from '../contexts/AuthContext'
import CreateListModal from '../components/CreateListModal'
import EmptyState from '../components/EmptyState'
import ActionSheet from '../components/ActionSheet'
import SharedCover, { SharedCoverScope, findDuplicateGameIds } from '../components/SharedCover'
import { showToast } from '../components/Toast'
import InlineErrorBanner from '../components/InlineErrorBanner'
import { COVER_FALLBACK } from '../utils/coverFallback'
import {
  initializeLibrary,
  getGamesFromList,
  getGameProgress,
} from '../services/libraryService'
import {
  getListsForUser,
  getPinnedListsForUser,
  createList,
  addGameToList,
  LIST_PIN_CHANGED_EVENT,
} from '../services/listService'
import './Library.css'

// Status chips — exact order + wording the Library shelf renders. `listId`
// is the localStorage tracker bucket (see libraryService.DEFAULT_LISTS);
// 'all' has no bucket of its own, it's the union of the other four.
const STATUS_TABS = [
  { key: 'all', label: 'All', listId: null },
  { key: 'want', label: 'Want to Play', listId: 'want-to-play' },
  { key: 'currently', label: 'Currently Playing', listId: 'currently-playing' },
  { key: 'played', label: 'Played', listId: 'played' },
  { key: 'dropped', label: 'Dropped', listId: 'dropped' },
]

const STATUS_BUCKET_IDS = STATUS_TABS.filter((t) => t.listId).map((t) => t.listId)

// Status-dot color per chip key. "Currently Playing" / "Played" get their
// own accent; "Want to Play" / "Dropped" share the muted/tertiary text
// color per the design spec's "muted" dot.
const STATUS_DOT_COLOR = {
  currently: 'var(--accent)',
  played: 'var(--accent-review)',
  want: 'var(--text-tertiary)',
  dropped: 'var(--text-tertiary)',
}

// Sort options — each backed by a real field already stored on tracked
// games (addedAt) or already derived elsewhere in this file (getTouchedAt).
const SORTS = [
  { key: 'recent', label: 'Recent' },
  { key: 'updated', label: 'Recently updated' },
  { key: 'title', label: 'Title A–Z' },
]

const PAGE_SIZE = 30

// Most-recent "touched" timestamp for a game across all known signals
// (addedAt, lastPlayedAt, playedFirstAt). Falls back to 0 so sorting stays
// stable when nothing is recorded.
function getTouchedAt(game) {
  const progress = getGameProgress(game.id) || {}
  const candidates = [
    game.addedAt,
    progress.lastPlayedAt,
    progress.playedFirstAt,
  ]
    .filter(Boolean)
    .map((s) => new Date(s).getTime())
    .filter((n) => Number.isFinite(n))
  return candidates.length ? Math.max(...candidates) : 0
}

function Library() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [trackerLists, setTrackerLists] = useState({})
  const [customLists, setCustomLists] = useState([])
  const [pinnedLists, setPinnedLists] = useState([])
  const [isLoadingCustom, setIsLoadingCustom] = useState(true)
  const [errorCustom, setErrorCustom] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSortSheet, setShowSortSheet] = useState(false)

  const [activeStatus, setActiveStatus] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState('recent')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const [gridRef] = useAutoAnimateMotion()
  const [railRef] = useAutoAnimateMotion()

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadTrackerLists = useCallback(() => {
    initializeLibrary()
    const snap = {}
    for (const id of STATUS_BUCKET_IDS) {
      snap[id] = { games: getGamesFromList(id) }
    }
    setTrackerLists(snap)
  }, [])

  const loadCustomLists = useCallback(async () => {
    if (!user?.id) {
      setCustomLists([])
      setPinnedLists([])
      setIsLoadingCustom(false)
      setErrorCustom(false)
      return
    }
    setIsLoadingCustom(true)
    setErrorCustom(false)
    try {
      const [lists, pinned] = await Promise.all([
        getListsForUser(user.id),
        getPinnedListsForUser(user.id),
      ])
      setCustomLists(lists)
      setPinnedLists(pinned)
    } catch (err) {
      console.error('[library] failed to load custom lists:', err)
      setErrorCustom(true)
    } finally {
      setIsLoadingCustom(false)
    }
  }, [user?.id])

  useEffect(() => {
    loadTrackerLists()
    loadCustomLists()
    const handleUpdate = () => {
      loadTrackerLists()
      loadCustomLists()
    }
    window.addEventListener('libraryUpdated', handleUpdate)
    window.addEventListener(LIST_PIN_CHANGED_EVENT, handleUpdate)
    return () => {
      window.removeEventListener('libraryUpdated', handleUpdate)
      window.removeEventListener(LIST_PIN_CHANGED_EVENT, handleUpdate)
    }
  }, [loadTrackerLists, loadCustomLists])

  // Reset pagination whenever the visible set could change shape.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [activeStatus, searchQuery, sortKey])

  // ── Derived data ──────────────────────────────────────────────────────────

  // Combined tracked-games list, each game tagged with its status. Built
  // read-only from the four localStorage tracker buckets — see STEP-0 note
  // in the PR description: there is no single combined source in
  // libraryService, so this page assembles one itself.
  const allTracked = useMemo(() => {
    const out = []
    for (const tab of STATUS_TABS) {
      if (!tab.listId) continue
      const games = trackerLists[tab.listId]?.games || []
      for (const g of games) {
        if (!g?.id) continue
        out.push({ ...g, _status: tab.key })
      }
    }
    return out
  }, [trackerLists])

  const counts = useMemo(() => {
    const c = { all: allTracked.length }
    for (const tab of STATUS_TABS) {
      if (!tab.listId) continue
      c[tab.key] = allTracked.filter((g) => g._status === tab.key).length
    }
    return c
  }, [allTracked])

  const statusFiltered = useMemo(() => {
    if (activeStatus === 'all') return allTracked
    return allTracked.filter((g) => g._status === activeStatus)
  }, [allTracked, activeStatus])

  const searchFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return statusFiltered
    return statusFiltered.filter((g) => (g.title || '').toLowerCase().includes(q))
  }, [statusFiltered, searchQuery])

  const sortedGames = useMemo(() => {
    const list = searchFiltered.slice()
    if (sortKey === 'title') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    } else if (sortKey === 'updated') {
      list.sort((a, b) => getTouchedAt(b) - getTouchedAt(a))
    } else {
      list.sort((a, b) => {
        const da = new Date(a.addedAt || 0).getTime()
        const db = new Date(b.addedAt || 0).getTime()
        return db - da
      })
    }
    return list
  }, [searchFiltered, sortKey])

  const visibleGames = sortedGames.slice(0, visibleCount)
  const hasMore = sortedGames.length > visibleGames.length

  // Lists rail: pinned first, then everything else (deduped by id).
  const otherLists = useMemo(() => {
    const pinnedIds = new Set(pinnedLists.map((l) => l.id))
    return customLists.filter((l) => !pinnedIds.has(l.id))
  }, [customLists, pinnedLists])

  // Dedupe set for SharedCover — a game can appear both in the poster grid
  // and in a list-rail mosaic without a conflicting layoutId match.
  const duplicateIds = useMemo(() => {
    const all = [visibleGames]
    for (const list of pinnedLists) all.push((list.games || []).slice(0, 4))
    for (const list of otherLists) all.push((list.games || []).slice(0, 4))
    return findDuplicateGameIds(...all)
  }, [visibleGames, pinnedLists, otherLists])

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCreateList = async (listName, description, initialGames) => {
    const listId = await createList({ name: listName, description, isPublic: true })
    for (let i = 0; i < initialGames.length; i++) {
      const g = initialGames[i]
      await addGameToList(listId, g.id, i, { title: g.title, image: g.image })
    }
    showToast(`List "${listName}" created`, 'success')
    navigate(`/list/${listId}`)
  }

  const handleCoverClick = (gameId) => {
    navigate(`/game/${gameId}`)
  }

  const handleListClick = (listId) => {
    navigate(`/list/${listId}`)
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderPosterCard = (g) => {
    const dotColor = STATUS_DOT_COLOR[g._status] || 'var(--text-tertiary)'
    return (
      <button
        key={g.id}
        type="button"
        className="lib-poster-card"
        onClick={() => handleCoverClick(g.id)}
        aria-label={g.title ? `Open ${g.title}` : 'Open game'}
      >
        <div className="lib-poster-cover-wrap">
          <SharedCover gameId={g.id} imageSrc={g.image || COVER_FALLBACK}>
            <img
              src={g.image || COVER_FALLBACK}
              alt=""
              className="lib-poster-cover-img"
              loading="lazy"
              draggable={false}
              onError={(e) => { e.target.src = COVER_FALLBACK }}
            />
          </SharedCover>
          <span
            className="lib-poster-dot"
            style={{ background: dotColor }}
            aria-hidden="true"
          />
        </div>
        <p className="lib-poster-title">{g.title || '—'}</p>
      </button>
    )
  }

  const renderListTile = (list, isPinned) => {
    const { id, name, games = [], gameCount = 0, coverImageUrl } = list
    const mosaic = games.slice(0, 4)
    const placeholders = Math.max(0, 4 - mosaic.length)

    const mosaicAlt = mosaic.length > 0
      ? `${name} — covers of ${mosaic.map((g) => g.title).filter(Boolean).join(', ')}`
      : `${name} cover`

    return (
      <button
        key={id}
        type="button"
        className="lib-list-tile"
        onClick={() => handleListClick(id)}
        aria-label={`Open list ${name} (${gameCount} ${gameCount === 1 ? 'game' : 'games'})${isPinned ? ', pinned' : ''}`}
      >
        {isPinned && (
          <span className="lib-list-tile-pin" aria-hidden="true">
            <Pin size={12} />
          </span>
        )}
        {coverImageUrl ? (
          <div className="lib-list-tile-mosaic lib-list-tile-mosaic--cover">
            <img
              src={coverImageUrl}
              alt={`${name} cover`}
              className="lib-list-tile-cover-img"
              loading="lazy"
              draggable={false}
            />
          </div>
        ) : (
          <div className="lib-list-tile-mosaic" role="img" aria-label={mosaicAlt}>
            {mosaic.map((g) => (
              <div key={g.id} className="lib-list-tile-mosaic-cell">
                {g.image ? (
                  <SharedCover gameId={g.id} imageSrc={g.image}>
                    <img
                      src={g.image}
                      alt=""
                      className="lib-list-tile-mosaic-img"
                      loading="lazy"
                      draggable={false}
                    />
                  </SharedCover>
                ) : (
                  <div className="lib-list-tile-mosaic-fallback">
                    {g.title?.charAt(0) || '?'}
                  </div>
                )}
              </div>
            ))}
            {Array.from({ length: placeholders }).map((_, i) => (
              <div
                key={`ph-${i}`}
                className="lib-list-tile-mosaic-cell lib-list-tile-mosaic-cell--empty"
              />
            ))}
          </div>
        )}
        <p className="lib-list-tile-name">{name}</p>
        <p className="lib-list-tile-count">
          {gameCount} {gameCount === 1 ? 'game' : 'games'}
        </p>
      </button>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SharedCoverScope duplicateIds={duplicateIds}>
      <div className="library-page">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="lib-header">
          <h1 className="lib-title">Library</h1>

          <div className="lib-search-wrap">
            <SearchIcon size={16} className="lib-search-icon" aria-hidden="true" />
            <input
              type="text"
              className="lib-search-input"
              placeholder="Search your library"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search your library by title"
            />
          </div>

          <div className="lib-chip-row">
            <div className="lib-chips" role="tablist" aria-label="Filter by status">
              {STATUS_TABS.map((tab) => {
                const active = activeStatus === tab.key
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`lib-chip${active ? ' lib-chip--active' : ''}`}
                    onClick={() => setActiveStatus(tab.key)}
                  >
                    <span className="lib-chip-label">{tab.label}</span>
                    <span className="lib-chip-count">{counts[tab.key] ?? 0}</span>
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              className="lib-sort-icon-btn"
              onClick={() => setShowSortSheet(true)}
              aria-label={`Sort games (currently ${SORTS.find((s) => s.key === sortKey)?.label || 'Recent'})`}
            >
              <ArrowUpDown size={16} />
            </button>
          </div>
        </header>

        {/* ── Poster grid ────────────────────────────────────────────── */}
        <section className="lib-section lib-section--grid" aria-label="Your games">
          {allTracked.length === 0 ? (
            <EmptyState
              icon={List}
              title="No games tracked yet."
              body="Search for a game and set a status to start your library."
              cta="Find games"
              onCta={() => navigate('/search')}
            />
          ) : (
            <>
              {sortedGames.length === 0 ? (
                <p className="lib-grid-empty">No games match this filter.</p>
              ) : (
                <>
                  <div className="lib-poster-grid" ref={gridRef}>
                    {visibleGames.map(renderPosterCard)}
                  </div>
                  {hasMore && (
                    <button
                      type="button"
                      className="lib-loadmore"
                      onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    >
                      Show more
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </section>

        {/* ── Your lists ─────────────────────────────────────────────── */}
        <section className="lib-section lib-section--lists" aria-labelledby="lib-lists-label">
          <p id="lib-lists-label" className="lib-section-label">Your Lists</p>

          {isLoadingCustom ? (
            <div className="lib-lists-rail lib-lists-rail--skeleton" aria-hidden="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="lib-list-tile lib-list-tile--skeleton">
                  <div className="skeleton lib-list-tile-mosaic-skeleton" />
                  <div className="skeleton lib-sk-name" />
                  <div className="skeleton lib-sk-count" />
                </div>
              ))}
            </div>
          ) : errorCustom ? (
            <InlineErrorBanner
              message="Couldn't load. Tap to retry."
              onRetry={loadCustomLists}
            />
          ) : (
            <div className="lib-lists-rail content-fade-in" ref={railRef}>
              {pinnedLists.map((list) => renderListTile(list, true))}
              {otherLists.map((list) => renderListTile(list, false))}
              <button
                type="button"
                className="lib-list-tile lib-list-tile--new"
                onClick={() => setShowCreateModal(true)}
              >
                <span className="lib-list-tile-new-icon" aria-hidden="true">+</span>
                <span className="lib-list-tile-new-label">New list</span>
              </button>
            </div>
          )}
        </section>

        <CreateListModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateList}
        />

        <ActionSheet
          isOpen={showSortSheet}
          onClose={() => setShowSortSheet(false)}
          title="Sort By"
          items={SORTS.map((s) => ({
            label: (
              <span className="lib-sort-item">
                {s.label}
                {sortKey === s.key && <Check size={16} aria-hidden="true" />}
              </span>
            ),
            onClick: () => setSortKey(s.key),
          }))}
        />
      </div>
    </SharedCoverScope>
  )
}

export default Library

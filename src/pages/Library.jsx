import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search as SearchIcon, List, ChevronDown, Check, Plus, FilterX } from 'lucide-react'
import { useAutoAnimateMotion, useMotionPreference } from '../hooks/useMotionPreference'
import { useAuth } from '../contexts/AuthContext'
import CreateListModal from '../components/CreateListModal'
import EmptyState from '../components/EmptyState'
import ActionSheet from '../components/ActionSheet'
import PullToRefresh from '../components/PullToRefresh'
import InlineErrorBanner from '../components/InlineErrorBanner'
import Avatar from '../components/Avatar'
import ListCoverCluster from '../components/ListCoverCluster'
import SharedCover, { SharedCoverScope, findDuplicateGameIds } from '../components/SharedCover'
import { showToast } from '../components/Toast'
import ReorderTrashTarget from '../components/ReorderTrashTarget'
import { LIST_REORDER_DRAG_EVENT } from '../components/BottomNav'
import { hapticImpact, hapticSuccess } from '../utils/haptics'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { initializeLibrary, getGamesFromList, clearGameStatus, setGameStatus } from '../services/libraryService'
import { getAllReviews } from '../services/reviewService'
import { STATUS_META } from '../components/StatusChip'
import { getProfile } from '../services/profileService'
import {
  getListsForUser,
  getSaveCountsForLists,
  createList,
  addGameToList,
  LIST_PIN_CHANGED_EVENT,
} from '../services/listService'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import './Library.css'

// The four status cells of the My Games dashboard, in render order.
// `listId` is the localStorage tracker bucket (see libraryService.DEFAULT_LISTS)
// and `key` is the status tag carried on each combined game as `_status`.
const STATUS_CELLS = [
  { key: 'want', label: STATUS_META.want.label, listId: 'want-to-play' },
  { key: 'currently', label: 'Playing', listId: 'currently-playing' },
  { key: 'played', label: STATUS_META.played.label, listId: 'played' },
  { key: 'dropped', label: STATUS_META.dropped.label, listId: 'dropped' },
]

// Sort options — only sorts backed by a real field on every game.
const SORTS = [
  { key: 'recent', label: 'Recent' },
  { key: 'title', label: 'Title A–Z' },
]

const PAGE_SIZE = 30

// Same long-press / move-cancel gates as ListDetail's custom-list
// drag-to-trash path. Library only uses the trash branch — no reorder.
const LONG_PRESS_MS = 450
const MOVE_CANCEL_PX = 8
const REMOVE_ANIM_MS = 200

/**
 * Which segment the user last had open, remembered for the session.
 *
 * Navigating away from Library unmounts it, so without this the tab
 * silently snaps back to the default tab every time — open a game from
 * My Games, press back, and you are somewhere you never chose to be.
 * Module scope (rather than state lifted into a parent) keeps the memory
 * local to this screen and resets naturally on a full reload.
 */
let lastActiveTab = 'games'

function Library() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [activeTab, setActiveTabState] = useState(lastActiveTab)
  const setActiveTab = useCallback((tab) => {
    lastActiveTab = tab
    setActiveTabState(tab)
  }, [])

  const [trackerLists, setTrackerLists] = useState({})
  const [customLists, setCustomLists] = useState([])
  const [saveCounts, setSaveCounts] = useState(new Map())
  const [isLoadingLists, setIsLoadingLists] = useState(true)
  const [errorLists, setErrorLists] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSortSheet, setShowSortSheet] = useState(false)

  // Drives the My Games empty-state copy: a user with reviews but zero
  // tracked games gets different wording than one with neither (see
  // renderGamesEmptyState below). Read from reviewService's own
  // current-user cache — the same cache dnaService/profileStatsService
  // already read synchronously — rather than an extra network round trip.
  const [hasReviews, setHasReviews] = useState(() => getAllReviews().length > 0)

  // null = All. Tapping the active cell again returns here.
  const [activeStatus, setActiveStatus] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState('recent')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const [gridRef] = useAutoAnimateMotion()
  const { reduced: reducedMotion } = useMotionPreference()

  // Long-press drag-to-trash (My Games covers with a tracker status).
  // Pointer Events only — same contract as ListDetail's custom-list
  // path. No reorder / slot swapping lives here.
  const [dragGameId, setDragGameId] = useState(null)
  const [trashArmed, setTrashArmed] = useState(false)
  const [removingGameId, setRemovingGameId] = useState(null)

  const itemEls = useRef({})
  const trashBarRef = useRef(null)
  const dragSessionRef = useRef(null)
  const longPressTimerRef = useRef(null)
  const suppressClickRef = useRef(false)

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadTrackerLists = useCallback(() => {
    initializeLibrary()
    const snap = {}
    for (const cell of STATUS_CELLS) {
      snap[cell.listId] = { games: getGamesFromList(cell.listId) }
    }
    setTrackerLists(snap)
  }, [])

  // `background: true` refreshes in place. Pull-to-refresh, library writes
  // and app resume all run over lists the user is already looking at, and
  // flipping the loading flag there swapped them for skeletons mid-gesture.
  const loadCustomLists = useCallback(async ({ background = false } = {}) => {
    if (!user?.id) {
      setCustomLists([])
      setSaveCounts(new Map())
      setIsLoadingLists(false)
      setErrorLists(false)
      return
    }
    if (!background) setIsLoadingLists(true)
    setErrorLists(false)
    try {
      const lists = await getListsForUser(user.id)
      setCustomLists(lists)
      setSaveCounts(await getSaveCountsForLists(lists.map((l) => l.id)))
    } catch (err) {
      console.error('[library] failed to load custom lists:', err)
      setErrorLists(true)
    } finally {
      setIsLoadingLists(false)
    }
  }, [user?.id])

  // Pull-to-refresh: re-run both loaders for both tabs regardless of which
  // is active. Neither goes through swrCache — tracker lists are a plain
  // localStorage read and custom lists always hit the network directly —
  // so there's no cache to bypass, just a fresh round-trip.
  const handlePullToRefresh = useCallback(async () => {
    loadTrackerLists()
    await loadCustomLists({ background: true })
  }, [loadTrackerLists, loadCustomLists])

  useEffect(() => {
    loadTrackerLists()
    loadCustomLists()
    const handleUpdate = () => {
      loadTrackerLists()
      loadCustomLists({ background: true })
    }
    window.addEventListener('libraryUpdated', handleUpdate)
    window.addEventListener(LIST_PIN_CHANGED_EVENT, handleUpdate)
    // The WebView isn't remounted on resume, so the mount call above never
    // re-runs and custom lists edited on another device stay invisible.
    window.addEventListener(APP_RESUMED_EVENT, handleUpdate)
    return () => {
      window.removeEventListener('libraryUpdated', handleUpdate)
      window.removeEventListener(LIST_PIN_CHANGED_EVENT, handleUpdate)
      window.removeEventListener(APP_RESUMED_EVENT, handleUpdate)
    }
  }, [loadTrackerLists, loadCustomLists])

  // Keep the reviews-exist flag current as reviews are posted/removed in
  // this session — same 'reviewAdded' event reviewService/ReviewNew
  // already dispatch on every write.
  useEffect(() => {
    const refreshHasReviews = () => setHasReviews(getAllReviews().length > 0)
    window.addEventListener('reviewAdded', refreshHasReviews)
    return () => window.removeEventListener('reviewAdded', refreshHasReviews)
  }, [])

  // Reset pagination whenever the visible set could change shape.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [activeTab, activeStatus, searchQuery, sortKey])

  // ── Derived data ──────────────────────────────────────────────────────────

  // Status-tracked games, each tagged with the bucket it came from. Built
  // read-only from the four localStorage buckets: libraryService has no
  // combined getter, so this page assembles one itself.
  const allTracked = useMemo(() => {
    const out = []
    for (const cell of STATUS_CELLS) {
      for (const g of trackerLists[cell.listId]?.games || []) {
        if (!g?.id) continue
        out.push({
          id: g.id,
          title: g.title || '',
          image: g.image || null,
          addedAt: g.addedAt || null,
          _status: cell.key,
        })
      }
    }
    return out
  }, [trackerLists])

  // The one combined set the My Games grid renders: status-tracked games plus
  // every game from every custom list, deduped by IGDB id. A status-tracked
  // entry always wins over a list entry for the same game, so a game that's
  // both tracked AND in a list keeps its tracker status instead of null.
  const combinedGames = useMemo(() => {
    const byId = new Map()
    for (const g of allTracked) byId.set(String(g.id), g)
    for (const list of customLists) {
      for (const g of list.games || []) {
        if (!g?.id) continue
        const key = String(g.id)
        if (byId.has(key)) continue
        byId.set(key, {
          id: g.id,
          title: g.title || '',
          image: g.image || null,
          addedAt: g.addedAt || null,
          _status: null,
        })
      }
    }
    return Array.from(byId.values())
  }, [allTracked, customLists])

  const counts = useMemo(() => {
    const c = {}
    for (const cell of STATUS_CELLS) {
      c[cell.key] = combinedGames.filter((g) => g._status === cell.key).length
    }
    return c
  }, [combinedGames])

  const filteredGames = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return combinedGames.filter((g) => {
      if (activeStatus && g._status !== activeStatus) return false
      if (q && !(g.title || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [combinedGames, activeStatus, searchQuery])

  const sortedGames = useMemo(() => {
    const list = filteredGames.slice()
    if (sortKey === 'title') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    } else {
      list.sort(
        (a, b) =>
          new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime()
      )
    }
    return list
  }, [filteredGames, sortKey])

  const visibleGames = sortedGames.slice(0, visibleCount)
  const hasMore = sortedGames.length > visibleGames.length

  const duplicateIds = useMemo(() => findDuplicateGameIds(visibleGames), [visibleGames])

  // Pinning is opt-in: with nothing pinned the PINNED section doesn't render
  // at all and every list shows under ALL LISTS. `isPinned`/`pinnedAt` already
  // ride along on getListsForUser's rows, so this needs no extra query —
  // getPinnedListsForUser exists (and is what Profile's PinnedListsSection
  // uses) but would just be a redundant round-trip here. Sorted so
  // pinnedLists[0] is always the most-recently-pinned list, per spec: only
  // ONE pinned hero is ever shown, even if several lists are pinned.
  const pinnedLists = useMemo(
    () =>
      customLists
        .filter((l) => l.isPinned)
        .sort((a, b) => new Date(b.pinnedAt || 0) - new Date(a.pinnedAt || 0)),
    [customLists]
  )

  // Header avatar — same local-profile resolution Profile.jsx uses.
  const avatarUser = useMemo(() => {
    const profile = getProfile()
    const stored = profile?.avatar
    const avatarUrl =
      stored?.type === 'url' || stored?.type === 'data' ? stored.data : null
    return {
      id: user?.id || 'me',
      avatarUrl,
      displayName: profile?.displayName || '',
      username: profile?.username || '',
    }
  }, [user?.id])

  const isGamesTab = activeTab === 'games'
  const sortLabel = SORTS.find((s) => s.key === sortKey)?.label || 'Recent'

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCreateList = async (listName, description, initialGames, isPublic = true) => {
    const listId = await createList({ name: listName, description, isPublic })
    for (let i = 0; i < initialGames.length; i++) {
      const g = initialGames[i]
      await addGameToList(listId, g.id, i, { title: g.title, image: g.image })
    }
    showToast(`List "${listName}" created`, 'success')
    navigate(`/list/${listId}`)
  }

  // Tapping the active status cell again clears back to All.
  const handleStatusTap = (key) => {
    setActiveStatus((current) => (current === key ? null : key))
  }

  // ── Long-press drag-to-trash (My Games, tracker rows only) ──────────
  // Reuses ListDetail's Pointer Events gate, LIST_REORDER_DRAG_EVENT
  // (so BottomNav's existing hide listener fires with zero changes),
  // ReorderTrashTarget portal, cover-center hit test, and haptics
  // sequence. Does NOT implement reorder / position swapping.

  const applyDragTransform = (gameId, dx, dy) => {
    const el = itemEls.current[gameId]
    if (!el) return
    el.style.transition = ''
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
  }

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const hardResetDrag = (gameId) => {
    clearLongPressTimer()
    const el = gameId != null ? itemEls.current[gameId] : null
    if (el) {
      el.style.transform = ''
      el.style.transition = ''
    }
    dragSessionRef.current = null
    setDragGameId(null)
    setTrashArmed(false)
    window.dispatchEvent(
      new CustomEvent(LIST_REORDER_DRAG_EVENT, { detail: { active: false } })
    )
  }

  const handleCoverPointerDown = (e, game) => {
    // List-only membership (_status: null) has no tracker to delete.
    // Leave the cover as a plain tap-to-open so we never arm a no-op.
    if (!game._status) return
    if (dragSessionRef.current) return

    const captureEl = e.currentTarget
    try {
      captureEl.setPointerCapture(e.pointerId)
    } catch {
      // Same capture-reject fallback as ListDetail — long-press still
      // arms; move/up may not fire if the finger leaves this element.
    }

    const session = {
      gameId: game.id,
      pointerId: e.pointerId,
      captureEl,
      startClientX: e.clientX,
      startClientY: e.clientY,
      activated: false,
      armed: false,
      startRect: null,
      previousStatus: game._status,
      gameSnapshot: {
        id: game.id,
        title: game.title,
        image: game.image,
        addedAt: game.addedAt,
      },
    }
    dragSessionRef.current = session

    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null
      if (dragSessionRef.current !== session) return

      const startRect = itemEls.current[game.id]?.getBoundingClientRect()
      if (!startRect) {
        dragSessionRef.current = null
        return
      }

      session.activated = true
      session.startRect = startRect
      suppressClickRef.current = true
      setDragGameId(game.id)
      hapticImpact('Medium')
      window.dispatchEvent(
        new CustomEvent(LIST_REORDER_DRAG_EVENT, { detail: { active: true } })
      )
    }, LONG_PRESS_MS)
  }

  const handleCoverPointerMove = (e) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== e.pointerId) return

    if (!session.activated) {
      const dx = e.clientX - session.startClientX
      const dy = e.clientY - session.startClientY
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        clearLongPressTimer()
        dragSessionRef.current = null
      }
      return
    }

    e.preventDefault()

    const dx = e.clientX - session.startClientX
    const dy = e.clientY - session.startClientY
    applyDragTransform(session.gameId, dx, dy)

    const trashEl = trashBarRef.current
    if (trashEl) {
      const trashRect = trashEl.getBoundingClientRect()
      const centerX = session.startRect.left + session.startRect.width / 2 + dx
      const centerY = session.startRect.top + session.startRect.height / 2 + dy
      const nowArmed =
        centerX >= trashRect.left &&
        centerX <= trashRect.right &&
        centerY >= trashRect.top &&
        centerY <= trashRect.bottom

      if (nowArmed !== session.armed) {
        session.armed = nowArmed
        setTrashArmed(nowArmed)
        if (nowArmed) hapticImpact('Light')
      }
    }
  }

  const commitRemoveViaDrag = (game, previousStatus) => {
    const ok = clearGameStatus(game.id)
    if (!ok) {
      showToast('Failed to remove game. Please try again.', 'error')
      return
    }
    hapticSuccess()
    showToast('Removed from library', 'success', 4000, {
      label: 'Undo',
      onClick: () => {
        const restored = setGameStatus(game.id, previousStatus, game)
        if (!restored) {
          showToast("Couldn't restore the game. Please try again.", 'error')
        }
      },
    })
  }

  const handleCoverPointerUp = (e) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== e.pointerId) return

    if (session.captureEl?.hasPointerCapture?.(e.pointerId)) {
      session.captureEl.releasePointerCapture(e.pointerId)
    }
    clearLongPressTimer()

    if (!session.activated) {
      dragSessionRef.current = null
      return
    }

    // A drag with travel usually produces no synthesized click, which
    // would otherwise leave suppressClickRef stuck true and eat the
    // next genuine tap. Swallow this turn's click (if any), then
    // re-enable. ListDetail relies on its inner onClick to clear the
    // flag; we also reset here because Library has no second handler.
    setTimeout(() => { suppressClickRef.current = false }, 0)

    const { gameId, armed, previousStatus, gameSnapshot } = session

    if (armed && gameSnapshot && previousStatus) {
      setRemovingGameId(gameId)
      setTimeout(() => {
        setRemovingGameId(null)
        hardResetDrag(gameId)
        commitRemoveViaDrag(gameSnapshot, previousStatus)
      }, reducedMotion ? 0 : REMOVE_ANIM_MS)
      return
    }

    hardResetDrag(gameId)
  }

  const handleCoverPointerCancel = (e) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== e.pointerId) return
    if (session.captureEl?.hasPointerCapture?.(e.pointerId)) {
      session.captureEl.releasePointerCapture(e.pointerId)
    }
    setRemovingGameId(null)
    hardResetDrag(session.gameId)
  }

  // Leaving My Games (or unmounting) must restore the nav — same safety
  // net BottomNav already has on route change, applied to the in-page
  // Lists / My Games tab switch which does not change the route.
  useEffect(() => {
    if (isGamesTab) return
    const session = dragSessionRef.current
    if (!session) return
    clearLongPressTimer()
    const el = itemEls.current[session.gameId]
    if (el) {
      el.style.transform = ''
      el.style.transition = ''
    }
    dragSessionRef.current = null
    setDragGameId(null)
    setTrashArmed(false)
    setRemovingGameId(null)
    window.dispatchEvent(
      new CustomEvent(LIST_REORDER_DRAG_EVENT, { detail: { active: false } })
    )
  }, [isGamesTab])

  useEffect(() => {
    return () => {
      clearLongPressTimer()
      window.dispatchEvent(
        new CustomEvent(LIST_REORDER_DRAG_EVENT, { detail: { active: false } })
      )
    }
  }, [])

  // ── Lists-tab render helpers ──────────────────────────────────────────────

  // Fanned poster stack for a list tile / hero — ListCoverCluster's
  // "poster" variant (true --cover-ratio plates, up to 3, center on top
  // and larger, outer two fanned -9deg/+9deg). It takes the list's first
  // 3 games in list order (the same `position`-ordered slice listService
  // already returns, and the same order the old mosaic sampled), so the
  // stack matches whatever order the list itself is kept in — reordering
  // a list's games updates its own card stack too.
  const renderCoverStack = (list) => (
    <ListCoverCluster
      games={list.games}
      coverImageUrl={list.coverImageUrl}
      name={list.name}
      variant="poster"
    />
  )

  const listMeta = (list) => {
    const games = `${list.gameCount} ${list.gameCount === 1 ? 'game' : 'games'}`
    const saves = saveCounts.get(list.id) || 0
    // Saves are only mentioned once at least one exists — a "0 saves" label
    // is noise on a brand-new list.
    return saves > 0 ? `${games} · ${saves} ${saves === 1 ? 'save' : 'saves'}` : games
  }

  const renderPinnedHero = (list) => (
    <button
      type="button"
      className="lib-pin-hero"
      onClick={() => navigate(`/list/${list.id}`)}
      aria-label={`Open pinned list ${list.name} (${listMeta(list)})`}
    >
      <div className="lib-pin-hero-stack">{renderCoverStack(list)}</div>
      <span className="lib-pin-hero-body">
        <span className="lib-pin-hero-tag" aria-hidden="true">◆ Pinned</span>
        <span className="lib-pin-hero-name">{list.name}</span>
        <span className="lib-pin-hero-meta">{listMeta(list)}</span>
      </span>
    </button>
  )

  const renderListCard = (list) => (
    <button
      key={list.id}
      type="button"
      className="lib-list-card"
      onClick={() => navigate(`/list/${list.id}`)}
      aria-label={`Open list ${list.name} (${listMeta(list)})`}
    >
      <div className="lib-list-card-stack">{renderCoverStack(list)}</div>
      <span className="lib-list-card-body">
        <span className="lib-list-card-name">{list.name}</span>
        <span className="lib-list-card-meta">{listMeta(list)}</span>
      </span>
    </button>
  )

  const renderListsTab = () => {
    if (isLoadingLists) {
      return (
        <div className="lib-lists-grid" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="lib-list-card lib-list-card--skeleton">
              <div className="lib-list-card-stack">
                <div className="skeleton lib-stack-skeleton" />
              </div>
              <span className="lib-list-card-body">
                <span className="skeleton lib-sk-name" />
                <span className="skeleton lib-sk-meta" />
              </span>
            </div>
          ))}
        </div>
      )
    }

    if (errorLists) {
      return (
        <div className="lib-lists-error">
          <InlineErrorBanner message="Couldn't load your lists. Tap to retry." onRetry={loadCustomLists} />
        </div>
      )
    }

    if (customLists.length === 0) {
      // Single centered empty state — no pinned section, no grid.
      return (
        <div className="lib-lists-empty">
          <EmptyState
            icon={List}
            title="No lists yet"
            cta="New list"
            onCta={() => setShowCreateModal(true)}
          />
        </div>
      )
    }

    // Exactly one hero: the most-recently-pinned list (pinnedLists[0]).
    // Everything else — including any OTHER pinned lists — falls through to
    // the "All lists" grid below; pinning a list never hides it entirely.
    const heroList = pinnedLists[0] || null
    const restLists = heroList ? customLists.filter((l) => l.id !== heroList.id) : customLists

    return (
      <>
        {heroList && (
          <>
            <p className="lib-sec-label">Pinned</p>
            {renderPinnedHero(heroList)}
          </>
        )}

        {restLists.length > 0 && (
          <>
            <p className="lib-sec-label">All lists</p>
            <div className="lib-lists-grid">{restLists.map(renderListCard)}</div>
          </>
        )}
      </>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SharedCoverScope duplicateIds={duplicateIds}>
      <PullToRefresh onRefresh={handlePullToRefresh}>
      <div className="library-page">
        {/* Ambient wash — behind the top 300px only, themed per tab. Purely
            decorative: never intercepts taps, never washes over cards.
            Both tints are always mounted and crossfade via opacity (see
            .lib-ambient-wash--on in Library.css) so the cobalt→green ↔
            purple shift reads as a deliberate 220ms transition instead of
            a hard cut when the tab changes. */}
        <div
          className={`lib-ambient-wash lib-ambient-wash--games${isGamesTab ? ' lib-ambient-wash--on' : ''}`}
          aria-hidden="true"
        />
        <div
          className={`lib-ambient-wash lib-ambient-wash--lists${!isGamesTab ? ' lib-ambient-wash--on' : ''}`}
          aria-hidden="true"
        />

        <header className="lib-header">
          <h1 className="lib-title">Library</h1>
          <button
            type="button"
            className="lib-avatar-btn"
            onClick={() => navigate('/profile')}
            aria-label="Open your profile"
          >
            <Avatar user={avatarUser} size="sm" />
          </button>
        </header>

        <div className="lib-seg" role="tablist" aria-label="Library view">
          <button
            type="button"
            role="tab"
            id="lib-tab-games"
            aria-selected={isGamesTab}
            aria-controls="lib-panel-games"
            className={`lib-segb${isGamesTab ? ' lib-segb--games-on' : ''}`}
            onClick={() => setActiveTab('games')}
          >
            My Games
            <span className="lib-seg-n">{combinedGames.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="lib-tab-lists"
            aria-selected={!isGamesTab}
            aria-controls="lib-panel-lists"
            className={`lib-segb${!isGamesTab ? ' lib-segb--lists-on' : ''}`}
            onClick={() => setActiveTab('lists')}
          >
            Lists
            <span className="lib-seg-n">{customLists.length}</span>
          </button>
        </div>

        {isGamesTab ? (
          <div id="lib-panel-games" role="tabpanel" aria-labelledby="lib-tab-games" className="lib-tabpanel">
            <div className="lib-search">
              <SearchIcon size={15} className="lib-search-icon" aria-hidden="true" />
              <input
                type="text"
                className="lib-search-input"
                placeholder="Search your library"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search your library by title"
              />
            </div>

            <div className="lib-statbar">
              {STATUS_CELLS.map((cell) => {
                const active = activeStatus === cell.key
                const count = counts[cell.key] ?? 0
                const isEmpty = count === 0
                return (
                  <button
                    key={cell.key}
                    type="button"
                    aria-pressed={active}
                    className={`lib-statcell lib-statcell--${cell.key}${active ? ' lib-statcell--active' : ''}${isEmpty ? ' lib-statcell--empty' : ''}`}
                    onClick={() => handleStatusTap(cell.key)}
                  >
                    <span className="lib-statcell-num">{count}</span>
                    <span className="lib-statcell-lbl">{cell.label}</span>
                    <span className="lib-statcell-bar" aria-hidden="true" />
                  </button>
                )
              })}
            </div>

            <div className="lib-sortrow">
              <span className="lib-sortrow-count">
                {sortedGames.length} {sortedGames.length === 1 ? 'game' : 'games'}
              </span>
              <button
                type="button"
                className="lib-sortrow-btn"
                onClick={() => setShowSortSheet(true)}
                aria-label={`Sort games (currently ${sortLabel})`}
              >
                {sortLabel}
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            </div>

            <section className="lib-grid-section" aria-label="Your games">
              {combinedGames.length === 0 ? (
                // My Games stays tracker+list-scoped by design (reviews for
                // untracked games intentionally don't appear as cards here —
                // see smart-list scoping notes elsewhere in the codebase).
                // But a user who has posted reviews without tracking
                // anything is not the same as a brand-new user with no data
                // at all, so the copy must not claim "no games" in a way
                // that reads as if their reviews don't exist or didn't
                // count. This is the one branch this screen actually needs.
                <EmptyState
                  icon={List}
                  size="compact"
                  title={hasReviews ? 'Nothing tracked yet' : 'No games tracked yet'}
                  body={
                    hasReviews
                      ? "Your reviews are saved and live independently of your library. Set a status on a game to start tracking it here."
                      : 'Search for a game and set a status to start your library.'
                  }
                  cta="Find games"
                  onCta={() => navigate('/search')}
                />
              ) : sortedGames.length === 0 ? (
                <EmptyState
                  icon={FilterX}
                  size="compact"
                  body="No games match this filter."
                  cta="Clear filter"
                  ctaVariant="secondary"
                  onCta={() => {
                    setActiveStatus(null)
                    setSearchQuery('')
                  }}
                />
              ) : (
                <>
                  <div
                    className={`lib-grid3${dragGameId != null ? ' lib-grid3--dragging' : ''}`}
                    ref={gridRef}
                  >
                    {visibleGames.map((g) => {
                      const isDragged = dragGameId === g.id
                      const isRemoving = removingGameId === g.id
                      return (
                      <button
                        key={g.id}
                        ref={(el) => { if (el) itemEls.current[g.id] = el }}
                        type="button"
                        className={`lib-gamecard${isDragged ? ' lib-gamecard--dragged' : ''}`}
                        onPointerDown={(e) => handleCoverPointerDown(e, g)}
                        onPointerMove={handleCoverPointerMove}
                        onPointerUp={handleCoverPointerUp}
                        onPointerCancel={handleCoverPointerCancel}
                        onClick={() => {
                          if (suppressClickRef.current) {
                            suppressClickRef.current = false
                            return
                          }
                          navigate(`/game/${g.id}`)
                        }}
                        aria-label={g.title ? `Open ${g.title}` : 'Open game'}
                      >
                        <div
                          className={`lib-cov${
                            isRemoving
                              ? ' lib-cov--removing'
                              : isDragged
                                ? ` lib-cov--lifted${trashArmed ? ' lib-cov--armed' : ''}`
                                : ''
                          }`}
                        >
                          <SharedCover gameId={g.id} imageSrc={g.image || COVER_FALLBACK}>
                            <img
                              src={g.image || COVER_FALLBACK}
                              alt=""
                              className="lib-cov-img"
                              loading="lazy"
                              draggable={false}
                              onError={(e) => { e.target.src = COVER_FALLBACK }}
                            />
                          </SharedCover>
                        </div>
                        <p className="lib-gamecard-title">{g.title || '—'}</p>
                      </button>
                      )
                    })}
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
            </section>
          </div>
        ) : (
          <div id="lib-panel-lists" role="tabpanel" aria-labelledby="lib-tab-lists" className="lib-lists-panel lib-tabpanel">
            {renderListsTab()}
          </div>
        )}

        {/* Floating action — opens the same CreateListModal flow via the same
            handler. Portaled straight to <body> rather than rendered in
            place: every page is wrapped in PageTransition's motion.div,
            which sets a persistent inline `transform` (even at rest) — per
            spec, that establishes a new containing block for any
            `position: fixed` descendant, so the FAB would be pinned to the
            (tall, scrollable) page instead of the viewport and drift
            off-screen as the page scrolls. Same reasoning already
            documented in App.jsx for SessionPill. */}
        {isGamesTab && (
          <ReorderTrashTarget
            visible={dragGameId != null}
            armed={trashArmed}
            barRef={trashBarRef}
          />
        )}

        {createPortal(
          <button
            type="button"
            className={`lib-fab lib-fab--${isGamesTab ? 'games' : 'lists'}${
              dragGameId != null ? ' lib-fab--hidden' : ''
            }`}
            onClick={() => setShowCreateModal(true)}
            aria-label="Create new list"
          >
            {/* Two stacked gradient layers crossfade via opacity (see
                .lib-fab-bg in Library.css) so the cobalt→green ↔ purple
                shift reads as a deliberate transition, not a hard cut. */}
            <span className="lib-fab-bg lib-fab-bg--games" aria-hidden="true" />
            <span className="lib-fab-bg lib-fab-bg--lists" aria-hidden="true" />
            <Plus size={24} aria-hidden="true" />
          </button>,
          document.body
        )}

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
      </PullToRefresh>
    </SharedCoverScope>
  )
}

export default Library

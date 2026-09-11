import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { List, Plus, FilterX } from 'lucide-react'
import { useAutoAnimateMotion, useMotionPreference } from '../hooks/useMotionPreference'
import { useAuth } from '../contexts/AuthContext'
import CreateListModal from '../components/CreateListModal'
import EmptyState from '../components/EmptyState'
import PullToRefresh from '../components/PullToRefresh'
import Avatar from '../components/Avatar'
import { SharedCoverScope, findDuplicateGameIds } from '../components/SharedCover'
import { showToast } from '../components/Toast'
import ReorderTrashTarget from '../components/ReorderTrashTarget'
import { LIST_REORDER_DRAG_EVENT } from '../components/BottomNav'
import { hapticImpact, hapticSuccess } from '../utils/haptics'
import { initializeLibrary, getGamesFromList, clearGameStatus, setGameStatus } from '../services/libraryService'
import { getAllReviews } from '../services/reviewService'
import { getProfile } from '../services/profileService'
import {
  getListsForUser,
  getSaveCountsForLists,
  createList,
  addGameToList,
  LIST_PIN_CHANGED_EVENT,
} from '../services/listService'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import { STATUS_CELLS, LIBRARY_SORTS, LIBRARY_PAGE_SIZE } from '../components/library/libraryConstants'
import LibraryAmbientWash from '../components/library/LibraryAmbientWash'
import LibraryHeader from '../components/library/LibraryHeader'
import LibraryTabs from '../components/library/LibraryTabs'
import LibraryStatBar from '../components/library/LibraryStatBar'
import LibrarySortRow from '../components/library/LibrarySortRow'
import LibrarySortSheet from '../components/library/LibrarySortSheet'
import LibraryGameGrid, { LibraryGameCard } from '../components/library/LibraryGameGrid'
import LibraryListsPanel from '../components/library/LibraryListsPanel'
import {
  useLibrarySearch,
  LibrarySearchToggle,
  LibrarySearchPanel,
} from '../components/library/LibrarySearch'
import './Library.css'

const PAGE_SIZE = LIBRARY_PAGE_SIZE

// Same long-press / move-cancel gates as ListDetail's custom-list
// drag-to-trash path. Library only uses the trash branch — no reorder.
const LONG_PRESS_MS = 450
const MOVE_CANCEL_PX = 8
const REMOVE_ANIM_MS = 280
const GRID_REFLOW_MS = 250
// Must match ReorderTrashTarget.css slide-in transition duration.
const TRASH_ENTER_MS = 220

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
  const {
    open: searchOpen,
    query: searchQuery,
    setQuery: setSearchQuery,
    toggle: toggleSearch,
    clear: clearSearch,
    inputRef: searchInputRef,
  } = useLibrarySearch()
  const [sortKey, setSortKey] = useState('recent')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const [gridRef] = useAutoAnimateMotion({ duration: GRID_REFLOW_MS })
  const { reduced: reducedMotion } = useMotionPreference()

  // Long-press drag-to-trash (My Games covers with a tracker status).
  // Pointer Events only — same contract as ListDetail's custom-list
  // path. No reorder / slot swapping lives here.
  const [dragGameId, setDragGameId] = useState(null)
  const [trashArmed, setTrashArmed] = useState(false)
  const [removingGameId, setRemovingGameId] = useState(null)
  const [restoringGameId, setRestoringGameId] = useState(null)

  const itemEls = useRef({})
  const coverEls = useRef({})
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
  const sortLabel = LIBRARY_SORTS.find((s) => s.key === sortKey)?.label || 'Recent'

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
    el.style.willChange = 'transform'
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
  }

  const scheduleDragTransform = (session, dx, dy) => {
    session.pendingDx = dx
    session.pendingDy = dy
    if (session.rafId != null) return
    session.rafId = requestAnimationFrame(() => {
      session.rafId = null
      if (dragSessionRef.current !== session || !session.activated) return
      applyDragTransform(session.gameId, session.pendingDx, session.pendingDy)
    })
  }

  const cacheTrashRect = (session) => {
    if (session.trashRect) return session.trashRect
    const trashEl = trashBarRef.current
    // Bubble must be visible and settled — measuring while it is still
    // off-screen (pre-slide or mid-transition) caches a wrong rect and
    // the armed hit test never fires.
    if (!trashEl?.classList.contains('reorder-trash-target--visible')) return null
    session.trashRect = trashEl.getBoundingClientRect()
    return session.trashRect
  }

  const measureTrashRectOnce = (session) => {
    if (session.trashRect) return session.trashRect
    const slideMs = reducedMotion ? 0 : TRASH_ENTER_MS
    if (Date.now() - (session.activatedAt ?? 0) < slideMs) return null
    return cacheTrashRect(session)
  }

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const hardResetDrag = (gameId, { clearTransform = true } = {}) => {
    clearLongPressTimer()
    const session = dragSessionRef.current
    if (session?.rafId != null) {
      cancelAnimationFrame(session.rafId)
      session.rafId = null
    }
    const el = gameId != null ? itemEls.current[gameId] : null
    if (el && clearTransform) {
      el.style.transform = ''
      el.style.transition = ''
      el.style.willChange = ''
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

      const startRect = coverEls.current[game.id]?.getBoundingClientRect()
      if (!startRect) {
        dragSessionRef.current = null
        return
      }

      session.activated = true
      session.startRect = startRect
      session.trashRect = null
      session.rafId = null
      session.activatedAt = Date.now()
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
    scheduleDragTransform(session, dx, dy)

    const trashRect = measureTrashRectOnce(session)
    if (!trashRect) return

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
        setRestoringGameId(game.id)
        const restored = setGameStatus(game.id, previousStatus, game)
        if (!restored) {
          setRestoringGameId(null)
          showToast("Couldn't restore the game. Please try again.", 'error')
          return
        }
        setTimeout(() => {
          setRestoringGameId((current) => (current === game.id ? null : current))
        }, reducedMotion ? 0 : REMOVE_ANIM_MS)
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
      // Keep the lifted translate3d in place — hardResetDrag must not
      // snap the cover back to its grid slot while the remove-out runs.
      setRemovingGameId(gameId)
      setTimeout(() => {
        commitRemoveViaDrag(gameSnapshot, previousStatus)
        hardResetDrag(gameId, { clearTransform: false })
        setRemovingGameId(null)
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
  // Cache the trash bubble's hit rect once its slide-in finishes. Measuring
  // earlier captures the off-screen position and the armed test never fires.
  useEffect(() => {
    if (dragGameId == null) return undefined

    const el = trashBarRef.current
    if (!el) return undefined

    let settled = false
    const settleTrashRect = () => {
      if (settled) return
      settled = true
      const session = dragSessionRef.current
      if (session?.gameId === dragGameId) cacheTrashRect(session)
    }

    const onTransitionEnd = (e) => {
      if (e.target === el && e.propertyName === 'transform') settleTrashRect()
    }
    el.addEventListener('transitionend', onTransitionEnd)

    if (reducedMotion) {
      requestAnimationFrame(() => requestAnimationFrame(settleTrashRect))
    } else {
      setTimeout(settleTrashRect, TRASH_ENTER_MS + 32)
    }

    return () => {
      settled = true
      el.removeEventListener('transitionend', onTransitionEnd)
    }
  }, [dragGameId, reducedMotion])

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
        <LibraryAmbientWash isGamesTab={isGamesTab} />

        <LibraryHeader
          title="Library"
          actions={
            <>
              <LibrarySearchToggle open={searchOpen} onToggle={toggleSearch} />
              <button
                type="button"
                className="lib-avatar-btn"
                onClick={() => navigate('/profile')}
                aria-label="Open your profile"
              >
                <Avatar user={avatarUser} size="sm" />
              </button>
            </>
          }
        />
        <LibrarySearchPanel
          open={searchOpen}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onClear={clearSearch}
          inputRef={searchInputRef}
        />

        <LibraryTabs
          activeTab={activeTab}
          gamesCount={combinedGames.length}
          listsCount={customLists.length}
          onTabChange={setActiveTab}
        />

        {isGamesTab ? (
          <div id="lib-panel-games" role="tabpanel" aria-labelledby="lib-tab-games" className="lib-tabpanel">
            <LibraryStatBar
              counts={counts}
              activeStatus={activeStatus}
              onStatusTap={handleStatusTap}
            />

            <LibrarySortRow
              count={sortedGames.length}
              sortLabel={sortLabel}
              onSortClick={() => setShowSortSheet(true)}
            />

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
                    clearSearch()
                  }}
                />
              ) : (
                <LibraryGameGrid
                  games={visibleGames}
                  gridRef={gridRef}
                  dragging={dragGameId != null}
                  hasMore={hasMore}
                  onLoadMore={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  ariaLabel="Your games"
                  renderCard={(g) => {
                    const isDragged = dragGameId === g.id
                    const isRemoving = removingGameId === g.id
                    const isRestoring = restoringGameId === g.id
                    return (
                      <LibraryGameCard
                        key={g.id}
                        game={g}
                        cardRef={(el) => { if (el) itemEls.current[g.id] = el }}
                        coverRef={(el) => { if (el) coverEls.current[g.id] = el }}
                        cardClassName={`${
                          isDragged ? 'lib-gamecard--dragged' : ''
                        }${isRemoving ? ' lib-gamecard--removing' : ''}${
                          isRestoring ? ' lib-gamecard--restoring' : ''
                        }`}
                        coverClassName={
                          isRemoving
                            ? 'lib-cov--removing'
                            : isDragged
                              ? `lib-cov--lifted${trashArmed ? ' lib-cov--armed' : ''}`
                              : ''
                        }
                        onClick={() => {
                          if (suppressClickRef.current) {
                            suppressClickRef.current = false
                            return
                          }
                          navigate(`/game/${g.id}`)
                        }}
                        onCoverPointerDown={(e) => handleCoverPointerDown(e, g)}
                        onCoverPointerMove={handleCoverPointerMove}
                        onCoverPointerUp={handleCoverPointerUp}
                        onCoverPointerCancel={handleCoverPointerCancel}
                      />
                    )
                  }}
                />
              )}
            </section>
          </div>
        ) : (
          <div id="lib-panel-lists" role="tabpanel" aria-labelledby="lib-tab-lists" className="lib-lists-panel lib-tabpanel">
            <LibraryListsPanel
              lists={customLists}
              pinnedLists={pinnedLists}
              saveCounts={saveCounts}
              isLoading={isLoadingLists}
              error={errorLists}
              onRetry={loadCustomLists}
              onOpenList={(list) => navigate(`/list/${list.id}`)}
              empty={
                <EmptyState
                  icon={List}
                  title="No lists yet"
                  cta="New list"
                  onCta={() => setShowCreateModal(true)}
                />
              }
            />
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

        <LibrarySortSheet
          isOpen={showSortSheet}
          onClose={() => setShowSortSheet(false)}
          sortKey={sortKey}
          onSelect={setSortKey}
        />
      </div>
      </PullToRefresh>
    </SharedCoverScope>
  )
}

export default Library

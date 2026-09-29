import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAutoAnimateMotion, useMotionPreference } from '../hooks/useMotionPreference'
import { LuChevronLeft } from 'react-icons/lu'
import { HiDotsVertical, HiPlus } from 'react-icons/hi'
import {
  ChevronLeft,
  ChevronDown,
  Plus,
  MoreHorizontal,
  PlayCircle,
  CheckCircle2,
  Bookmark,
  List,
  Pencil,
} from 'lucide-react'
import LibrarySortSheet from '../components/library/LibrarySortSheet'
import {
  LIBRARY_SORTS,
  readLibraryView,
  writeLibraryView,
} from '../components/library/libraryConstants'
import LibraryGameGrid, { LibraryGameRow } from '../components/library/LibraryGameGrid'
import SharedCover from '../components/SharedCover'
import Pressable from '../components/Pressable'
import { getBestImageUrl } from '../services/imageUtils'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { getGameNavStub } from '../utils/gameNavStub'
import AddGamesModal from '../components/AddGamesModal'
import ActionSheet from '../components/ActionSheet'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import ReportSheet from '../components/ReportSheet'
import EmptyState from '../components/EmptyState'
import { showToast } from '../components/Toast'
import InlineErrorBanner from '../components/InlineErrorBanner'
import ReorderTrashTarget from '../components/ReorderTrashTarget'
import { LIST_REORDER_DRAG_EVENT } from '../components/BottomNav'
import { hapticImpact, hapticSuccess } from '../utils/haptics'
import {
  getListInfo,
  getGamesFromList,
} from '../services/libraryService'
import {
  getListById,
  createList,
  addGameToList,
  deleteList,
  removeGameFromList,
  reorderListGames,
  isTrackerList,
  pinList,
  unpinList,
  updateList,
} from '../services/listService'
import CollaboratorSheet from '../components/CollaboratorSheet'
import DmShareSheet from '../components/DmShareSheet'
import {
  getListSaveState,
  saveList,
  unsaveList,
} from '../services/listInteractionService'
import ListComments from '../components/ListComments'
import { useHideNav } from '../hooks/useHideNav'
import TrackerGameList from '../components/TrackerGameList'
import { supabase } from '../services/supabase'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import { getSWR, peekSWR } from '../services/swrCache'
import {
  hasSeenClearModeHint,
  markClearModeHintSeen,
} from '../services/listClearMode'
import { useSwipeBackBlock } from '../hooks/useSwipeBackBlock'

/** How long a list's contents are reused before the next entry revalidates. */
const LIST_TTL_MS = 60 * 1000
import './ListDetail.css'
import '../pages/Library.css'

// ── Long-press drag-to-reorder tuning ───────────────────────────────────
const LONG_PRESS_MS = 450
const MOVE_CANCEL_PX = 8
const REORDER_SETTLE_MS = 200
const REMOVE_ANIM_MS = 200

// ── Client-side pagination (custom list game grid) ──────────────────────
// A list's `games` array is loaded in full up front (no server paging),
// but very long lists (hundreds of games) shouldn't render every cover
// at once. GAMES_PAGE_SIZE caps the initial/incremental render; drag-
// reorder only ever operates on the currently-rendered (visible) prefix
// — see commitReorder, which re-appends the not-yet-revealed tail
// unchanged after the reordered visible games.
const GAMES_PAGE_SIZE = 60

// Returns the index of the grid slot (from a snapshot of rects taken at
// drag start) whose bounds contain (x, y), or -1 if the point isn't over
// any slot — e.g. the pointer has moved down into the trash target.
function findSlotIndexAtPoint(x, y, slotRects) {
  for (let i = 0; i < slotRects.length; i++) {
    const r = slotRects[i]
    if (!r) continue
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i
  }
  return -1
}

/* ── Context-aware empty state for tracker and custom list pages ── */
const TRACKER_EMPTY = {
  'currently-playing': {
    icon: PlayCircle,
    title: 'Your Playing list is empty.',
    body: 'Mark a game as Playing to start tracking your session here.',
    cta: 'Add a game',
    useAddGames: true,
  },
  'played': {
    icon: CheckCircle2,
    title: 'No games logged yet.',
    body: "Add games you've finished to track them here.",
    cta: 'Add a game',
    useAddGames: true,
  },
  'want-to-play': {
    icon: Bookmark,
    title: 'Your backlog is empty.',
    body: 'Save games to your backlog.',
    cta: 'Find games',
    useAddGames: false,
  },
}

function ListDetailEmpty({ listId, isTracker, onAddGames, onFindGames }) {
  if (isTracker && TRACKER_EMPTY[listId]) {
    const cfg = TRACKER_EMPTY[listId]
    return (
      <div className="list-detail-empty">
        <EmptyState
          icon={cfg.icon}
          title={cfg.title}
          body={cfg.body}
          cta={cfg.cta}
          onCta={cfg.useAddGames ? onAddGames : onFindGames}
        />
      </div>
    )
  }
  return (
    <div className="list-detail-empty">
      <EmptyState
        icon={List}
        title="No games in this list."
        body="Games added to this list will appear here."
      />
    </div>
  )
}

function measureClearModeChromeHeight(pageEl) {
  if (!pageEl) return 0
  let total = 0
  pageEl.querySelectorAll('.ld-clear-mode-chrome').forEach((node) => {
    total += node.offsetHeight
  })
  return total
}

function ListDetail() {
  const { listId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [gridRef] = useAutoAnimateMotion()
  // Seed from the shared cache so re-opening a list the user just backed
  // out of paints the real list on the first frame instead of a skeleton.
  const cachedList = peekSWR(`list:${listId}`)
  const [listInfo, setListInfo] = useState(cachedList ?? null)
  const [games, setGames] = useState(cachedList?.games || [])
  const [isLoading, setIsLoading] = useState(cachedList === undefined)
  const [loadError, setLoadError] = useState(false)
  const [showActionSheet, setShowActionSheet] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAddGames, setShowAddGames] = useState(false)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [reportSheetOpen, setReportSheetOpen] = useState(false)
  const [dmShareOpen, setDmShareOpen] = useState(false)
  const [collaborators, setCollaborators] = useState(cachedList?.collaborators || [])
  const [showCollaboratorSheet, setShowCollaboratorSheet] = useState(false)

  // ── Pagination (custom list game grid only — see GAMES_PAGE_SIZE) ────────
  const [visibleGamesCount, setVisibleGamesCount] = useState(GAMES_PAGE_SIZE)
  const gamesSentinelRef = useRef(null)

  // Save state (public custom lists)
  const [saveCount, setSaveCount] = useState(0)
  const [isSaved, setIsSaved] = useState(false)

  // ── Long-press drag-to-reorder + slide-up trash target (custom lists,
  // owner/collaborator only). Built entirely on Pointer Events — there
  // is no HTML5 drag-and-drop anywhere in this interaction, since
  // dragstart/dragover/drop never fire for touch input inside a
  // Capacitor/WKWebView app (iPhone is the test target). ──
  const [dragGameId, setDragGameId] = useState(null) // id of the lifted cover, or null
  const [dragOrder, setDragOrder] = useState(null) // live id order while dragging, or null
  const [trashArmed, setTrashArmed] = useState(false) // dragged cover is over the trash target
  const [removingGameId, setRemovingGameId] = useState(null) // id mid remove-out animation

  const itemEls = useRef({}) // gameId -> .gg-item DOM node
  const trashBarRef = useRef(null) // .reorder-trash-target DOM node
  const dragSessionRef = useRef(null) // mutable per-session data — see handleCoverPointerDown
  const longPressTimerRef = useRef(null)
  const suppressClickRef = useRef(false) // set true when a long-press activates, so the
  // resulting pointerup's synthesized click doesn't also navigate
  const { reduced: reducedMotion } = useMotionPreference()

  // Inline description editing
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const descTextareaRef = useRef(null)

  const isTracker = isTrackerList(listId)

  // Custom lists render a comment composer (ListComments, below the game
  // grid) — tracker lists (Backlog/Playing/Played/Dropped) never do.
  // Hide the nav only for the former, and only once we actually know the
  // list is custom, so it's restored automatically on unmount/navigation.
  // In clear mode the nav stays hidden; restored automatically on unmount.
  // See src/hooks/useHideNav.js.
  const [isClearMode, setIsClearMode] = useState(false)
  const [clearHintVisible, setClearHintVisible] = useState(false)
  const [clearHintFading, setClearHintFading] = useState(false)
  const clearHintShownRef = useRef(false)
  const pageRef = useRef(null)
  const clearScrollAdjustRef = useRef(null)
  const [clearGridFade, setClearGridFade] = useState(false)
  const prevClearModeRef = useRef(false)

  useHideNav(!!listInfo?.isCustom)
  useSwipeBackBlock(isClearMode)

  useEffect(() => {
    setIsClearMode(false)
    setClearHintVisible(false)
    setClearHintFading(false)
  }, [listId])

  useEffect(() => {
    if (!isClearMode) {
      setClearHintVisible(false)
      setClearHintFading(false)
      return undefined
    }
    if (hasSeenClearModeHint() || clearHintShownRef.current) return undefined
    clearHintShownRef.current = true
    markClearModeHintSeen()
    setClearHintVisible(true)
    setClearHintFading(false)
    if (reducedMotion) {
      setClearHintVisible(false)
      return undefined
    }
    const holdMs = 2000
    const fadeMs = 300
    const fadeStart = setTimeout(() => setClearHintFading(true), holdMs)
    const hide = setTimeout(() => setClearHintVisible(false), holdMs + fadeMs)
    return () => {
      clearTimeout(fadeStart)
      clearTimeout(hide)
    }
  }, [isClearMode, reducedMotion])

  useLayoutEffect(() => {
    const pending = clearScrollAdjustRef.current
    if (!pending) return
    const scrollEl = pageRef.current?.closest('.main-content')
    if (!scrollEl) {
      clearScrollAdjustRef.current = null
      return
    }
    if (pending.phase === 'enter' && isClearMode) {
      scrollEl.scrollTop = Math.max(0, pending.priorScrollTop - pending.chromeH)
    } else if (pending.phase === 'exit' && !isClearMode) {
      const chromeH = measureClearModeChromeHeight(pageRef.current)
      scrollEl.scrollTop = pending.scrollTopBeforeExit + chromeH
    }
    clearScrollAdjustRef.current = null
  }, [isClearMode])

  useEffect(() => {
    const prev = prevClearModeRef.current
    prevClearModeRef.current = isClearMode
    if (prev === isClearMode || reducedMotion) return undefined
    setClearGridFade(true)
    const t = setTimeout(() => setClearGridFade(false), 220)
    return () => clearTimeout(t)
  }, [isClearMode, reducedMotion])

  const headerBarRef = useRef(null)

  // Sort + view — same controls and persistence as Library › My Games.
  const [sortKey, setSortKey] = useState('recent')
  const [viewKey, setViewKey] = useState(readLibraryView)
  const [showSortSheet, setShowSortSheet] = useState(false)

  const handleViewSelect = useCallback((key) => {
    setViewKey(key)
    writeLibraryView(key)
  }, [])

  const handleEnterClearMode = useCallback(() => {
    if (isTracker || isClearMode) return
    const chromeH = measureClearModeChromeHeight(pageRef.current)
    const scrollEl = pageRef.current?.closest('.main-content')
    clearScrollAdjustRef.current = {
      phase: 'enter',
      chromeH,
      priorScrollTop: scrollEl?.scrollTop ?? 0,
    }
    setIsClearMode(true)
  }, [isClearMode, isTracker])

  const handleClearModeExitCapture = useCallback(
    (e) => {
      if (!isClearMode) return
      e.preventDefault()
      e.stopPropagation()
      const scrollEl = pageRef.current?.closest('.main-content')
      clearScrollAdjustRef.current = {
        phase: 'exit',
        scrollTopBeforeExit: scrollEl?.scrollTop ?? 0,
      }
      setIsClearMode(false)
    },
    [isClearMode]
  )

  const openGame = useCallback((game, imageUrl) => {
    navigate(`/game/${game.id}`, {
      state: { ...getGameNavStub(game), coverImage: imageUrl },
    })
  }, [navigate])

  // ── Session ───────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUserId(user?.id ?? null)
    })
  }, [])

  // ── Data loading ──────────────────────────────────────────────────────────

  const refresh = useCallback(async ({ force = true } = {}) => {
    setLoadError(false)
    if (isTracker) {
      const info = getListInfo(listId)
      setListInfo(info)
      setGames(info ? getGamesFromList(listId) : [])
      setCollaborators([])
      setIsLoading(false)
    } else {
      try {
        const data = await getSWR(`list:${listId}`, () => getListById(listId), {
          ttlMs: LIST_TTL_MS,
          force,
        })
        setListInfo(data)
        setGames(data?.games || [])
        setCollaborators(data?.collaborators || [])
      } catch (err) {
        console.error('[list-detail] failed to load:', err)
        setLoadError(true)
      } finally {
        setIsLoading(false)
      }
    }
  }, [listId, isTracker])

  // Reset to the first page whenever a different list is opened or sort changes.
  useEffect(() => {
    setVisibleGamesCount(GAMES_PAGE_SIZE)
  }, [listId, sortKey])

  useEffect(() => {
    // Mount reads through the cache; the events below mean the list really
    // did change, so those force a fetch.
    if (peekSWR(`list:${listId}`) === undefined) setIsLoading(true)
    refresh({ force: false })
    const handler = () => refresh({ force: true })
    window.addEventListener('libraryUpdated', handler)
    // A collaborative list can change while the app is backgrounded; refresh()
    // also re-derives the owner-ratings / save-state effects downstream.
    window.addEventListener(APP_RESUMED_EVENT, handler)
    return () => {
      window.removeEventListener('libraryUpdated', handler)
      window.removeEventListener(APP_RESUMED_EVENT, handler)
    }
  }, [refresh, listId])

  // Reveal another page of games once the sentinel below the grid comes
  // into view. Drag-reorder deliberately only ever operates on this
  // visible slice — see commitReorder.
  const sortedGames = useMemo(() => {
    const list = [...games]
    if (sortKey === 'title') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    }
    return list
  }, [games, sortKey])

  const visibleGames = sortedGames.slice(0, visibleGamesCount)
  const hasMoreGames = sortedGames.length > visibleGames.length

  useEffect(() => {
    if (!hasMoreGames) return undefined
    const node = gamesSentinelRef.current
    if (!node) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleGamesCount((c) => c + GAMES_PAGE_SIZE)
        }
      },
      { rootMargin: '800px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMoreGames])

  // Derived: can the current user edit this list's cover?
  const isOwner =
    listInfo?.isCustom &&
    currentUserId != null &&
    currentUserId === listInfo?.userId

  const isCollaborator =
    !isOwner &&
    currentUserId != null &&
    collaborators.some((c) => c.userId === currentUserId)

  // Library list-card long-press → "Add/Edit description" lands here with
  // location.state.editDescription so we open the existing masthead editor
  // rather than inventing a second one. Consumed via ref — do not
  // replace-navigate to clear state; that remounts this page and loses
  // the editor we just opened.
  const openedDescFromNavRef = useRef(false)
  useEffect(() => {
    openedDescFromNavRef.current = false
  }, [listId])
  useEffect(() => {
    if (openedDescFromNavRef.current) return
    if (!location.state?.editDescription || !isOwner || !listInfo) return
    openedDescFromNavRef.current = true
    setDescDraft(listInfo.description || '')
    setEditingDesc(true)
  }, [location.state, isOwner, listInfo])

  // ── Save state (public custom lists) ─────────────────────────────────────

  useEffect(() => {
    if (isTracker || !listInfo?.isCustom || !listInfo?.isPublic) return
    getListSaveState(listId, currentUserId).then(({ count, saved }) => {
      setSaveCount(count)
      setIsSaved(saved)
    })
  }, [listId, listInfo?.isCustom, listInfo?.isPublic, currentUserId, isTracker])

  const handleSaveToggle = async () => {
    if (!currentUserId) return
    const wasSaved = isSaved
    hapticImpact('Light')
    setIsSaved(!wasSaved)
    setSaveCount((c) => (wasSaved ? c - 1 : c + 1))
    try {
      if (wasSaved) {
        await unsaveList(listId)
        showToast('Removed from saved lists', 'success')
      } else {
        await saveList(listId)
        showToast('List saved', 'success')
      }
    } catch {
      setIsSaved(wasSaved)
      setSaveCount((c) => (wasSaved ? c + 1 : c - 1))
      showToast("Couldn't save — please try again.", 'error')
    }
  }

  // ── Pin state (own custom lists only) ────────────────────────────────────

  const [isPinned, setIsPinned] = useState(false)

  useEffect(() => {
    setIsPinned(listInfo?.isPinned ?? false)
  }, [listInfo?.isPinned])

  const handlePinToggle = async () => {
    if (!isOwner) return
    const wasPin = isPinned

    // Optimistic
    setIsPinned(!wasPin)

    try {
      if (wasPin) {
        await unpinList(listId)
        showToast('Unpinned', 'success')
      } else {
        await pinList(listId)
        showToast('Pinned to profile', 'success')
      }
    } catch (err) {
      setIsPinned(wasPin)
      if (err?.code === 'LIST_PINS_FULL') {
        showToast('You can only pin 5 lists. Unpin one first.', 'error')
      } else {
        showToast(
          wasPin ? "Couldn't unpin — please try again." : "Couldn't pin — please try again.",
          'error'
        )
      }
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDeleteConfirmed = async () => {
    if (!listInfo?.isCustom) return
    setShowDeleteConfirm(false)
    const name = listInfo.name
    try {
      await deleteList(listId)
      window.dispatchEvent(new Event('libraryUpdated'))
      navigate('/library', { replace: true })
      showToast(`Deleted \u201c${name}\u201d`, 'success', 3500)
    } catch {
      showToast('Failed to delete list. Please try again.', 'error')
    }
  }

  // ── Duplicate ─────────────────────────────────────────────────────────────

  const handleDuplicate = async () => {
    if (!listInfo?.isCustom) return
    try {
      const newId = await createList({
        name: `Copy of ${listInfo.name}`,
        description: listInfo.description || '',
        isPublic: listInfo.isPublic ?? true,
      })
      for (let i = 0; i < games.length; i++) {
        const g = games[i]
        await addGameToList(newId, g.id, i, { title: g.title, image: g.image })
      }
      window.dispatchEvent(new Event('libraryUpdated'))
      showToast(`Duplicated \u201c${listInfo.name}\u201d`, 'success', 3500)
      navigate(`/list/${newId}`)
    } catch {
      showToast('Failed to duplicate list. Please try again.', 'error')
    }
  }

  // ── Remove game ───────────────────────────────────────────────────────────
  // Removal now happens exclusively via the long-press drag-to-trash
  // interaction below (commitRemoveViaDrag), which calls removeGameFromList
  // the same way this used to — no removal entry point was dropped, just
  // relocated next to the interaction that replaces the old remove button.

  // ── Long-press drag-to-reorder + slide-up trash target ──────────────────
  // Pointer Events only (pointerdown/pointermove/pointerup/pointercancel).
  // There's no native drag session to lean on, so everything below — the
  // 450ms long-press gate, the lifted cover following the finger via
  // translate3d, siblings shifting to make room, and trash-target hit-
  // testing — is driven by raw pointer coordinates + manual
  // getBoundingClientRect() comparisons against a snapshot of slot rects
  // taken once per drag session (DOM order never changes mid-drag; every
  // visual shift is a transform overlay, committed to the real `games`
  // array only on release).

  const canDrag = isOwner || isCollaborator

  // Writes the .gg-item's positional transform directly to the DOM,
  // bypassing React state so the lifted cover can follow the pointer
  // every frame without a re-render. Cleared explicitly on release/cancel
  // (see hardResetDrag) since React never owns this inline style.
  const applyDragTransform = (gameId, dx, dy, transition) => {
    const el = itemEls.current[gameId]
    if (!el) return
    el.style.transition = transition || ''
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
  }

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  // Releases the synchronous pre-arm touch-action lock set in
  // handleCoverPointerDown. Called whenever a session ends before the
  // long-press arms (move-cancel gate, quick tap) as well as at full
  // session teardown — once armed, the class-based touch-action
  // (.game-grid--dragging) already covers the rest of the drag, so an
  // extra clear here is harmless. Mirrors My Games' releasePreArmLock
  // (Library.jsx) minus the PullToRefresh yield, which this page has no
  // equivalent of (ListDetail is not wrapped in <PullToRefresh>).
  const releasePreArmLock = (session) => {
    if (session?.captureEl) session.captureEl.style.touchAction = ''
  }

  // ── Scroll-container lock (armed drag only) ──────────────────────────────
  // Same fix as My Games (Library.jsx): touch-action: none on the cover
  // (pointerdown) and later via .game-grid--dragging only stops THIS
  // touch from starting a NEW pan on this element; it does nothing to an
  // already-in-flight momentum/deceleration animation on an ancestor
  // scroll view, which iOS can reassert control over mid-hold by
  // cancelling the pointer. `.main-content` (see App.jsx) is this app's
  // single scroll container — the same one the sticky-header-title
  // effect above already queries — so lock that, not something page-
  // local. overflow: hidden (not touch-action: none, not position:
  // fixed) is used because it actively halts an in-progress momentum
  // animation, not just future panning. scrollTop is captured before
  // locking and re-applied (not scrollTo, which can trigger smooth-
  // scroll behavior) on every unlock path so there is no visual jump.
  const scrollLockRef = useRef(null) // { el, scrollTop } while locked, else null

  const lockScrollContainer = (captureEl) => {
    if (scrollLockRef.current) return // already locked this session
    const scrollEl = captureEl?.closest('.main-content')
    if (!scrollEl) return
    const scrollTop = scrollEl.scrollTop
    scrollLockRef.current = { el: scrollEl, scrollTop }
    scrollEl.style.overflow = 'hidden'
    scrollEl.scrollTop = scrollTop
  }

  const unlockScrollContainer = () => {
    const lock = scrollLockRef.current
    if (!lock) return
    scrollLockRef.current = null
    lock.el.style.overflow = ''
    lock.el.scrollTop = lock.scrollTop
  }

  // ── Non-passive native touchmove backstop (armed drag only) ─────────────
  // Same backstop as My Games: WKWebView's handling of preventDefault()
  // called via a PointerEvent (vs. the underlying TouchEvent) has been
  // inconsistent across iOS versions. The scroll-container lock above no
  // longer depends on preventDefault working at all — once .main-content
  // is overflow: hidden there is nothing left to scroll — but this
  // native, explicitly non-passive touchmove listener is added as a
  // low-cost backstop for the whole armed hold anyway.
  const addNonPassiveTouchMoveBlock = (session) => {
    if (!session.captureEl || session.touchMoveBlockAdded) return
    session.touchMoveBlockAdded = true
    session.onNativeTouchMove = (te) => {
      if (te.cancelable) te.preventDefault()
    }
    session.captureEl.addEventListener('touchmove', session.onNativeTouchMove, {
      passive: false,
    })
  }

  const removeNonPassiveTouchMoveBlock = (session) => {
    if (!session?.touchMoveBlockAdded) return
    session.touchMoveBlockAdded = false
    session.captureEl?.removeEventListener('touchmove', session.onNativeTouchMove)
    session.onNativeTouchMove = null
  }

  // Full teardown — used on a clean release AND on pointercancel/system
  // interruption. Never calls reorderListGames/removeGameFromList itself;
  // callers commit those first if the release should persist a change.
  const hardResetDrag = (gameId) => {
    clearLongPressTimer()
    const session = dragSessionRef.current
    releasePreArmLock(session)
    removeNonPassiveTouchMoveBlock(session)
    unlockScrollContainer()
    const el = gameId != null ? itemEls.current[gameId] : null
    if (el) {
      el.style.transform = ''
      el.style.transition = ''
    }
    dragSessionRef.current = null
    setDragGameId(null)
    setDragOrder(null)
    setTrashArmed(false)
    window.dispatchEvent(
      new CustomEvent(LIST_REORDER_DRAG_EVENT, { detail: { active: false } })
    )
  }

  // iOS drag-to-reorder needs the same coordinated defenses as My Games
  // (Library.jsx) — do not strip any of them during refactors:
  //   1. user-select / touch-callout: none on .gg-item (ListDetail.css)
  //      — native text selection steals the touch and fires pointercancel.
  //   2. captureEl.style.touchAction = 'none' synchronously at pointerdown
  //      — must land this tick so UA gesture arbitration sees it at start.
  //   3. lockScrollContainer + non-passive touchmove on arm — ancestor
  //      scroll/momentum can reassert and cancel the pointer; React's
  //      passive touch listeners make preventDefault on synthetic pointer
  //      events unreliable in WKWebView, so both backstops stay.
  const handleCoverPointerDown = (e, gameId) => {
    if (!canDrag || isClearMode) return
    if (dragSessionRef.current) return // one drag session at a time

    const captureEl = e.currentTarget
    try {
      captureEl.setPointerCapture(e.pointerId)
    } catch {
      // Some engines can reject capture for a pointer id they don't
      // consider active. Harmless — the long-press timer below still
      // runs; without capture, pointermove/up just won't fire here if
      // the finger leaves this element's bounds before releasing.
    }

    // Synchronous, same-tick lock — must be set before this handler
    // returns so the UA's gesture arbitration sees it at gesture start,
    // not 450ms later via a class React hasn't rendered yet. Cleared in
    // releasePreArmLock if the hold turns out to be a scroll or a tap.
    captureEl.style.touchAction = 'none'

    const session = {
      gameId,
      pointerId: e.pointerId,
      captureEl,
      startClientX: e.clientX,
      startClientY: e.clientY,
      activated: false,
      armed: false,
      startRect: null,
      slotRects: null,
    }
    dragSessionRef.current = session

    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null
      if (dragSessionRef.current !== session) return

      const startRect = itemEls.current[gameId]?.getBoundingClientRect()
      if (!startRect) {
        dragSessionRef.current = null
        return
      }

      session.activated = true
      session.startRect = startRect
      // Only the currently-rendered (paginated) games have refs/slots —
      // see visibleGames / commitReorder for how the not-yet-revealed
      // tail is preserved on drop.
      session.slotRects = visibleGames.map(
        (g) => itemEls.current[g.id]?.getBoundingClientRect() || null
      )

      // Lock the actual scroll container now that the drag is genuinely
      // active — only here, on arm, never at pointerdown (see
      // lockScrollContainer above for why, and why a plain scroll must
      // stay completely unaffected until this point).
      lockScrollContainer(captureEl)
      addNonPassiveTouchMoveBlock(session)

      suppressClickRef.current = true
      setDragGameId(gameId)
      setDragOrder(visibleGames.map((g) => g.id))
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
      // Backs up the synchronous touch-action lock during iOS's gesture
      // arbitration window: a late (post-450ms) preventDefault can't undo
      // a scroll grab the UA already made, but an early one on the very
      // first move — while arbitration is still open — helps hold the
      // line until the lock takes effect. Once per session.
      if (!session.firstMoveSeen) {
        session.firstMoveSeen = true
        if (e.cancelable) {
          e.preventDefault()
        }
      }

      const dx = e.clientX - session.startClientX
      const dy = e.clientY - session.startClientY
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        // Moved before the long-press fired — a scroll/swipe, not a
        // long-press. Release the lock now, in this same synchronous
        // handler, so the UA's own pan recognizer can still pick up the
        // gesture for the rest of the move sequence.
        clearLongPressTimer()
        releasePreArmLock(session)
        dragSessionRef.current = null
      }
      return
    }

    e.preventDefault()

    const dx = e.clientX - session.startClientX
    const dy = e.clientY - session.startClientY
    applyDragTransform(session.gameId, dx, dy)

    const overIndex = findSlotIndexAtPoint(e.clientX, e.clientY, session.slotRects)
    if (overIndex !== -1) {
      setDragOrder((prev) => {
        if (!prev) return prev
        const from = prev.indexOf(session.gameId)
        if (from === -1 || from === overIndex) return prev
        const next = [...prev]
        next.splice(from, 1)
        next.splice(overIndex, 0, session.gameId)
        return next
      })
    }

    // Trash-target hit test — armed when the *dragged cover's* center
    // (not the raw pointer point) enters the trash bar's live bounds.
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

  // `orderedIds` only ever covers the visible (paginated) prefix of
  // `games` — dragging never touches the not-yet-revealed tail, which
  // this re-appends unchanged after the reordered visible games.
  const commitReorder = async (orderedIds) => {
    const currentVisibleIds = visibleGames.map((g) => g.id)
    if (
      orderedIds.length === currentVisibleIds.length &&
      orderedIds.every((id, i) => id === currentVisibleIds[i])
    ) {
      return // released back where it started — nothing to persist
    }
    const byId = new Map(games.map((g) => [g.id, g]))
    const reorderedVisible = orderedIds.map((id) => byId.get(id)).filter(Boolean)
    if (reorderedVisible.length !== currentVisibleIds.length) return // geometry drifted — bail safely

    const hiddenTail = games.slice(visibleGames.length)
    const arr = [...reorderedVisible, ...hiddenTail]

    // Optimistic update, then persist via the existing reorder call.
    setGames(arr)
    try {
      await reorderListGames(listId, arr.map((g) => g.id))
    } catch {
      refresh()
      showToast('Failed to save new order. Please try again.', 'error')
    }
  }

  const commitRemoveViaDrag = async (game, originalIndex) => {
    setGames((prev) => prev.filter((g) => g.id !== game.id))
    try {
      await removeGameFromList(listId, game.id)
      window.dispatchEvent(new Event('libraryUpdated'))
      hapticSuccess()
      showToast('Removed from list', 'success', 4000, {
        label: 'Undo',
        onClick: async () => {
          setGames((prev) => {
            const next = [...prev]
            next.splice(Math.min(originalIndex, next.length), 0, game)
            return next
          })
          try {
            await addGameToList(listId, game.id, originalIndex, {
              title: game.title,
              image: game.image,
            })
            window.dispatchEvent(new Event('libraryUpdated'))
          } catch {
            refresh()
            showToast("Couldn't restore the game. Please try again.", 'error')
          }
        },
      })
    } catch {
      refresh()
      showToast('Failed to remove game. Please try again.', 'error')
    }
  }

  const handleCoverPointerUp = (e) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== e.pointerId) return

    if (session.captureEl?.hasPointerCapture?.(e.pointerId)) {
      session.captureEl.releasePointerCapture(e.pointerId)
    }
    clearLongPressTimer()

    if (!session.activated) {
      // Plain tap, released before the long-press fired — release the
      // pre-arm lock so the next genuine scroll/tap on this cover isn't
      // blocked, then let the synthesized click go through to navigate
      // as usual.
      releasePreArmLock(session)
      dragSessionRef.current = null
      return
    }

    const { gameId, armed, slotRects } = session
    const game = games.find((g) => g.id === gameId)
    const finalOrder = dragOrder || visibleGames.map((g) => g.id)
    const originalIndex = games.findIndex((g) => g.id === gameId)

    if (armed && game) {
      // ── Remove flow — shrink/fade the cover out RIGHT WHERE it was
      // dropped (still over the trash target — its lifted transform,
      // the trash target, and the hidden nav are all left exactly as
      // the user released them; only the .game-cover--removing class
      // is added, see the className below). Only once that animation
      // finishes do we restore the nav/trash chrome and actually
      // commit the removal. ──
      setRemovingGameId(gameId)
      setTimeout(() => {
        setRemovingGameId(null)
        hardResetDrag(gameId)
        commitRemoveViaDrag(game, originalIndex)
      }, reducedMotion ? 0 : REMOVE_ANIM_MS)
      return
    }

    // ── Reorder flow — settle the lifted cover into its final slot with
    // a transition, then commit the new order once it lands. The target
    // rect and the post-commit natural layout position are the same
    // point, so dropping the transform after commit shows no jump. ──
    const finalIndex = finalOrder.indexOf(gameId)
    const origin = slotRects[originalIndex]
    const dest = slotRects[finalIndex]
    if (origin && dest) {
      applyDragTransform(
        gameId,
        dest.left - origin.left,
        dest.top - origin.top,
        reducedMotion ? '' : `transform ${REORDER_SETTLE_MS}ms cubic-bezier(0.2, 0, 0, 1)`
      )
    }

    setTimeout(() => {
      commitReorder(finalOrder)
      hardResetDrag(gameId)
    }, reducedMotion ? 0 : REORDER_SETTLE_MS)
  }

  const handleCoverPointerCancel = (e) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== e.pointerId) return
    if (session.captureEl?.hasPointerCapture?.(e.pointerId)) {
      session.captureEl.releasePointerCapture(e.pointerId)
    }
    // An activated session set this true expecting handleCoverPointerUp's
    // own click-swallow (below, in the tap handler) to clear it eventually.
    // A cancel never reaches that click at all — the OS/WebView interrupted
    // the touch instead of ending it normally (a competing gesture
    // recognizer, or main-thread churn from a navigation transition landing
    // mid-touch) — so without this, the flag is left stuck true and the
    // very next tap on ANY cover in this grid (it's a single ref, not
    // per-card) is silently eaten to clear it. "Cleanly reset everything"
    // below has to include this, not just the visible drag state.
    if (session.activated) suppressClickRef.current = false
    setRemovingGameId(null)
    // No commit of any kind — a cancel/interruption must cleanly reset
    // everything: no stuck lifted cover, no orphaned trash target, nav
    // restored.
    hardResetDrag(session.gameId)
  }

  // Navigating away mid-drag (back button, tab switch to another route)
  // unmounts this component without ever running pointerup/pointercancel
  // for the in-flight session — same risk Library.jsx guards against for
  // its in-page tab switch. Without this, a locked .main-content
  // (overflow: hidden) or a stuck touch-action: none would silently
  // outlive the page and break scrolling/gestures on wherever the user
  // navigated to next.
  useEffect(() => {
    return () => {
      clearLongPressTimer()
      releasePreArmLock(dragSessionRef.current)
      removeNonPassiveTouchMoveBlock(dragSessionRef.current)
      unlockScrollContainer()
      window.dispatchEvent(
        new CustomEvent(LIST_REORDER_DRAG_EVENT, { detail: { active: false } })
      )
    }
  }, [])

  // ── Main action sheet items ───────────────────────────────────────────────
  // Everything lives in the ⋯ menu now — Share moved in here from the
  // (now-removed) header icon, same trigger (setDmShareOpen) and same
  // visibility rule it always had: custom, public list, viewer signed in.
  // Owner also keeps Pin/Unpin + Duplicate (unchanged handlers, still
  // reachable) alongside Edit details / Manage collaborators / Delete
  // list. "Add games" is intentionally NOT in this menu — it already
  // lives in the header + button. "Reorder" is intentionally not in this
  // menu either — it's been replaced by the long-press drag-to-reorder
  // interaction directly on the grid (see handleCoverPointerDown below).
  // Non-owner sees Save / Share / Report.

  const canShareList = listInfo?.isCustom && listInfo?.isPublic && !!currentUserId

  const shareItem = canShareList
    ? [{ label: 'Share', onClick: () => setDmShareOpen(true) }]
    : []

  const clearModeSheetItem = !isTracker
    ? [
        {
          label: 'Clear mode',
          onClick: handleEnterClearMode,
        },
      ]
    : []

  const actionSheetItems = isOwner
    ? [
        ...clearModeSheetItem,
        ...shareItem,
        { label: 'Edit details', onClick: openDescEdit },
        {
          label: 'Manage collaborators',
          onClick: () => setShowCollaboratorSheet(true),
        },
        {
          label: isPinned ? 'Unpin from profile' : 'Pin to profile',
          onClick: handlePinToggle,
        },
        {
          label: 'Duplicate list',
          onClick: handleDuplicate,
        },
        {
          label: 'Delete list',
          destructive: true,
          onClick: () => setShowDeleteConfirm(true),
        },
      ]
    : [
        ...clearModeSheetItem,
        ...(listInfo?.isCustom && listInfo?.isPublic && currentUserId
          ? [{ label: isSaved ? 'Unsave' : 'Save', onClick: handleSaveToggle }]
          : []),
        ...shareItem,
        {
          label: 'Report list',
          onClick: () => setReportSheetOpen(true),
        },
      ]

  // ── Inline description editing ────────────────────────────────────────────

  function openDescEdit() {
    setDescDraft(listInfo?.description || '')
    setEditingDesc(true)
  }

  const handleDescCancel = () => {
    setEditingDesc(false)
    setDescDraft('')
  }

  const handleDescSave = async () => {
    const trimmed = descDraft.trim()
    const prev = listInfo?.description || ''
    if (trimmed === prev) {
      setEditingDesc(false)
      return
    }
    setListInfo((l) => ({ ...l, description: trimmed }))
    setEditingDesc(false)
    try {
      await updateList(listId, { description: trimmed })
      hapticImpact('Medium')
      showToast('Description updated', 'success')
    } catch {
      setListInfo((l) => ({ ...l, description: prev }))
      showToast("Couldn't save description. Please try again.", 'error')
    }
  }

  // Auto-focus when edit opens
  useEffect(() => {
    if (!editingDesc) return
    const t = setTimeout(() => {
      const el = descTextareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }, 40)
    return () => clearTimeout(t)
  }, [editingDesc])

  // Auto-grow textarea
  useEffect(() => {
    const el = descTextareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [descDraft])

  const author = listInfo?.author
  const ownerLabel = author?.displayName || author?.username || 'Unknown'
  const showFab = isOwner
  const sortLabel = LIBRARY_SORTS.find((s) => s.key === sortKey)?.label || 'Recent'

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="list-detail-page list-detail-page--loading list-detail-page--custom" aria-busy="true" aria-label="Loading list">
        <div className="ld-sk-header-bar" aria-hidden="true">
          <div className="ld-sk-header-title skeleton" />
        </div>
        <div className="ld-sk-sortrow" aria-hidden="true">
          <div className="ld-sk-sortrow-owner skeleton" />
          <div className="ld-sk-sortrow-sort skeleton" />
        </div>
        <div className="ld-sk-grid" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="ld-sk-cover skeleton" />
          ))}
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="list-detail-page">
        <div className="list-detail-empty">
          <InlineErrorBanner
            message="Couldn't load. Tap to retry."
            onRetry={() => { setIsLoading(true); refresh() }}
          />
        </div>
      </div>
    )
  }

  if (listInfo === null) {
    return (
      <div className="list-detail-page">
        <div className="list-detail-empty">
          <p>This list could not be found.</p>
          <button
            className="list-detail-back-button"
            onClick={() => navigate('/library')}
          >
            Back to Library
          </button>
        </div>
      </div>
    )
  }

  // ── Tracker lists (Backlog / Playing / Played / Dropped) ────────────
  // Left completely untouched — same header, same rich row-list content,
  // no masthead/mockup markup below applies to this branch at all.
  if (isTracker) {
    return (
      <div className="list-detail-page content-fade-in">
        <div className="ld-ambient-wash" aria-hidden="true" />

        <header className="list-detail-header-bar" ref={headerBarRef}>
          <button
            type="button"
            className="list-detail-back"
            onClick={() => navigate(-1)}
            aria-label="Go back"
          >
            <LuChevronLeft size={22} aria-hidden="true" />
          </button>

          <span className="list-detail-header-label list-detail-header-label--visible">
            {listInfo.name}
          </span>

          <div className="list-detail-header-actions">
            {isTracker && (
              <button
                type="button"
                className="list-detail-header-icon-btn"
                onClick={() => setShowAddGames(true)}
                aria-label="Add games"
              >
                <HiPlus size={20} aria-hidden="true" />
              </button>
            )}
            {listInfo.isCustom && (
              <button
                type="button"
                className="list-detail-header-icon-btn"
                onClick={() => setShowActionSheet(true)}
                aria-haspopup="dialog"
                aria-label="More options"
              >
                <HiDotsVertical size={20} aria-hidden="true" />
              </button>
            )}
          </div>
        </header>

        <div className="list-detail-content list-detail-content--tracker">
          <p className="list-detail-game-count">
            {games.length} {games.length === 1 ? 'game' : 'games'}
          </p>

          {games.length > 0 ? (
            <TrackerGameList listId={listId} games={games} />
          ) : (
            <ListDetailEmpty
              listId={listId}
              isTracker={isTracker}
              onAddGames={() => setShowAddGames(true)}
              onFindGames={() => navigate('/search')}
            />
          )}
        </div>

        <AddGamesModal
          isOpen={showAddGames}
          onClose={() => {
            setShowAddGames(false)
            refresh()
          }}
          listId={listId}
          listName={listInfo?.name}
          listDescription={listInfo?.description}
          onAddGames={null}
        />

        <ActionSheet
          isOpen={showActionSheet}
          onClose={() => setShowActionSheet(false)}
          items={actionSheetItems}
        />

        <DeleteConfirmModal
          isOpen={showDeleteConfirm}
          listName={listInfo?.name ?? ''}
          gameCount={games.length}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setShowDeleteConfirm(false)}
        />

        <ReportSheet
          isOpen={reportSheetOpen}
          onClose={() => setReportSheetOpen(false)}
          contentType="list"
          contentId={listId}
        />

        <CollaboratorSheet
          isOpen={showCollaboratorSheet}
          onClose={() => setShowCollaboratorSheet(false)}
          listId={listId}
          isOwner={isOwner}
          currentUserId={currentUserId}
          collaborators={collaborators}
          onChanged={() => {
            refresh()
            setShowCollaboratorSheet(false)
          }}
        />

        <DmShareSheet
          isOpen={dmShareOpen}
          onClose={() => setDmShareOpen(false)}
          attachment={{
            type: 'list',
            id: listId,
            title: listInfo?.name || 'List',
            cover_url: games[0]?.image || games[0]?.coverUrl || null,
            subtitle: `${games.length} ${games.length === 1 ? 'game' : 'games'}`,
            url_path: `/list/${listId}`,
          }}
        />
      </div>
    )
  }

  // ── Custom lists — mockup D: compact nav, optional description, grid ─────
  return (
    <div
      ref={pageRef}
      className={`list-detail-page list-detail-page--custom content-fade-in${
        showFab && !isClearMode ? ' list-detail-page--fab' : ''
      }${isClearMode ? ' list-detail-page--clear-mode' : ''}`}
      onClickCapture={handleClearModeExitCapture}
    >
      {isClearMode && (
        <div className="ld-clear-status-fade" aria-hidden="true" />
      )}

      {!isClearMode && (
        <header className="ld-header ld-clear-mode-chrome" ref={headerBarRef}>
        <button
          type="button"
          className="icon-btn"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <ChevronLeft size={14} strokeWidth={2.5} aria-hidden="true" />
        </button>

        <div className="ld-header-center">
          <span className="ld-header-title">{listInfo.name}</span>
        </div>

        <div className="header-right">
          {isOwner && (
            <button
              type="button"
              className="icon-btn"
              onClick={openDescEdit}
              aria-label="Edit list"
            >
              <Pencil size={14} strokeWidth={2.5} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowActionSheet(true)}
            aria-haspopup="dialog"
            aria-label="More options"
          >
            <MoreHorizontal size={14} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      </header>
      )}

      {!isClearMode && isOwner && editingDesc ? (
        <div className="list-detail-desc-edit-wrap ld-desc-edit ld-clear-mode-chrome">
          <div className="list-detail-desc-edit-unit">
            <textarea
              ref={descTextareaRef}
              className="list-detail-desc-textarea"
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              placeholder="Add a description…"
              maxLength={500}
              aria-label="List description"
            />
            <div className="list-detail-desc-edit-toolbar">
              <button
                type="button"
                className="list-detail-desc-cancel-btn"
                onClick={handleDescCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="list-detail-desc-save-btn"
                onClick={handleDescSave}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        !isClearMode &&
        listInfo.description && (
          <p className="ld-desc-line ld-clear-mode-chrome">{listInfo.description}</p>
        )
      )}

      <div className="list-body">
        {!isClearMode && (
        <div className="ld-sortrow ld-clear-mode-chrome">
          <span className="ld-sortrow-byline">
            {author?.username ? (
              <button
                type="button"
                className="ld-header-owner"
                onClick={() => navigate(`/profile/${author.username}`)}
              >
                {ownerLabel}
              </button>
            ) : (
              ownerLabel
            )}
          </span>
          <button
            type="button"
            className="ld-sortrow-btn"
            onClick={() => setShowSortSheet(true)}
            aria-label={`Sort games (currently ${sortLabel})`}
          >
            {sortedGames.length} {sortedGames.length === 1 ? 'game' : 'games'} · {sortLabel}
            <ChevronDown size={10} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
        )}

        <div
          className={`ld-clear-grid-surface${
            clearGridFade && !reducedMotion ? ' ld-clear-grid-surface--fade' : ''
          }`}
        >
        {sortedGames.length > 0 ? (
          viewKey === 'list' ? (
            <>
              <LibraryGameGrid
                games={visibleGames}
                view="list"
                dragging={dragGameId != null}
                ariaLabel="List games"
                renderCard={(game) => {
                  const imageUrl = getBestImageUrl(game, 800) || game.image
                  return (
                    <LibraryGameRow
                      key={game.id}
                      game={{ ...game, image: imageUrl }}
                      onClick={() => {
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false
                          return
                        }
                        openGame(game, imageUrl)
                      }}
                    />
                  )
                }}
              />
              {hasMoreGames && (
                <div ref={gamesSentinelRef} className="ld-games-sentinel" aria-hidden="true" />
              )}
            </>
          ) : (
            <>
              <div
                className={`game-grid${dragGameId != null ? ' game-grid--dragging' : ''}`}
                ref={gridRef}
              >
                {visibleGames.map((game, originalIndex) => {
                  const imageUrl = getBestImageUrl(game, 800) || game.image
                  const isDragged = dragGameId === game.id
                  const isRemoving = removingGameId === game.id
                  const isDragActive = dragGameId != null

                  let shiftStyle
                  if (isDragActive && !isDragged && dragOrder && dragSessionRef.current?.slotRects) {
                    const slotRects = dragSessionRef.current.slotRects
                    const currentIndex = dragOrder.indexOf(game.id)
                    const origin = slotRects[originalIndex]
                    const dest = slotRects[currentIndex]
                    if (origin && dest && currentIndex !== originalIndex) {
                      shiftStyle = {
                        transform: `translate3d(${dest.left - origin.left}px, ${dest.top - origin.top}px, 0)`,
                      }
                    }
                  }

                  return (
                    <div
                      key={game.id}
                      ref={(el) => { if (el) itemEls.current[game.id] = el }}
                      className={`gg-item${isDragged ? ' gg-item--dragged' : ''}${
                        isDragActive && !isDragged ? ' gg-item--drag-shift' : ''
                      }`}
                      style={shiftStyle}
                    >
                      <div
                        className={`game-cover${
                          isRemoving
                            ? ' game-cover--removing'
                            : isDragged
                              ? ` game-cover--lifted${trashArmed ? ' game-cover--armed' : ''}`
                              : ''
                        }`}
                        onPointerDown={(e) => handleCoverPointerDown(e, game.id)}
                        onPointerMove={handleCoverPointerMove}
                        onPointerUp={handleCoverPointerUp}
                        onPointerCancel={handleCoverPointerCancel}
                      >
                        <Pressable
                          as="div"
                          role="button"
                          tabIndex={0}
                          className="gg-cover-tap"
                          onClick={() => {
                            if (suppressClickRef.current) {
                              suppressClickRef.current = false
                              return
                            }
                            openGame(game, imageUrl)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              openGame(game, imageUrl)
                            }
                          }}
                          aria-label={`View ${game.title}`}
                        >
                          <SharedCover gameId={game.id} imageSrc={imageUrl}>
                            <img
                              src={imageUrl}
                              alt={game.title}
                              loading="lazy"
                              draggable={false}
                              onError={(e) => {
                                if (e.target.src !== game.image && game.image) {
                                  e.target.src = game.image
                                } else {
                                  e.target.src = COVER_FALLBACK
                                }
                              }}
                            />
                          </SharedCover>
                        </Pressable>
                      </div>

                      <p className="game-title">{game.title}</p>
                    </div>
                  )
                })}
              </div>
              {hasMoreGames && (
                <div ref={gamesSentinelRef} className="ld-games-sentinel" aria-hidden="true" />
              )}
            </>
          )
        ) : (
          <ListDetailEmpty listId={listId} isTracker={isTracker} />
        )}
        </div>

        {/* Slide-up trash target — mounted (via portal) only while this
            viewer could possibly start a drag; visible/armed are what
            actually animate it in/out. See handleCoverPointerDown /
            handleCoverPointerMove above for the drag session driving it. */}
        {canDrag && !isClearMode && (
          <ReorderTrashTarget
            visible={dragGameId != null}
            armed={trashArmed}
            barRef={trashBarRef}
          />
        )}

        {!isClearMode && listInfo.isCustom && (
          <ListComments
            listId={listId}
            currentUserId={currentUserId}
            isOwner={isOwner}
          />
        )}
      </div>

      {clearHintVisible &&
        createPortal(
          <p
            className={`ld-clear-hint text-label${
              clearHintFading ? ' ld-clear-hint--out' : ''
            }`}
            role="status"
          >
            Tap anywhere to exit
          </p>,
          document.body
        )}

      <AddGamesModal
        isOpen={showAddGames}
        onClose={() => {
          setShowAddGames(false)
          refresh()
        }}
        listId={listId}
        listName={listInfo?.name}
        listDescription={listInfo?.description}
        onAddGames={null}
      />

      <ActionSheet
        isOpen={showActionSheet}
        onClose={() => setShowActionSheet(false)}
        items={actionSheetItems}
      />

      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        listName={listInfo?.name ?? ''}
        gameCount={games.length}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      <ReportSheet
        isOpen={reportSheetOpen}
        onClose={() => setReportSheetOpen(false)}
        contentType="list"
        contentId={listId}
      />

      <CollaboratorSheet
        isOpen={showCollaboratorSheet}
        onClose={() => setShowCollaboratorSheet(false)}
        listId={listId}
        isOwner={isOwner}
        currentUserId={currentUserId}
        collaborators={collaborators}
        onChanged={() => {
          refresh()
          setShowCollaboratorSheet(false)
        }}
      />

      <DmShareSheet
        isOpen={dmShareOpen}
        onClose={() => setDmShareOpen(false)}
        attachment={{
          type: 'list',
          id: listId,
          title: listInfo?.name || 'List',
          cover_url: games[0]?.image || games[0]?.coverUrl || null,
          subtitle: `${games.length} ${games.length === 1 ? 'game' : 'games'}`,
          url_path: `/list/${listId}`,
        }}
      />

      <LibrarySortSheet
        isOpen={showSortSheet}
        onClose={() => setShowSortSheet(false)}
        sortKey={sortKey}
        onSelect={setSortKey}
        viewKey={viewKey}
        onViewSelect={handleViewSelect}
      />

      {showFab &&
        !isClearMode &&
        createPortal(
          <button
            type="button"
            className={`lib-fab lib-fab--lists${
              dragGameId != null ? ' lib-fab--hidden' : ''
            }`}
            onClick={() => setShowAddGames(true)}
            aria-label="Add games"
          >
            <span className="lib-fab-bg lib-fab-bg--lists" aria-hidden="true" />
            <Plus size={24} aria-hidden="true" />
          </button>,
          document.body
        )}
    </div>
  )
}

export default ListDetail

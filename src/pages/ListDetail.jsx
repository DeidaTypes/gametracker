import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAutoAnimateMotion, useMotionPreference } from '../hooks/useMotionPreference'
import { LuChevronLeft } from 'react-icons/lu'
import { HiDotsVertical, HiPlus } from 'react-icons/hi'
import {
  ChevronLeft,
  Plus,
  MoreHorizontal,
  ChevronDown,
  PlayCircle,
  CheckCircle2,
  Bookmark,
  BookmarkCheck,
  List,
  Pencil,
} from 'lucide-react'
import SharedCover from '../components/SharedCover'
import Pressable from '../components/Pressable'
import { getBestImageUrl } from '../services/imageUtils'
import { COVER_FALLBACK } from '../utils/coverFallback'
import AddGamesModal from '../components/AddGamesModal'
import ActionSheet from '../components/ActionSheet'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import ReportSheet from '../components/ReportSheet'
import EmptyState from '../components/EmptyState'
import { showToast } from '../components/Toast'
import InlineErrorBanner from '../components/InlineErrorBanner'
import ReorderTrashTarget from '../components/ReorderTrashTarget'
import { LIST_REORDER_DRAG_EVENT } from '../components/BottomNav'
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
  getOwnerRatingsForList,
  getOwnerTrackerDataForList,
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
import TrackerGameList from '../components/TrackerGameList'
import Avatar from '../components/Avatar'
import { supabase } from '../services/supabase'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import { getSWR, peekSWR } from '../services/swrCache'

/** How long a list's contents are reused before the next entry revalidates. */
const LIST_TTL_MS = 60 * 1000
import './ListDetail.css'

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

// Capacitor Haptics — dynamic import + try/catch so the web build (and
// any environment without the native plugin) is a silent no-op. Same
// pattern as BottomNav.jsx / BacklogRoulette.jsx elsewhere in the app.
async function hapticImpact(style) {
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: ImpactStyle[style] })
  } catch {
    /* no-op on web or when the plugin isn't available */
  }
}

async function hapticSuccess() {
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics')
    await Haptics.notification({ type: NotificationType.Success })
  } catch {
    /* no-op on web or when the plugin isn't available */
  }
}

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

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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
    body: 'Save games you want to play later.',
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
        body="Start adding games to build your collection."
        cta="Add a game"
        onCta={onAddGames}
      />
    </div>
  )
}

function ListDetail() {
  const { listId } = useParams()
  const navigate = useNavigate()
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

  // Owner ratings: { [igdbGameId]: rating }
  const [ownerRatings, setOwnerRatings] = useState({})

  // Owner tracker data (status + hours): { [igdbGameId]: { status, hoursPlayed } }
  // Powers the stat line's Played/Total-hours cells and the per-cover status dot.
  const [ownerTrackerData, setOwnerTrackerData] = useState({})

  // Inline description editing
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const descTextareaRef = useRef(null)

  const isTracker = isTrackerList(listId)

  // ── Sticky-header title fade ─────────────────────────────────────────────
  // The header title is hidden at scroll-top and only fades in once the
  // masthead title (.masthead-title) has scrolled up behind the sticky
  // header. Tracker lists never render the masthead card, so their header
  // label stays visible the whole time (unchanged from before).
  const titleRef = useRef(null)
  const headerBarRef = useRef(null)
  const [showHeaderTitle, setShowHeaderTitle] = useState(isTracker)

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

  // Reset to the first page whenever a different list is opened.
  useEffect(() => {
    setVisibleGamesCount(GAMES_PAGE_SIZE)
  }, [listId])

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
  const visibleGames = games.slice(0, visibleGamesCount)
  const hasMoreGames = games.length > visibleGames.length

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

  // Show the sticky header's title only once the masthead title has
  // scrolled up behind it. `.main-content` is the app's single scroll
  // container (see App.jsx), so we measure against its scroll position
  // rather than window scroll. Purely visual — no data/behavior change.
  useEffect(() => {
    if (isTracker) return
    const titleEl = titleRef.current
    const scrollEl = document.querySelector('.main-content')
    if (!titleEl || !scrollEl) return

    const update = () => {
      const headerHeight = headerBarRef.current?.getBoundingClientRect().height || 0
      const titleBottom = titleEl.getBoundingClientRect().bottom
      setShowHeaderTitle(titleBottom <= headerHeight)
    }

    update()
    scrollEl.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      scrollEl.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [isTracker, listInfo, games.length])

  // Derived: can the current user edit this list's cover?
  const isOwner =
    listInfo?.isCustom &&
    currentUserId != null &&
    currentUserId === listInfo?.userId

  const isCollaborator =
    !isOwner &&
    currentUserId != null &&
    collaborators.some((c) => c.userId === currentUserId)

  // Load the list owner's ratings for all games in this list (real data only)
  useEffect(() => {
    if (!listInfo?.userId || !games.length || isTracker) {
      setOwnerRatings({})
      return
    }
    let cancelled = false
    getOwnerRatingsForList(
      listInfo.userId,
      games.map((g) => g.id)
    ).then((ratings) => {
      if (!cancelled) setOwnerRatings(ratings)
    })
    return () => { cancelled = true }
  }, [listInfo?.userId, games, isTracker])

  // Load the list owner's tracker status + hours for all games in this
  // list (real data only — same source as the Played/Total-hours stats).
  useEffect(() => {
    if (!listInfo?.userId || !games.length || isTracker) {
      setOwnerTrackerData({})
      return
    }
    let cancelled = false
    getOwnerTrackerDataForList(
      listInfo.userId,
      games.map((g) => g.id)
    ).then((data) => {
      if (!cancelled) setOwnerTrackerData(data)
    })
    return () => { cancelled = true }
  }, [listInfo?.userId, games, isTracker])

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

  // Full teardown — used on a clean release AND on pointercancel/system
  // interruption. Never calls reorderListGames/removeGameFromList itself;
  // callers commit those first if the release should persist a change.
  const hardResetDrag = (gameId) => {
    clearLongPressTimer()
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

  const handleCoverPointerDown = (e, gameId) => {
    if (!canDrag) return
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
      const dx = e.clientX - session.startClientX
      const dy = e.clientY - session.startClientY
      if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
        // Moved before the long-press fired — a scroll/swipe, not a
        // long-press. Bail and let the browser handle it natively.
        clearLongPressTimer()
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
      // Plain tap, released before the long-press fired — clean up and
      // let the synthesized click go through to navigate as usual.
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
    setRemovingGameId(null)
    // No commit of any kind — a cancel/interruption must cleanly reset
    // everything: no stuck lifted cover, no orphaned trash target, nav
    // restored.
    hardResetDrag(session.gameId)
  }

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

  const actionSheetItems = isOwner
    ? [
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

  // ── Stat line (custom lists only) — real data, never fabricated ─────────
  // Avg rating excludes games the owner hasn't rated (not counted as 0).
  // Games count always renders; Played / Avg rating / Total hours each
  // appear only when they have something real to show.
  const ratedValues = games
    .map((g) => ownerRatings[g.id])
    .filter((r) => r != null)
  const avgRating = ratedValues.length
    ? ratedValues.reduce((sum, r) => sum + r, 0) / ratedValues.length
    : null
  const playedCount = games.filter(
    (g) => ownerTrackerData[g.id]?.status === 'played'
  ).length
  const totalHours = games.reduce(
    (sum, g) => sum + (ownerTrackerData[g.id]?.hoursPlayed || 0),
    0
  )
  const totalHoursRounded = Math.round(totalHours)

  const statCells = [
    { key: 'games', value: games.length, label: games.length === 1 ? 'game' : 'games' },
    ...(playedCount > 0 ? [{ key: 'played', value: playedCount, label: 'played' }] : []),
    ...(avgRating != null ? [{ key: 'rating', value: avgRating.toFixed(1) }] : []),
    ...(totalHoursRounded > 0 ? [{ key: 'hours', value: `${totalHoursRounded}h` }] : []),
  ]

  // Masthead cover strip — first up-to-4 cover images. Omitted entirely
  // (no node at all) when the list has zero games.
  const coverImages = games
    .slice(0, 4)
    .map((g) => getBestImageUrl(g, 800) || g.image)
    .filter(Boolean)

  const author = listInfo?.author

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="list-detail-page list-detail-page--loading" aria-busy="true" aria-label="Loading list">
        <div className="ld-sk-header-bar" aria-hidden="true" />
        <div className="ld-sk-body" aria-hidden="true">
          <div className="ld-sk-eyebrow skeleton" />
          <div className="ld-sk-title skeleton" />
          <div className="ld-sk-meta skeleton" />
          <div className="ld-sk-desc skeleton" />
          <div className="ld-sk-divider" aria-hidden="true" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="ld-sk-game-row" aria-hidden="true">
              <div className="ld-sk-game-thumb skeleton" />
              <div className="ld-sk-game-meta">
                <div className="ld-sk-game-name skeleton" />
                <div className="ld-sk-game-sub skeleton" />
              </div>
            </div>
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

  // ── Tracker lists (Want to Play / Playing / Played / Dropped) ────────────
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

          <span
            className={`list-detail-header-label${showHeaderTitle ? ' list-detail-header-label--visible' : ''}`}
          >
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

  // ── Custom lists — rebuilt to the Musicboard-inspired mockup ─────────────
  return (
    <div className="list-detail-page content-fade-in">

      {/* Sticky header — back (left), gradient + for the owner / bookmark
          for a signed-in non-owner viewer, and ⋯ overflow (right). Title
          is invisible at scroll-top and only fades in once the masthead
          card has scrolled up behind this bar. */}
      <header className="header" ref={headerBarRef}>
        <button
          type="button"
          className="icon-btn"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>

        <span
          className={`header-title${showHeaderTitle ? ' header-title--visible' : ''}`}
        >
          {listInfo.name}
        </span>

        <div className="header-right">
          {isOwner ? (
            <button
              type="button"
              className="icon-btn icon-btn--add"
              onClick={() => setShowAddGames(true)}
              aria-label="Add games"
            >
              <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
            </button>
          ) : (
            listInfo.isPublic && currentUserId && (
              <button
                type="button"
                className="icon-btn icon-btn--add"
                onClick={handleSaveToggle}
                aria-pressed={isSaved}
                aria-label={isSaved ? 'Unsave list' : 'Save list'}
              >
                {isSaved
                  ? <BookmarkCheck size={16} strokeWidth={2.4} aria-hidden="true" />
                  : <Bookmark size={16} strokeWidth={2.4} aria-hidden="true" />
                }
              </button>
            )
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setShowActionSheet(true)}
            aria-haspopup="dialog"
            aria-label="More options"
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Masthead card — cover strip (first up to 4 covers, omitted if
          none) + title + byline + inline stat line + description. */}
      <div className="masthead">
        {coverImages.length > 0 && (
          <div
            className="masthead-strip"
            style={{ gridTemplateColumns: `repeat(${coverImages.length}, 1fr)` }}
          >
            {coverImages.map((src, i) => (
              <img key={i} src={src} alt="" loading="lazy" />
            ))}
          </div>
        )}

        <div className="masthead-inner">
          <h1 className="masthead-title" ref={titleRef}>{listInfo.name}</h1>

          {(author || listInfo.createdAt) && (
            <div className="masthead-byline">
              {author && (
                <Avatar
                  user={author}
                  size="xs"
                  className="masthead-byline-avatar"
                />
              )}
              <span>
                {author && (
                  <b
                    role="button"
                    tabIndex={0}
                    onClick={() => author.username && navigate(`/profile/${author.username}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && author.username) navigate(`/profile/${author.username}`)
                    }}
                  >
                    {author.displayName || author.username}
                  </b>
                )}
                {author && listInfo.createdAt && ' · '}
                {listInfo.createdAt && fmtDate(listInfo.createdAt)}
              </span>
            </div>
          )}

          {statCells.length > 0 && (
            <div className="statline">
              {statCells.map((cell, i) => (
                <React.Fragment key={cell.key}>
                  {i > 0 && <span className="sep" aria-hidden="true">·</span>}
                  {cell.key === 'rating' ? (
                    <span className="rating">{cell.value}★</span>
                  ) : (
                    <span><b>{cell.value}</b>{cell.label ? ` ${cell.label}` : ''}</span>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Description — inline edit for owner, read-only for viewer.
              Empty + owner → quiet "Add a description" affordance (no box).
              Empty + viewer → renders nothing. */}
          {isOwner && editingDesc ? (
            <div className="list-detail-desc-edit-wrap">
              <textarea
                ref={descTextareaRef}
                className="list-detail-desc-textarea"
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                placeholder="Add a description…"
                maxLength={500}
                aria-label="List description"
              />
              <div className="list-detail-desc-edit-actions">
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
          ) : isOwner ? (
            listInfo.description ? (
              <p
                className="masthead-desc masthead-desc--editable"
                onClick={openDescEdit}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && openDescEdit()}
                aria-label="Edit description"
              >
                {listInfo.description}
              </p>
            ) : (
              <button
                type="button"
                className="masthead-desc-add"
                onClick={openDescEdit}
              >
                <Pencil size={13} aria-hidden="true" />
                Add a description
              </button>
            )
          ) : (
            listInfo.description && (
              <p className="masthead-desc">{listInfo.description}</p>
            )
          )}
        </div>
      </div>

      {/* Body — section label row, game grid, comments + composer. No
          dividers, no background bands, no action-button row. */}
      <div className="list-body">
        <div className="section-row">
          <p>{games.length} {games.length === 1 ? 'GAME' : 'GAMES'}</p>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              showToast('Sort coming soon', 'info')
            }}
          >
            Sort
            <ChevronDown size={12} aria-hidden="true" />
          </a>
        </div>

        {games.length > 0 ? (
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

              // Sibling shift — while a drag is active, every OTHER item
              // gets a transform translating it to wherever it currently
              // sits in the live `dragOrder`, computed against the slot
              // rects snapshotted at drag start (see handleCoverPointerDown).
              // The dragged item's own transform is written imperatively
              // in the pointer handlers (applyDragTransform) so it can
              // follow the finger every frame without going through React.
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
                        // A long-press that activated a drag suppresses the
                        // pointerup's synthesized click so releasing a
                        // dragged/dropped cover never also navigates.
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false
                          return
                        }
                        navigate(`/game/${game.id}`, { state: { coverImage: imageUrl } })
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          navigate(`/game/${game.id}`, { state: { coverImage: imageUrl } })
                        }
                      }}
                      aria-label={`View ${game.title}`}
                    >
                      <SharedCover gameId={game.id} imageSrc={imageUrl}>
                        <img
                          src={imageUrl}
                          alt={game.title}
                          loading="lazy"
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
        ) : (
          <ListDetailEmpty
            listId={listId}
            isTracker={isTracker}
            onAddGames={() => setShowAddGames(true)}
            onFindGames={() => navigate('/search')}
          />
        )}

        {/* Slide-up trash target — mounted (via portal) only while this
            viewer could possibly start a drag; visible/armed are what
            actually animate it in/out. See handleCoverPointerDown /
            handleCoverPointerMove above for the drag session driving it. */}
        {canDrag && (
          <ReorderTrashTarget
            visible={dragGameId != null}
            armed={trashArmed}
            barRef={trashBarRef}
          />
        )}

        {listInfo.isCustom && (
          <ListComments
            listId={listId}
            currentUserId={currentUserId}
            isOwner={isOwner}
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

export default ListDetail

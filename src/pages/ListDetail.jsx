import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAutoAnimateMotion } from '../hooks/useMotionPreference'
import { LuChevronLeft } from 'react-icons/lu'
import { HiDotsVertical, HiPlus, HiOutlineShare } from 'react-icons/hi'
import { PlayCircle, CheckCircle2, Bookmark, BookmarkCheck, List, GripVertical, Star } from 'lucide-react'
import GameCard from '../components/GameCard'
import AddGamesModal from '../components/AddGamesModal'
import ActionSheet from '../components/ActionSheet'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import ReportSheet from '../components/ReportSheet'
import EmptyState from '../components/EmptyState'
import { showToast } from '../components/Toast'
import InlineErrorBanner from '../components/InlineErrorBanner'
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
import { supabase } from '../services/supabase'
import './ListDetail.css'

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/* ── Per-cover status dot (owner's tracker status, real data only) ──
   Cool/jewel-tone status tokens only — no orange/amber. 'want' gets a
   neutral tertiary dot rather than --status-warning (which is amber). */
const STATUS_DOT_COLOR = {
  played: 'var(--status-success)',
  currently: 'var(--color-status-playing)',
  dropped: 'var(--status-danger)',
  want: 'var(--color-text-tertiary)',
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
  const [listInfo, setListInfo] = useState(null)
  const [games, setGames] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showActionSheet, setShowActionSheet] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAddGames, setShowAddGames] = useState(false)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [reportSheetOpen, setReportSheetOpen] = useState(false)
  const [dmShareOpen, setDmShareOpen] = useState(false)
  const [collaborators, setCollaborators] = useState([])
  const [showCollaboratorSheet, setShowCollaboratorSheet] = useState(false)

  // Save state (public custom lists)
  const [saveCount, setSaveCount] = useState(0)
  const [isSaved, setIsSaved] = useState(false)

  // Drag-to-reorder state (custom lists, owner only)
  const dragGameIdRef = useRef(null)
  const [dragOverId, setDragOverId] = useState(null)
  // Refs to each grid-item DOM node so we can set draggable imperatively from the handle
  const itemEls = useRef({})
  // Tracks which handle triggered the current drag; prevents whole-card drags
  const handleActiveRef = useRef(null)

  // Owner ratings: { [igdbGameId]: rating }
  const [ownerRatings, setOwnerRatings] = useState({})

  // Owner tracker data (status + hours): { [igdbGameId]: { status, hoursPlayed } }
  // Powers the stats row's Played/Total-hours cells and the per-cover status dot.
  const [ownerTrackerData, setOwnerTrackerData] = useState({})

  // Inline description editing
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const descTextareaRef = useRef(null)

  const isTracker = isTrackerList(listId)

  // ── Session ───────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUserId(user?.id ?? null)
    })
  }, [])

  // ── Data loading ──────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    setLoadError(false)
    if (isTracker) {
      const info = getListInfo(listId)
      setListInfo(info)
      setGames(info ? getGamesFromList(listId) : [])
      setCollaborators([])
      setIsLoading(false)
    } else {
      try {
        const data = await getListById(listId)
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

  useEffect(() => {
    setIsLoading(true)
    refresh()
    const handler = () => refresh()
    window.addEventListener('libraryUpdated', handler)
    return () => window.removeEventListener('libraryUpdated', handler)
  }, [refresh])

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

  const handleRemoveGame = async (gameId, gameTitle) => {
    setGames((prev) => prev.filter((g) => g.id !== gameId))
    try {
      await removeGameFromList(listId, gameId)
      window.dispatchEvent(new Event('libraryUpdated'))
      showToast(`Removed \u201c${gameTitle}\u201d`, 'success')
    } catch {
      refresh()
      showToast('Failed to remove game. Please try again.', 'error')
    }
  }

  // ── Drag-to-reorder (custom lists, owner only) ───────────────────────────
  // Drag is initiated ONLY from the handle button. We imperatively toggle
  // the `draggable` attribute on the grid-item DOM node so that clicking
  // anywhere else on the card never starts a drag.

  const activateDragHandle = (gameId) => {
    handleActiveRef.current = gameId
    const el = itemEls.current[gameId]
    if (el) el.draggable = true
  }

  const deactivateDragHandle = (gameId) => {
    handleActiveRef.current = null
    const el = itemEls.current[gameId]
    if (el) el.draggable = false
  }

  const handleDragStart = (e, gameId) => {
    if (handleActiveRef.current !== gameId) {
      e.preventDefault()
      return
    }
    dragGameIdRef.current = gameId
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e, gameId) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(gameId)
  }

  const handleDrop = async (e, targetId) => {
    e.preventDefault()
    const sourceId = dragGameIdRef.current
    setDragOverId(null)
    dragGameIdRef.current = null

    if (!sourceId || sourceId === targetId) return

    const arr = [...games]
    const fromIdx = arr.findIndex((g) => g.id === sourceId)
    const toIdx = arr.findIndex((g) => g.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return

    const [moved] = arr.splice(fromIdx, 1)
    arr.splice(toIdx, 0, moved)

    // Optimistic update
    setGames(arr)

    try {
      await reorderListGames(listId, arr.map((g) => g.id))
    } catch {
      refresh()
      showToast('Failed to save new order. Please try again.', 'error')
    }
  }

  const handleDragEnd = (gameId) => {
    deactivateDragHandle(gameId)
    setDragOverId(null)
    dragGameIdRef.current = null
  }

  // ── Cover upload ──────────────────────────────────────────────────────────

  // ── Main action sheet items ───────────────────────────────────────────────
  // Owner sees Duplicate + Delete. Non-owner sees Report list.

  const actionSheetItems = isOwner
    ? [
        {
          label: isPinned ? 'Unpin from profile' : 'Pin to profile',
          onClick: handlePinToggle,
        },
        {
          label: 'Manage collaborators',
          onClick: () => setShowCollaboratorSheet(true),
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
        {
          label: 'Report list',
          onClick: () => setReportSheetOpen(true),
        },
      ]

  // ── Inline description editing ────────────────────────────────────────────

  const openDescEdit = () => {
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

  // Viewer can add games only if they own the list, are a collaborator, or it's a personal tracker list
  const canEdit = isOwner || isCollaborator || isTracker

  // ── Stats row (custom lists only) — real data, never fabricated ─────────
  // Avg rating excludes games the owner hasn't rated (not counted as 0).
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

  const author = listInfo.author

  return (
    <div className="list-detail-page content-fade-in">

      {/* 0. Hero — blurred, low-opacity cover mosaic behind the sticky header +
          title, fading to the page base color. Custom lists only; decorative,
          so it's skipped entirely when there are no covers to build it from. */}
      {!isTracker && games.length > 0 && (
        <div className="ld-hero" aria-hidden="true">
          <div className="ld-hero__mosaic">
            {games.slice(0, 6).map((g, i) => (
              <div className="ld-hero__cell" key={g.id ?? i}>
                {g.image && <img src={g.image} alt="" loading="lazy" />}
              </div>
            ))}
          </div>
          <div className="ld-hero__fade" />
        </div>
      )}

      {/* 1. Header bar — sticky, safe-area-aware, chevron left + "List" centre + actions right */}
      <header className="list-detail-header-bar">
        <button
          type="button"
          className="list-detail-back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>

        <span className="list-detail-header-label">{listInfo.name}</span>

        <div className="list-detail-header-actions">
          {canEdit && (
            <button
              type="button"
              className="list-detail-header-icon-btn"
              onClick={() => setShowAddGames(true)}
              aria-label="Add games"
            >
              <HiPlus size={20} aria-hidden="true" />
            </button>
          )}
          {listInfo.isCustom && listInfo.isPublic && currentUserId && (
            <button
              type="button"
              className="list-detail-header-icon-btn"
              onClick={() => setDmShareOpen(true)}
              aria-label="Share list via DM"
            >
              <HiOutlineShare size={20} aria-hidden="true" />
            </button>
          )}
          {listInfo.isCustom && listInfo.isPublic && !isOwner && currentUserId && (
            <button
              type="button"
              className={`list-detail-header-icon-btn${isSaved ? ' list-detail-save-btn--saved' : ''}`}
              onClick={handleSaveToggle}
              aria-label={isSaved ? 'Remove from saved lists' : 'Save list'}
              aria-pressed={isSaved}
            >
              {isSaved
                ? <BookmarkCheck size={20} aria-hidden="true" />
                : <Bookmark size={20} aria-hidden="true" />
              }
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

      {/* 2. Title + byline + collaborators + description + stats + actions —
          custom lists only. Tracker lists' getListInfo() never populates
          author/createdAt/description, so this block never rendered for
          them before this restyle either; `isTracker` is guarded explicitly
          here so that stays true regardless. */}
      {!isTracker && (
        <div className="list-detail-body">
          {/* Title — its own line, large. The "+" add-games control lives
              only in the sticky header above; it is never inline with this
              title, so there's nothing glued together here. */}
          <h1 className="ld-title">{listInfo.name}</h1>

          {/* Byline — owner avatar + "{username} · {created date}" + saved count */}
          {(author || listInfo.createdAt) && (
            <div className="ld-byline">
              {author && (
                <>
                  <button
                    type="button"
                    className="ld-byline-author"
                    onClick={() => author.username && navigate(`/profile/${author.username}`)}
                  >
                    {author.avatarUrl ? (
                      <img
                        src={author.avatarUrl}
                        alt=""
                        className="ld-byline-avatar"
                        loading="lazy"
                      />
                    ) : (
                      <span className="ld-byline-avatar ld-byline-avatar--fallback" aria-hidden="true">
                        {(author.displayName || author.username || '?').charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="ld-byline-name">
                      {author.displayName || author.username}
                    </span>
                  </button>
                  {listInfo.createdAt && <span className="ld-byline-dot" aria-hidden="true">·</span>}
                </>
              )}
              {listInfo.createdAt && (
                <span className="ld-byline-item">{fmtDate(listInfo.createdAt)}</span>
              )}
              {listInfo.isCustom && listInfo.isPublic && saveCount > 0 && (
                <>
                  <span className="ld-byline-dot" aria-hidden="true">·</span>
                  <span className="ld-byline-item">
                    saved by {saveCount} {saveCount === 1 ? 'person' : 'people'}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Collaborator avatars row — only shown when there are co-editors */}
          {collaborators.length > 0 && (
            <div className="list-detail-collab-row">
              <div className="list-detail-collab-avatars">
                {collaborators.slice(0, 5).map((c) => (
                  c.avatarUrl ? (
                    <img
                      key={c.userId}
                      src={c.avatarUrl}
                      alt={c.displayName || c.username}
                      className="list-detail-collab-avatar"
                      loading="lazy"
                    />
                  ) : (
                    <span
                      key={c.userId}
                      className="list-detail-collab-avatar list-detail-collab-avatar--fallback"
                      aria-hidden="true"
                    >
                      {(c.displayName || c.username || '?').charAt(0).toUpperCase()}
                    </span>
                  )
                ))}
                {collaborators.length > 5 && (
                  <span className="list-detail-collab-avatar list-detail-collab-avatar--overflow">
                    +{collaborators.length - 5}
                  </span>
                )}
              </div>
              <span className="list-detail-collab-label">
                {collaborators.length === 1
                  ? '1 co-editor'
                  : `${collaborators.length} co-editors`}
              </span>
              {isOwner && (
                <button
                  type="button"
                  className="list-detail-collab-manage-btn"
                  onClick={() => setShowCollaboratorSheet(true)}
                >
                  Manage
                </button>
              )}
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
                className="list-detail-description list-detail-description--editable"
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
                className="list-detail-desc-placeholder"
                onClick={openDescEdit}
              >
                Add a description…
              </button>
            )
          ) : (
            listInfo.description && (
              <p className="list-detail-description">{listInfo.description}</p>
            )
          )}

          {/* Stats row — single bounded card, cells with dividers. Real
              data only: Avg rating excludes games the owner hasn't rated
              (not counted as 0) and hides entirely if nothing is rated. */}
          {games.length > 0 && (
            <div className="ld-stats-card">
              <div className="ld-stats-cell">
                <span className="ld-stats-value">{games.length}</span>
                <span className="ld-stats-label">Games</span>
              </div>
              <div className="ld-stats-cell">
                <span className="ld-stats-value">{playedCount}</span>
                <span className="ld-stats-label">Played</span>
              </div>
              {avgRating != null && (
                <div className="ld-stats-cell">
                  <span className="ld-stats-value ld-stats-value--grad">
                    {avgRating.toFixed(1)}
                  </span>
                  <span className="ld-stats-label">Avg rating</span>
                </div>
              )}
              <div className="ld-stats-cell">
                <span className="ld-stats-value">{Math.round(totalHours)}h</span>
                <span className="ld-stats-label">Total</span>
              </div>
            </div>
          )}

          {/* Actions — state-adaptive. Owner (canEdit) gets "Add games";
              non-owner on a public list gets "Save · {count}". A
              collaborator who isn't the owner can legitimately see both
              (same dual condition the header actions already use above). */}
          {(canEdit || (listInfo.isCustom && listInfo.isPublic && !isOwner && currentUserId)) && (
            <div className="ld-actions-row">
              {canEdit && (
                <button
                  type="button"
                  className="ld-action-btn"
                  onClick={() => setShowAddGames(true)}
                >
                  <HiPlus size={16} aria-hidden="true" />
                  Add games
                </button>
              )}
              {listInfo.isCustom && listInfo.isPublic && !isOwner && currentUserId && (
                <button
                  type="button"
                  className={`ld-action-btn${isSaved ? ' ld-action-btn--saved' : ''}`}
                  onClick={handleSaveToggle}
                  aria-pressed={isSaved}
                >
                  {isSaved
                    ? <BookmarkCheck size={16} aria-hidden="true" />
                    : <Bookmark size={16} aria-hidden="true" />
                  }
                  Save · {saveCount}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 5. Games — tracker gets rich row list; custom lists keep the grid */}
      <div className={`list-detail-content${isTracker ? ' list-detail-content--tracker' : ''}`}>
        <p className="list-detail-game-count">
          {games.length} {games.length === 1 ? 'game' : 'games'}
        </p>

        {isTracker ? (
          /* Rich tracker view: row cards with progress, hours, sort/filter, bulk select */
          games.length > 0 ? (
            <TrackerGameList listId={listId} games={games} />
          ) : (
            <ListDetailEmpty
              listId={listId}
              isTracker={isTracker}
              onAddGames={() => setShowAddGames(true)}
              onFindGames={() => navigate('/search')}
            />
          )
        ) : (
          /* Custom list: 3-up cover grid, titles below, drag reorder */
          games.length > 0 ? (
            <div className="list-detail-grid" ref={gridRef}>
              {games.map((game) => {
                const rating = ownerRatings[game.id]
                const trackerStatus = ownerTrackerData[game.id]?.status
                const dotColor = trackerStatus ? STATUS_DOT_COLOR[trackerStatus] : null
                return (
                  <div
                    key={game.id}
                    ref={(el) => { if (el) itemEls.current[game.id] = el }}
                    className={`list-detail-grid-item${
                      (isOwner || isCollaborator) && dragOverId === game.id ? ' drag-over' : ''
                    }`}
                    onDragStart={(isOwner || isCollaborator) ? (e) => handleDragStart(e, game.id) : undefined}
                    onDragOver={(isOwner || isCollaborator) ? (e) => handleDragOver(e, game.id) : undefined}
                    onDrop={(isOwner || isCollaborator) ? (e) => handleDrop(e, game.id) : undefined}
                    onDragEnd={(isOwner || isCollaborator) ? () => handleDragEnd(game.id) : undefined}
                  >
                    <div className="ld-grid-cover">
                      <GameCard game={game} titleOverlay={false} />

                      {/* Status dot — owner's real tracker status only */}
                      {dotColor && (
                        <span
                          className="ld-grid-status-dot"
                          style={{ '--dot-color': dotColor }}
                          aria-hidden="true"
                        />
                      )}

                      {/* Rating badge — owner's real rating only */}
                      {rating != null && (
                        <div className="list-detail-rating-badge" aria-label={`Your rating: ${rating}`}>
                          <Star size={9} aria-hidden="true" />
                          {rating}
                        </div>
                      )}

                      {/* Drag handle */}
                      {(isOwner || isCollaborator) && (
                        <button
                          type="button"
                          className="list-detail-drag-handle"
                          aria-label={`Drag to reorder ${game.title}`}
                          onPointerDown={() => activateDragHandle(game.id)}
                          onPointerUp={() => deactivateDragHandle(game.id)}
                          onPointerCancel={() => deactivateDragHandle(game.id)}
                        >
                          <GripVertical size={14} aria-hidden="true" />
                        </button>
                      )}

                      {/* Remove button */}
                      {(isOwner || isCollaborator) && (
                        <button
                          type="button"
                          className="list-detail-remove-button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveGame(game.id, game.title)
                          }}
                          aria-label={`Remove ${game.title}`}
                          title="Remove from list"
                        >
                          ×
                        </button>
                      )}
                    </div>

                    {/* Title — below the cover, not overlaid */}
                    <p className="ld-grid-title">{game.title}</p>
                  </div>
                )
              })}
            </div>
          ) : (
            <ListDetailEmpty
              listId={listId}
              isTracker={isTracker}
              onAddGames={() => setShowAddGames(true)}
              onFindGames={() => navigate('/search')}
            />
          )
        )}
      </div>

      {listInfo.isCustom && (
        <ListComments
          listId={listId}
          currentUserId={currentUserId}
          isOwner={isOwner}
        />
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
    </div>
  )
}

export default ListDetail

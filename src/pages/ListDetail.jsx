import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAutoAnimateMotion } from '../hooks/useMotionPreference'
import { LuChevronLeft } from 'react-icons/lu'
import { HiDotsVertical, HiPlus } from 'react-icons/hi'
import { PlayCircle, CheckCircle2, Bookmark, BookmarkCheck, List } from 'lucide-react'
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
  isTrackerList,
  pinList,
  unpinList,
  updateList,
} from '../services/listService'
import {
  getListSaveState,
  saveList,
  unsaveList,
} from '../services/listInteractionService'
import ListComments from '../components/ListComments'
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

  // Save state (public custom lists)
  const [saveCount, setSaveCount] = useState(0)
  const [isSaved, setIsSaved] = useState(false)

  // Drag-to-reorder state (custom lists only)
  const dragGameIdRef = useRef(null)
  const [dragOverId, setDragOverId] = useState(null)

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
      setIsLoading(false)
    } else {
      try {
        const data = await getListById(listId)
        setListInfo(data)
        setGames(data?.games || [])
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

  // ── Drag-to-reorder (custom lists only) ──────────────────────────────────

  const handleDragStart = (e, gameId) => {
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

    setGames(arr)

    try {
      await reorderListGames(
        listId,
        arr.map((g) => g.id)
      )
    } catch {
      refresh()
      showToast('Failed to save new order. Please try again.', 'error')
    }
  }

  const handleDragEnd = () => {
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

  // Viewer can add games only if they own the list or it's a personal tracker list
  const canEdit = isOwner || isTracker

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

      {/* 2. Meta / description body — only rendered when there is content to show */}
      {(author || listInfo.createdAt || listInfo.description || isOwner) && (
        <div className="list-detail-body">
          {/* Author + date row (game count moves below the divider, above the grid) */}
          {(author || listInfo.createdAt) && (
            <div className="list-detail-meta-row">
              {author && (
                <>
                  <button
                    type="button"
                    className="list-detail-author-btn"
                    onClick={() => author.username && navigate(`/profile/${author.username}`)}
                  >
                    {author.avatarUrl ? (
                      <img
                        src={author.avatarUrl}
                        alt=""
                        className="list-detail-author-avatar"
                        loading="lazy"
                      />
                    ) : (
                      <span className="list-detail-author-avatar list-detail-author-avatar--fallback" aria-hidden="true">
                        {(author.displayName || author.username || '?').charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="list-detail-author-name">
                      {author.displayName || author.username}
                    </span>
                  </button>
                  {listInfo.createdAt && <span className="list-detail-meta-dot" aria-hidden="true">·</span>}
                </>
              )}
              {listInfo.createdAt && (
                <span className="list-detail-meta-item">{fmtDate(listInfo.createdAt)}</span>
              )}
              {listInfo.isCustom && listInfo.isPublic && saveCount > 0 && (
                <>
                  <span className="list-detail-meta-dot" aria-hidden="true">·</span>
                  <span className="list-detail-meta-item">
                    saved by {saveCount} {saveCount === 1 ? 'person' : 'people'}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Description — inline edit for owner, read-only for viewer */}
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
        </div>
      )}

      {/* 5. Games grid */}
      <div className="list-detail-content">
        <p className="list-detail-game-count">
          {games.length} {games.length === 1 ? 'game' : 'games'}
        </p>
        {games.length > 0 ? (
          <div className="list-detail-grid" ref={gridRef}>
            {games.map((game) => (
              <div
                key={game.id}
                className={`list-detail-grid-item${
                  isOwner && dragOverId === game.id ? ' drag-over' : ''
                }`}
                draggable={isOwner}
                onDragStart={isOwner ? (e) => handleDragStart(e, game.id) : undefined}
                onDragOver={isOwner ? (e) => handleDragOver(e, game.id) : undefined}
                onDrop={isOwner ? (e) => handleDrop(e, game.id) : undefined}
                onDragEnd={isOwner ? handleDragEnd : undefined}
              >
                <GameCard game={game} />
                {isOwner && (
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
            ))}
          </div>
        ) : (
          <ListDetailEmpty
            listId={listId}
            isTracker={isTracker}
            onAddGames={() => setShowAddGames(true)}
            onFindGames={() => navigate('/search')}
          />
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
    </div>
  )
}

export default ListDetail

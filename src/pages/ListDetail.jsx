import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAutoAnimateMotion } from '../hooks/useMotionPreference'
import { LuChevronLeft } from 'react-icons/lu'
import { HiDotsVertical, HiPlus, HiPencil } from 'react-icons/hi'
import { PlayCircle, CheckCircle2, Bookmark, List } from 'lucide-react'
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
} from '../services/listService'
import { uploadListCover, removeListCover } from '../services/listCoverService'
import { supabase } from '../services/supabase'
import './ListDetail.css'

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
  const [showCoverActionSheet, setShowCoverActionSheet] = useState(false)
  const [isUploadingCover, setIsUploadingCover] = useState(false)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [reportSheetOpen, setReportSheetOpen] = useState(false)

  // Cover image displayed in the hero — may differ from listInfo.coverImageUrl
  // immediately after an upload (cache-busted URL) before a refresh occurs.
  const [coverDisplay, setCoverDisplay] = useState(null)

  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)

  // Drag-to-reorder state (custom lists only)
  const dragGameIdRef = useRef(null)
  const [dragOverId, setDragOverId] = useState(null)

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
        setCoverDisplay(data?.coverImageUrl || null)
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

  const handleFileSelected = async (file) => {
    if (!file) return
    setIsUploadingCover(true)
    try {
      const url = await uploadListCover(listId, file)
      setCoverDisplay(url)
      window.dispatchEvent(new Event('libraryUpdated'))
      showToast('Cover updated', 'success')
    } catch (err) {
      showToast(err.message || 'Failed to upload cover.', 'error')
    } finally {
      setIsUploadingCover(false)
      // Reset inputs so re-selecting the same file triggers onChange again.
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (cameraInputRef.current) cameraInputRef.current.value = ''
    }
  }

  const handleRemoveCover = async () => {
    setIsUploadingCover(true)
    try {
      await removeListCover(listId, currentUserId)
      setCoverDisplay(null)
      window.dispatchEvent(new Event('libraryUpdated'))
      showToast('Cover removed', 'success')
    } catch (err) {
      showToast(err.message || 'Failed to remove cover.', 'error')
    } finally {
      setIsUploadingCover(false)
    }
  }

  // ── Cover action sheet ────────────────────────────────────────────────────

  const coverActionItems = [
    {
      label: 'Photo Library',
      onClick: () => fileInputRef.current?.click(),
    },
    {
      label: 'Take Photo',
      onClick: () => cameraInputRef.current?.click(),
    },
    ...(coverDisplay
      ? [
          {
            label: 'Remove custom cover',
            destructive: true,
            onClick: handleRemoveCover,
          },
        ]
      : []),
  ]

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

  // ── Cover area (for custom lists) ─────────────────────────────────────────

  const previewGames = listInfo?.previewGames || games.slice(0, 4)
  const mosaicAlt = previewGames.length > 0
    ? `${listInfo?.name ?? 'List'} — covers of ${previewGames
        .map((g) => g.title)
        .filter(Boolean)
        .join(', ')}`
    : `${listInfo?.name ?? 'List'} cover`

  function CoverArea() {
    if (!listInfo?.isCustom) return null

    return (
      <div className="list-detail-cover">
        {coverDisplay ? (
          <img
            src={coverDisplay}
            alt={`${listInfo.name} cover`}
            className="list-detail-cover__img"
            draggable={false}
          />
        ) : (
          <div className="list-detail-cover__mosaic" aria-label={mosaicAlt} role="img">
            {Array.from({ length: 4 }).map((_, idx) => {
              const g = previewGames[idx]
              return (
                <div
                  key={g?.id || `ph-${idx}`}
                  className={`list-detail-cover__mosaic-cell${
                    g ? '' : ' list-detail-cover__mosaic-cell--empty'
                  }`}
                >
                  {g?.image ? (
                    <img
                      src={g.image}
                      alt=""
                      className="list-detail-cover__mosaic-img"
                      loading="lazy"
                      draggable={false}
                    />
                  ) : g ? (
                    <div className="list-detail-cover__mosaic-fallback">
                      {g.title?.charAt(0) || '?'}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        {isOwner && (
          <button
            type="button"
            className="list-detail-cover__edit-btn"
            onClick={() => setShowCoverActionSheet(true)}
            aria-label="Edit cover image"
            disabled={isUploadingCover}
          >
            {isUploadingCover ? (
              <span className="list-detail-cover__spinner" aria-hidden="true" />
            ) : (
              <HiPencil aria-hidden="true" />
            )}
          </button>
        )}

        {isUploadingCover && (
          <div className="list-detail-cover__uploading-overlay" aria-hidden="true">
            <span className="list-detail-cover__spinner list-detail-cover__spinner--lg" />
          </div>
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="list-detail-page list-detail-page--loading" aria-busy="true" aria-label="Loading list">
        <div className="ld-sk-cover skeleton" aria-hidden="true" />
        <div className="ld-sk-body" aria-hidden="true">
          <div className="ld-sk-title skeleton" />
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

  return (
    <div className="list-detail-page content-fade-in">
      {/* 1. Back bar — always first, sits below the iOS status bar */}
      <div className="list-detail-back-bar">
        <button
          type="button"
          className="list-detail-back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>
      </div>

      {/* 2. Cover collage — below the back bar, never in the status bar */}
      <CoverArea />

      <header className="list-detail-header">
        <div className="list-detail-header-row">
          <div className="list-detail-title-block">
            <span className="list-detail-eyebrow">
              {listInfo.isCustom ? 'List' : 'Tracker'}
            </span>
            <h1 className="list-detail-title">{listInfo.name}</h1>
            {listInfo.description && (
              <p className="list-detail-description">{listInfo.description}</p>
            )}
            <p className="list-detail-meta">
              {games.length} {games.length === 1 ? 'game' : 'games'}
            </p>
          </div>

          <div className="list-detail-actions">
            <button
              className="list-detail-action-button"
              onClick={() => setShowAddGames(true)}
              aria-label="Add games"
              title="Add games"
            >
              <HiPlus />
              <span className="list-detail-action-label">Add Games</span>
            </button>

            {listInfo.isCustom && (
              <button
                className="list-detail-icon-button"
                onClick={() => setShowActionSheet(true)}
                aria-haspopup="dialog"
                aria-label="More options"
              >
                <HiDotsVertical />
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="list-detail-content">
        {games.length > 0 ? (
          <div className="list-detail-grid" ref={gridRef}>
            {games.map((game) => (
              <div
                key={game.id}
                className={`list-detail-grid-item${
                  listInfo.isCustom && dragOverId === game.id
                    ? ' drag-over'
                    : ''
                }`}
                draggable={listInfo.isCustom}
                onDragStart={
                  listInfo.isCustom
                    ? (e) => handleDragStart(e, game.id)
                    : undefined
                }
                onDragOver={
                  listInfo.isCustom
                    ? (e) => handleDragOver(e, game.id)
                    : undefined
                }
                onDrop={
                  listInfo.isCustom
                    ? (e) => handleDrop(e, game.id)
                    : undefined
                }
                onDragEnd={listInfo.isCustom ? handleDragEnd : undefined}
              >
                <GameCard game={game} />
                {listInfo.isCustom && (
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

      {/* Hidden file inputs for cover upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => handleFileSelected(e.target.files?.[0])}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => handleFileSelected(e.target.files?.[0])}
      />

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
        isOpen={showCoverActionSheet}
        onClose={() => setShowCoverActionSheet(false)}
        title="Edit cover"
        items={coverActionItems}
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

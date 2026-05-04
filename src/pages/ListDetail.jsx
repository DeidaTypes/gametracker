import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAutoAnimateMotion } from '../hooks/useMotionPreference'
import { HiDotsVertical, HiPlus, HiArrowLeft } from 'react-icons/hi'
import GameCard from '../components/GameCard'
import AddGamesModal from '../components/AddGamesModal'
import ActionSheet from '../components/ActionSheet'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { showToast } from '../components/Toast'
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
} from '../services/listService'
import './ListDetail.css'

function ListDetail() {
  const { listId } = useParams()
  const navigate = useNavigate()
  const [gridRef] = useAutoAnimateMotion()
  const [listInfo, setListInfo] = useState(null)
  const [games, setGames] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [showActionSheet, setShowActionSheet] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAddGames, setShowAddGames] = useState(false)

  // Drag-to-reorder state (custom lists only)
  const dragGameIdRef = useRef(null)
  const [dragOverId, setDragOverId] = useState(null)

  const isTracker = isTrackerList(listId)

  const refresh = useCallback(async () => {
    if (isTracker) {
      // Tracker lists (Currently Playing, Played, etc.) remain localStorage
      const info = getListInfo(listId)
      setListInfo(info)
      setGames(info ? getGamesFromList(listId) : [])
      setIsLoading(false)
    } else {
      // Custom lists → Supabase
      const data = await getListById(listId)
      setListInfo(data)
      setGames(data?.games || [])
      setIsLoading(false)
    }
  }, [listId, isTracker])

  useEffect(() => {
    setIsLoading(true)
    refresh()
    const handler = () => refresh()
    window.addEventListener('libraryUpdated', handler)
    return () => window.removeEventListener('libraryUpdated', handler)
  }, [refresh])

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
    // Optimistic UI update
    setGames((prev) => prev.filter((g) => g.id !== gameId))
    try {
      await removeGameFromList(listId, gameId)
      window.dispatchEvent(new Event('libraryUpdated'))
      showToast(`Removed \u201c${gameTitle}\u201d`, 'success')
    } catch {
      // Roll back
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

    // Optimistic update
    setGames(arr)

    try {
      await reorderListGames(
        listId,
        arr.map((g) => g.id)
      )
    } catch {
      // Roll back
      refresh()
      showToast('Failed to save new order. Please try again.', 'error')
    }
  }

  const handleDragEnd = () => {
    setDragOverId(null)
    dragGameIdRef.current = null
  }

  // ── Action sheet items ────────────────────────────────────────────────────

  const actionSheetItems = [
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

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="list-detail-page">
        <div className="list-detail-empty">
          <p>Loading…</p>
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
    <div className="list-detail-page">
      <header className="list-detail-header">
        <button
          className="list-detail-back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <HiArrowLeft />
          <span>Back</span>
        </button>

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
          <div className="list-detail-empty">
            <p>This list doesn&rsquo;t have any games yet.</p>
            <button
              className="list-detail-back-button"
              onClick={() => setShowAddGames(true)}
            >
              Add Games
            </button>
          </div>
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
    </div>
  )
}

export default ListDetail

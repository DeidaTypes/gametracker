import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  getAllLists,
  addGameToList,
  removeGameFromList,
  isGameInList,
  getListInfo,
  getGameStatus,
  setGameStatus,
} from '../services/libraryService'
import './AddToListButton.css'

const STATUS_TILES = [
  {
    key: 'want',
    listId: 'want-to-play',
    label: 'Want to Play',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    key: 'currently',
    listId: 'currently-playing',
    label: 'Currently Playing',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="8" cy="12" r="2" />
        <path d="M15 10h2" />
        <path d="M17 12h2" />
        <path d="M15 14h2" />
      </svg>
    ),
  },
  {
    key: 'played',
    listId: 'played',
    label: 'Finished Playing',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  {
    key: 'dropped',
    listId: 'dropped',
    label: 'Dropped',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
]

function AddToListButton({ game, variant, fabStyle }) {
  const [isOpen, setIsOpen] = useState(false)
  const [lists, setLists] = useState({})
  const [gameInLists, setGameInLists] = useState({})
  const [currentStatus, setCurrentStatus] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragY, setDragY] = useState(0)

  const sheetRef = useRef(null)
  const dragStartY = useRef(0)

  const refresh = useCallback(() => {
    setLists(getAllLists())
    const allLists = getAllLists()
    const inLists = {}
    Object.keys(allLists).forEach((listId) => {
      inLists[listId] = isGameInList(listId, game?.id)
    })
    setGameInLists(inLists)
    setCurrentStatus(getGameStatus(game?.id))
  }, [game?.id])

  useEffect(() => {
    if (game) refresh()
  }, [game, refresh])

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      refresh()
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen, refresh])

  const dismiss = useCallback(() => {
    setIsOpen(false)
    setDragY(0)
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, dismiss])

  const handleStatusTap = (statusKey) => {
    if (!game) return
    if (currentStatus === statusKey) return
    setGameStatus(game.id, statusKey, game)
    refresh()
    window.dispatchEvent(new Event('libraryUpdated'))
  }

  const handleListToggle = (listId) => {
    if (!game) return
    if (gameInLists[listId]) {
      removeGameFromList(listId, game.id)
    } else {
      addGameToList(listId, game)
    }
    refresh()
    window.dispatchEvent(new Event('libraryUpdated'))
  }

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: game.title, url: window.location.href })
      } catch {}
    } else {
      navigator.clipboard?.writeText(window.location.href)
    }
  }

  const onTouchStart = (e) => {
    dragStartY.current = e.touches[0].clientY
    setIsDragging(true)
  }

  const onTouchMove = (e) => {
    if (!isDragging) return
    const dy = e.touches[0].clientY - dragStartY.current
    if (dy > 0) setDragY(dy)
  }

  const onTouchEnd = () => {
    if (dragY > 120) {
      dismiss()
    } else {
      setDragY(0)
    }
    setIsDragging(false)
  }

  if (!game) return null

  const isIcon = variant === 'icon'

  const statusLabel = currentStatus
    ? STATUS_TILES.find((t) => t.key === currentStatus)?.label || 'In Library'
    : null

  const customListIds = Object.keys(lists).filter((id) => id.startsWith('custom-'))

  return (
    <div className={`add-to-list-container${isIcon ? ' add-to-list-container--icon' : ''}`}>
      <button
        onClick={() => setIsOpen(true)}
        className={isIcon ? 'gd-action-circle' : 'add-to-list-button'}
        style={isIcon && fabStyle ? fabStyle : undefined}
        aria-label="Add to list"
      >
        {isIcon ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        ) : (
          'Add to List'
        )}
      </button>

      {isOpen && createPortal(
        <div className="bs-portal">
          <div className="bs-backdrop" onClick={dismiss} />
          <div
            className={`bs-sheet${isDragging ? ' bs-sheet--dragging' : ''}`}
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
          >
            <div
              className="bs-drag-zone"
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              <div className="bs-handle" />
            </div>

            <div className="bs-header">
              <div className="bs-header-cover">
                <img
                  src={game.image || 'https://via.placeholder.com/60x80/1a1a1a/ffffff?text=?'}
                  alt={game.title}
                  onError={(e) => {
                    e.target.src = 'https://via.placeholder.com/60x80/1a1a1a/ffffff?text=?'
                  }}
                />
              </div>
              <div className="bs-header-info">
                <span className="bs-header-title">{game.title}</span>
                <span className="bs-header-status">
                  {statusLabel || 'Not in Library'}
                </span>
              </div>
              <button className="bs-close-btn" onClick={dismiss} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="bs-body">
              <div className="bs-status-grid">
                {STATUS_TILES.map((tile) => (
                  <button
                    key={tile.key}
                    className={`bs-tile${currentStatus === tile.key ? ' bs-tile--active' : ''}`}
                    onClick={() => handleStatusTap(tile.key)}
                  >
                    <div className="bs-tile-icon">{tile.icon}</div>
                    <span className="bs-tile-label">{tile.label}</span>
                  </button>
                ))}
              </div>

              {customListIds.length > 0 && (
                <div className="bs-lists-section">
                  <h4 className="bs-lists-heading">MY LISTS</h4>
                  {customListIds.map((listId) => {
                    const info = getListInfo(listId)
                    if (!info) return null
                    const inList = gameInLists[listId]
                    return (
                      <button
                        key={listId}
                        className={`bs-list-row${inList ? ' bs-list-row--active' : ''}`}
                        onClick={() => handleListToggle(listId)}
                      >
                        <span className="bs-list-name">{info.name}</span>
                        {inList && (
                          <svg className="bs-list-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default AddToListButton

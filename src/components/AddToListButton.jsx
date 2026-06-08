import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useDragControls } from 'motion/react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import {
  getAllLists,
  addGameToList,
  removeGameFromList,
  isGameInList,
  getListInfo,
  getGameStatus,
  setGameStatus,
} from '../services/libraryService'
import { COVER_FALLBACK } from '../utils/coverFallback'
import './AddToListButton.css'

const STATUS_TILES = [
  {
    key: 'want',
    listId: 'want-to-play',
    label: 'Want to Play',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    key: 'currently',
    listId: 'currently-playing',
    label: 'Currently Playing',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
]

function AddToListButton({ game, variant, fabStyle }) {
  const { reduced } = useMotionPreference()
  const dragControls = useDragControls()
  const [isOpen, setIsOpen] = useState(false)
  const [lists, setLists] = useState({})
  const [gameInLists, setGameInLists] = useState({})
  const [currentStatus, setCurrentStatus] = useState(null)

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
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, dismiss])

  // Consistent 300 ms-feel spring shared with the app's other bottom
  // sheets (ReportSheet). Reduced motion → instant swap.
  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.2 }
  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }

  // Swipe-down-to-dismiss. Drag is initiated only from the grab handle
  // (dragListener={false}) so the body's own scroll still works.
  const handleDragEnd = (_e, info) => {
    if (info.offset.y > 110 || info.velocity.y > 600) dismiss()
  }

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

      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <motion.div
              className="bs-backdrop"
              onClick={dismiss}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={backdropTransition}
            >
              <motion.div
                className="bs-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="Set game status"
                onClick={(e) => e.stopPropagation()}
                initial={reduced ? false : { y: '100%' }}
                animate={{ y: 0 }}
                exit={reduced ? { y: 0 } : { y: '100%' }}
                transition={sheetTransition}
                drag={reduced ? false : 'y'}
                dragControls={dragControls}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={handleDragEnd}
              >
                <div
                  className="bs-drag-zone"
                  onPointerDown={(e) => !reduced && dragControls.start(e)}
                >
                  <div className="bs-handle" />
                </div>

                <div className="bs-header">
                  <div className="bs-header-cover">
                    <img
                      src={game.image || COVER_FALLBACK}
                      alt={game.title}
                      onError={(e) => {
                        e.target.src = COVER_FALLBACK
                      }}
                    />
                  </div>
                  <div className="bs-header-info">
                    <span className="bs-header-title">{game.title}</span>
                    <span className="bs-header-status">
                      {statusLabel || 'Not in Library'}
                    </span>
                  </div>
                </div>

                <div className="bs-body">
                  <div className="bs-status-list" role="group" aria-label="Status">
                    {STATUS_TILES.map((tile) => {
                      const active = currentStatus === tile.key
                      return (
                        <button
                          key={tile.key}
                          className={`bs-status-row${active ? ' bs-status-row--active' : ''}`}
                          onClick={() => handleStatusTap(tile.key)}
                          aria-pressed={active}
                        >
                          <span className="bs-status-row-icon">{tile.icon}</span>
                          <span className="bs-status-row-label">{tile.label}</span>
                          {active && (
                            <svg className="bs-status-row-check" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  {customListIds.length > 0 && (
                    <div className="bs-lists-section">
                      <h4 className="bs-lists-heading">MY LISTS</h4>
                      <div className="bs-status-list">
                        {customListIds.map((listId) => {
                          const info = getListInfo(listId)
                          if (!info) return null
                          const inList = gameInLists[listId]
                          return (
                            <button
                              key={listId}
                              className={`bs-status-row${inList ? ' bs-status-row--active' : ''}`}
                              onClick={() => handleListToggle(listId)}
                              aria-pressed={inList}
                            >
                              <span className="bs-status-row-label">{info.name}</span>
                              {inList && (
                                <svg className="bs-status-row-check" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}

export default AddToListButton

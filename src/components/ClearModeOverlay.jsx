import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import SharedCover from './SharedCover'
import { getBestImageUrl } from '../services/imageUtils'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { useMotionPreference } from '../hooks/useMotionPreference'
import './ClearModeOverlay.css'

const HINT_KEY = 'cp:clearModeHintSeen'
const FADE_MS = 180
const HINT_VISIBLE_MS = 2000
const HINT_FADE_MS = 300

function hasSeenHint() {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return false
  }
}

function markHintSeen() {
  try {
    localStorage.setItem(HINT_KEY, '1')
  } catch {
    // best-effort
  }
}

function scrollOffsetForListGrid() {
  const scrollEl = document.querySelector('.main-content')
  if (!scrollEl) return 0
  const grid =
    document.querySelector('.list-detail-page .game-grid') ||
    document.querySelector('.list-detail-page .list-body')
  if (!grid) return Math.max(0, scrollEl.scrollTop)
  const scrollRect = scrollEl.getBoundingClientRect()
  const gridRect = grid.getBoundingClientRect()
  const offset = scrollEl.scrollTop + (gridRect.top - scrollRect.top)
  return Math.max(0, offset)
}

function ClearModePoster({ game }) {
  const imageUrl = getBestImageUrl(game, 800) || game.image
  return (
    <div className="clear-overlay__item">
      <div className="clear-overlay__cover">
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
      </div>
      <p className="clear-overlay__title">{game.title}</p>
    </div>
  )
}

function stopToPage(e) {
  e.stopPropagation()
}

export default function ClearModeOverlay({ games, onClose }) {
  const rootRef = useRef(null)
  const closingRef = useRef(false)
  const { reduced: reducedMotion } = useMotionPreference()
  const [phase, setPhase] = useState(reducedMotion ? 'visible' : 'enter')
  const [showHint, setShowHint] = useState(false)
  const [hintFading, setHintFading] = useState(false)

  useEffect(() => {
    const el = rootRef.current
    if (el) {
      el.scrollTop = scrollOffsetForListGrid()
    }
    if (reducedMotion) return undefined
    const id = requestAnimationFrame(() => {
      setPhase('visible')
    })
    return () => cancelAnimationFrame(id)
  }, [reducedMotion])

  useEffect(() => {
    if (hasSeenHint()) return undefined
    markHintSeen()
    setShowHint(true)
    const fadeTimer = setTimeout(() => setHintFading(true), HINT_VISIBLE_MS)
    const hideTimer = setTimeout(
      () => setShowHint(false),
      HINT_VISIBLE_MS + HINT_FADE_MS
    )
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(hideTimer)
    }
  }, [])

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    if (reducedMotion) {
      onClose()
      return
    }
    setPhase('exit')
    window.setTimeout(() => {
      onClose()
    }, FADE_MS)
  }, [onClose, reducedMotion])

  const handleRootClick = useCallback(
    (e) => {
      e.stopPropagation()
      requestClose()
    },
    [requestClose]
  )

  return createPortal(
    <div
      ref={rootRef}
      className={`clear-overlay clear-overlay--${phase}`}
      role="dialog"
      aria-modal="true"
      aria-label="Clear mode"
      onClick={handleRootClick}
      onPointerDown={stopToPage}
      onPointerUp={stopToPage}
      onTouchStart={stopToPage}
      onTouchEnd={stopToPage}
    >
      <div className="clear-overlay__status-fade" aria-hidden="true" />
      <div className="clear-overlay__grid">
        {games.map((game) => (
          <ClearModePoster key={game.id} game={game} />
        ))}
      </div>
      {showHint && (
        <p
          className={`clear-overlay__hint text-caption${hintFading ? ' clear-overlay__hint--fade' : ''}`}
          aria-hidden="true"
        >
          Tap anywhere to exit
        </p>
      )}
    </div>,
    document.body
  )
}

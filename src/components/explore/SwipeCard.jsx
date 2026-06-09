import React, { useRef, useState, useCallback } from 'react'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import './SwipeCard.css'

const SWIPE_THRESHOLD = 80 // px horizontal drag to trigger swipe action

/**
 * Derive a short display label from a comma-separated genre string.
 * "Role-playing (RPG), Adventure" → "RPG"
 * "Real Time Strategy (RTS)"      → "RTS"
 * "Adventure"                     → "Adventure"
 */
function firstGenreLabel(genreStr) {
  if (!genreStr) return null
  const first = genreStr.split(',')[0].trim()
  const parens = first.match(/\(([^)]+)\)/)
  if (parens) return parens[1]
  return first.length > 20 ? first.slice(0, 18) + '…' : first
}

/**
 * SwipeCard — one game card in the "Swipe to discover" deck.
 *
 * Top card (isTop=true): responds to pointer drag gestures. Swiping past
 * SWIPE_THRESHOLD left/right calls the respective callback after a brief
 * exit animation (skipped when prefers-reduced-motion is active).
 *
 * Stack cards (stackIndex 1-2): visually scaled and offset behind the top
 * card. Not interactive. Transition smoothly to a new position when the top
 * card is removed.
 *
 * Props
 *   game           { id, title, image, year, genre, developer }
 *   stackIndex     0 = top, 1 = mid, 2 = back
 *   isTop          true only for the interactive top card
 *   onSwipeRight   (game) => void  called after exit animation completes
 *   onSwipeLeft    (game) => void  called after exit animation completes
 */
export function SwipeCard({ game, stackIndex, isTop, onSwipeRight, onSwipeLeft }) {
  const { reduced } = useMotionPreference()

  // Drag tracking — ref for latest value (no stale closures in handlers),
  // state for reactive rendering.
  const dragRef = useRef({ x: 0, y: 0 })
  const [dragDisplay, setDragDisplay] = useState({ x: 0, y: 0 })
  const startRef = useRef(null)
  const draggingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)

  // Exit animation state — ref prevents double-trigger from racing gestures.
  const exitingRef = useRef(null) // 'left' | 'right' | null
  const [exiting, setExiting] = useState(null)

  const triggerSwipe = useCallback(
    (dir) => {
      if (exitingRef.current) return // already mid-exit
      exitingRef.current = dir

      if (reduced) {
        // No animation — callback fires immediately.
        exitingRef.current = null
        dir === 'right' ? onSwipeRight(game) : onSwipeLeft(game)
      } else {
        setExiting(dir)
        setTimeout(() => {
          exitingRef.current = null
          setExiting(null)
          dragRef.current = { x: 0, y: 0 }
          setDragDisplay({ x: 0, y: 0 })
          dir === 'right' ? onSwipeRight(game) : onSwipeLeft(game)
        }, 290)
      }
    },
    [reduced, onSwipeRight, onSwipeLeft, game]
  )

  // Allow parent (SwipeDeck action buttons) to trigger a swipe via this prop.
  // When the prop changes from null to a direction, we run the same exit path.
  // Prop is reset to null by the parent after the callback fires.
  const onPointerDown = (e) => {
    if (!isTop || exitingRef.current) return
    e.preventDefault()
    startRef.current = { x: e.clientX, y: e.clientY }
    draggingRef.current = true
    setIsDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e) => {
    if (!draggingRef.current || !startRef.current) return
    const dx = e.clientX - startRef.current.x
    const dy = e.clientY - startRef.current.y
    dragRef.current = { x: dx, y: dy }
    setDragDisplay({ x: dx, y: dy })
  }

  const onPointerUp = useCallback(() => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setIsDragging(false)
    const { x } = dragRef.current
    if (x > SWIPE_THRESHOLD) triggerSwipe('right')
    else if (x < -SWIPE_THRESHOLD) triggerSwipe('left')
    else {
      dragRef.current = { x: 0, y: 0 }
      setDragDisplay({ x: 0, y: 0 })
    }
  }, [triggerSwipe])

  const coverUrl  = game.image || game.coverUrl || null
  const genreTag  = firstGenreLabel(game.genre)

  // Compute transform + transition for this card's position in the stack.
  let transform = ''
  let transition = ''

  if (isTop) {
    if (reduced) {
      transform = ''
      transition = 'none'
    } else if (exiting) {
      const exitX = exiting === 'right' ? '115vw' : '-115vw'
      const rot   = exiting === 'right' ? '28deg' : '-28deg'
      transform  = `translateX(${exitX}) rotate(${rot})`
      transition = 'transform 0.29s ease-in'
    } else {
      const { x, y } = dragDisplay
      transform  = `translate(${x}px, ${y * 0.12}px) rotate(${x * 0.04}deg)`
      transition = isDragging ? 'none' : 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    }
  } else {
    const scales = [1, 0.96, 0.92]
    const ys     = [0, 10, 20]
    const scale  = scales[stackIndex] ?? 0.92
    const y      = ys[stackIndex]     ?? 20
    transform  = `translateY(${y}px) scale(${scale})`
    transition = reduced ? 'none' : 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
  }

  // Direction badge opacity — fades in linearly as drag approaches threshold.
  const rightOpa = isTop ? Math.min(1, Math.max(0, dragDisplay.x / SWIPE_THRESHOLD)) : 0
  const leftOpa  = isTop ? Math.min(1, Math.max(0, -dragDisplay.x / SWIPE_THRESHOLD)) : 0

  return (
    <div
      className={[
        'swipe-card',
        `swipe-card--stack-${stackIndex}`,
        isTop ? 'swipe-card--top' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ transform, transition, touchAction: isTop ? 'none' : 'auto' }}
      onPointerDown={isTop ? onPointerDown : undefined}
      onPointerMove={isTop ? onPointerMove : undefined}
      onPointerUp={isTop ? onPointerUp : undefined}
      onPointerCancel={isTop ? onPointerUp : undefined}
      role={isTop ? 'img' : undefined}
      aria-label={
        isTop
          ? `${game.title}${game.year ? `, ${game.year}` : ''}`
          : undefined
      }
    >
      {/* Cover image fills the full card */}
      <div className="swipe-card__cover">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            className="swipe-card__img"
            draggable="false"
          />
        ) : (
          <div className="swipe-card__placeholder" aria-hidden="true">
            {game.title?.charAt(0) ?? '?'}
          </div>
        )}
      </div>

      {/* Gradient overlay — fades the bottom so text stays readable */}
      <div className="swipe-card__gradient" aria-hidden="true" />

      {/* Genre tag + title + year */}
      <div className="swipe-card__info" aria-hidden="true">
        {genreTag && (
          <span className="swipe-card__genre">{genreTag}</span>
        )}
        <p className="swipe-card__title">{game.title}</p>
        {game.year ? <p className="swipe-card__year">{game.year}</p> : null}
      </div>

      {/* Direction feedback badges — shown while dragging */}
      {isTop && (
        <>
          <div
            className="swipe-card__badge swipe-card__badge--right"
            style={{ opacity: rightOpa }}
            aria-hidden="true"
          >
            ♥ Backlog
          </div>
          <div
            className="swipe-card__badge swipe-card__badge--left"
            style={{ opacity: leftOpa }}
            aria-hidden="true"
          >
            ✕ Skip
          </div>
        </>
      )}
    </div>
  )
}

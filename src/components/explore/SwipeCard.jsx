import React, { useRef, useState, useCallback } from 'react'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import './SwipeCard.css'

const SWIPE_THRESHOLD = 80 // px horizontal drag to trigger swipe action
const TAP_THRESHOLD   = 10 // px — total movement below this = tap, not swipe

/**
 * SwipeCard — one Tinder-style game card in the "Swipe to discover" deck.
 *
 * The card is slim: cover art fills the frame; a single frosted bottom overlay
 * carries the title, year, and a one-line reason built from the overlap
 * between this game's genres and the user's WHOLE taste vector (matchGenres),
 * plus the ✕ (skip) and ♥ (backlog) actions. Deliberately NOT a single-seed
 * "like {game}" attribution — that framing belongs to the page's "Because
 * You Played" closer rail, not the broad-exploration swipe deck.
 *
 * Top card (isTop=true): responds to pointer drag gestures and shows the
 * action buttons. Swiping past SWIPE_THRESHOLD left/right calls the respective
 * callback after a brief exit animation (skipped when prefers-reduced-motion
 * is active). With reduced motion the on-card buttons are the primary path.
 *
 * Stack cards (stackIndex 1-2): visually scaled/offset behind the top card,
 * not interactive.
 *
 * Props
 *   game           { id, title, image, year, matchGenres, matchScore }
 *   stackIndex     0 = top, 1 = mid, 2 = back
 *   isTop          true only for the interactive top card
 *   onSwipeRight   (game) => void  called after exit animation completes (♥)
 *   onSwipeLeft    (game) => void  called after exit animation completes (✕)
 *   onTap          (game) => void  card body tapped → open detail
 */
export function SwipeCard({ game, stackIndex, isTop, onSwipeRight, onSwipeLeft, onTap }) {
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
    const { x, y } = dragRef.current
    if (x > SWIPE_THRESHOLD) {
      triggerSwipe('right')
    } else if (x < -SWIPE_THRESHOLD) {
      triggerSwipe('left')
    } else if (Math.abs(x) < TAP_THRESHOLD && Math.abs(y) < TAP_THRESHOLD) {
      // Pure tap — reset drag state then navigate; card stays in deck
      dragRef.current = { x: 0, y: 0 }
      setDragDisplay({ x: 0, y: 0 })
      onTap?.(game)
    } else {
      // Partial drag — snap card back
      dragRef.current = { x: 0, y: 0 }
      setDragDisplay({ x: 0, y: 0 })
    }
  }, [triggerSwipe, onTap, game])

  const coverUrl = game.image || game.coverUrl || null

  // Broad taste-vector reason (never a single-seed "like {game}" line —
  // that framing is reserved for the Because You Played rail). Prefer the
  // genre overlap; fall back to the match score when no genre overlap was
  // found so the card still shows *some* honest signal.
  const reasonText = game.matchGenres?.length
    ? game.matchGenres.join(' & ')
    : game.matchScore
    ? `${Math.round(game.matchScore)}% taste match`
    : null

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

  // Buttons must not start a drag or bubble to the card-tap handler.
  const stop = (e) => e.stopPropagation()

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
          ? `${game.title}${game.year ? `, ${game.year}` : ''}${reasonText ? `. Matches your taste: ${reasonText}` : ''}`
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

      {/* Bottom overlay — title + year + reason + on-card actions */}
      <div className="swipe-card__overlay">
        <p className="swipe-card__title">{game.title}</p>

        <p className="swipe-card__meta">
          {game.year ? <span className="swipe-card__year">{game.year}</span> : null}
          {game.year && reasonText ? (
            <span className="swipe-card__dot" aria-hidden="true">·</span>
          ) : null}
          {reasonText ? (
            <span className="swipe-card__why">
              <span className="swipe-card__why-spark" aria-hidden="true">✦</span>
              {reasonText}
            </span>
          ) : null}
        </p>

        {isTop && (
          <div className="swipe-card__actions">
            <button
              type="button"
              className="swipe-card__act swipe-card__act--skip"
              onPointerDown={stop}
              onClick={(e) => { stop(e); triggerSwipe('left') }}
              aria-label={`Skip ${game.title}`}
            >
              <span aria-hidden="true">✕</span>
            </button>
            <button
              type="button"
              className="swipe-card__act swipe-card__act--add"
              onPointerDown={stop}
              onClick={(e) => { stop(e); triggerSwipe('right') }}
              aria-label={`Add ${game.title} to backlog`}
            >
              <span aria-hidden="true">♥</span>
            </button>
          </div>
        )}
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

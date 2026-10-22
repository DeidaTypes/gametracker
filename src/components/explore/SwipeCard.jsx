import React, { useRef, useState, useCallback } from 'react'
import Avatar from '../Avatar'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import { hapticImpact } from '../../utils/haptics'
import { flyToTab } from '../../utils/flyToTab'
import { SwipeCardCover } from './SwipeCardCover'
import './SwipeCard.css'

const SWIPE_THRESHOLD = 80 // px horizontal drag to trigger swipe action
const TAP_THRESHOLD   = 10 // px — total movement below this = tap, not swipe

/** Build "{year} · Genre & Genre · ~{n}h main" — omit missing segments. */
function buildMetaLine(game, mainHours) {
  const parts = []
  if (game.year) parts.push(String(game.year))

  const genreNames = (
    game.genres?.length
      ? game.genres
      : (game.genre ? game.genre.split(',').map((g) => g.trim()) : [])
  ).filter(Boolean).slice(0, 2)
  if (genreNames.length > 0) {
    parts.push(
      <span key="genres" className="swipe-card__meta-genres">
        {genreNames.join(', ')}
      </span>
    )
  }

  if (typeof mainHours === 'number' && mainHours > 0) {
    parts.push(`~${mainHours}h main`)
  }

  if (parts.length === 0) return null

  return parts.reduce((acc, part, i) => {
    if (i > 0) acc.push(<span key={`sep-${i}`} className="swipe-card__meta-sep" aria-hidden="true">·</span>)
    acc.push(part)
    return acc
  }, [])
}

function buildCircleLine(circleSignal) {
  if (!circleSignal || circleSignal.count <= 0) return null
  if (circleSignal.lineType === 'want') {
    return `${circleSignal.count} in your circle want to play this`
  }
  return `${circleSignal.count} in your circle played this`
}

/**
 * SwipeCard — one Tinder-style game card in the "Swipe to discover" deck.
 *
 * Cover art fills the frame; a bottom overlay carries title, meta, optional
 * circle social line, and the ✕ (skip) / ♥ (backlog) actions.
 *
 * Top card (isTop=true): responds to pointer drag gestures and shows the
 * action buttons. Swiping past SWIPE_THRESHOLD left/right calls the respective
 * callback after a brief exit animation (skipped when prefers-reduced-motion
 * is active). With reduced motion the on-card buttons are the primary path.
 *
 * Stack cards (stackIndex 1-2): visually scaled/offset behind the top card,
 * not interactive.
 */
export function SwipeCard({
  game,
  circleSignal,
  mainHours,
  stackIndex,
  isTop,
  onSwipeRight,
  onSwipeLeft,
  onTap,
}) {
  const { reduced } = useMotionPreference()

  const dragRef = useRef({ x: 0, y: 0 })
  const [dragDisplay, setDragDisplay] = useState({ x: 0, y: 0 })
  const startRef = useRef(null)
  const draggingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)

  const exitingRef = useRef(null)
  const coverRef = useRef(null)
  const [exiting, setExiting] = useState(null)

  const triggerSwipe = useCallback(
    (dir) => {
      if (exitingRef.current) return
      exitingRef.current = dir

      if (dir === 'right') {
        hapticImpact('Light')
        flyToTab(coverRef.current, 'library')
      }

      if (reduced) {
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
      dragRef.current = { x: 0, y: 0 }
      setDragDisplay({ x: 0, y: 0 })
      onTap?.(game)
    } else {
      dragRef.current = { x: 0, y: 0 }
      setDragDisplay({ x: 0, y: 0 })
    }
  }, [triggerSwipe, onTap, game])

  const metaLine = buildMetaLine(game, mainHours)
  const circleLine = buildCircleLine(circleSignal)
  const circleUsers = circleLine ? (circleSignal?.users || []).slice(0, 3) : []

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

  const rightOpa = isTop ? Math.min(1, Math.max(0, dragDisplay.x / SWIPE_THRESHOLD)) : 0
  const leftOpa  = isTop ? Math.min(1, Math.max(0, -dragDisplay.x / SWIPE_THRESHOLD)) : 0

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
          ? `${game.title}${circleLine ? `. ${circleLine}` : ''}`
          : undefined
      }
    >
      <div className="swipe-card__cover">
        <SwipeCardCover
          game={game}
          isTop={isTop}
          reduced={reduced}
          coverRef={coverRef}
        />
      </div>

      <div className="swipe-card__gradient" aria-hidden="true" />

      <div className="swipe-card__overlay">
        <p className="swipe-card__title">{game.title}</p>

        {metaLine && (
          <p className="swipe-card__meta">{metaLine}</p>
        )}

        {circleLine && (
          <div className="swipe-card__social">
            <div className="swipe-card__social-avatars" aria-hidden="true">
              {circleUsers.map((u) => (
                <Avatar
                  key={u.userId}
                  user={u}
                  className="swipe-card__social-avatar"
                />
              ))}
            </div>
            <p className="swipe-card__social-text">{circleLine}</p>
          </div>
        )}

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

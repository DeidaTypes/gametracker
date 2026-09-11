import React, { useState, useCallback, useEffect, useRef, useId } from 'react'
import { STAR_ICON_PATH, resolveStarRatingSize } from '../starRatingConfig'
import { hapticImpact } from '../../utils/haptics'
import './forms.css'

const STARS = [1, 2, 3, 4, 5]

/** Snap a 0–1 ratio to the nearest 0.5-star step, clamped 0–5. */
function ratioToRating(ratio) {
  const raw = ratio * 5
  const snapped = Math.round(raw * 2) / 2
  return Math.max(0, Math.min(5, snapped))
}

/**
 * Interactive star rating input with half-star support, hover preview,
 * drag-to-rate (0–5 in 0.5 steps), and a brief scale punch animation
 * on the just-selected star.
 *
 * (Formerly `forms/StarRating.jsx` — renamed to disambiguate it from the
 * read-only `StarRatingDisplay.jsx`, which has a different job. They
 * share the same size scale via `starRatingConfig.js`.)
 *
 * Props:
 *   value: number (0–5, halves allowed)
 *   onChange: (next: number) => void
 *   size: 'xs'|'sm'|'md'|'lg'|'xl'|'xxl' | number(px) — shared scale with
 *         StarRatingDisplay, see starRatingConfig.js (default 'xl', 32px)
 *   readOnly: boolean
 */
function StarRatingInput({
  value = 0,
  onChange,
  size = 'xl',
  readOnly = false,
  className = '',
  'aria-label': ariaLabel = 'Rating',
}) {
  const uid = useId()
  const rowRef = useRef(null)
  const dragSessionRef = useRef(null)
  const [hover, setHover] = useState(0)
  const [punchIndex, setPunchIndex] = useState(null)
  const punchTimerRef = useRef(null)
  const px = resolveStarRatingSize(size)

  useEffect(() => {
    return () => {
      if (punchTimerRef.current) clearTimeout(punchTimerRef.current)
    }
  }, [])

  const triggerPunch = useCallback((star) => {
    setPunchIndex(star)
    if (punchTimerRef.current) clearTimeout(punchTimerRef.current)
    punchTimerRef.current = setTimeout(() => setPunchIndex(null), 240)
  }, [])

  const ratingFromClientX = useCallback((clientX) => {
    const el = rowRef.current
    if (!el) return value
    const { left, width } = el.getBoundingClientRect()
    if (width <= 0) return 0
    return ratioToRating((clientX - left) / width)
  }, [value])

  const applyRating = useCallback(
    (next, { haptic = false, punch = false } = {}) => {
      if (readOnly) return

      const session = dragSessionRef.current
      const prev = session?.lastValue ?? value

      if (next === prev && !punch) return

      if (haptic && next !== prev) {
        hapticImpact('Light')
      }

      onChange?.(next)
      if (session) {
        session.lastValue = next
      }

      if (punch && next > 0) {
        triggerPunch(Math.ceil(next))
      }
    },
    [readOnly, onChange, value, triggerPunch]
  )

  // Refs keep native touchmove listener callbacks current without re-binding.
  const ratingFromClientXRef = useRef(ratingFromClientX)
  const applyRatingRef = useRef(applyRating)
  ratingFromClientXRef.current = ratingFromClientX
  applyRatingRef.current = applyRating

  // Non-passive backstop: React registers touch listeners as passive, so
  // preventDefault on synthetic pointermove may be ignored in WKWebView.
  // This listener is attached for the duration of each drag session only.
  const handleNativeTouchMove = useCallback((e) => {
    const session = dragSessionRef.current
    if (!session) return
    if (e.touches.length !== 1) return

    e.preventDefault()
    session.moved = true
    const next = ratingFromClientXRef.current(e.touches[0].clientX)
    applyRatingRef.current(next, { haptic: true })
  }, [])

  const cleanupDragSession = useCallback(
    (session) => {
      if (!session) return
      try {
        session.captureEl.releasePointerCapture(session.pointerId)
      } catch {
        /* capture may already be released */
      }
      if (session.onNativeTouchMove) {
        session.captureEl.removeEventListener(
          'touchmove',
          session.onNativeTouchMove
        )
      }
    },
    []
  )

  const endDragSession = useCallback(
    (e, { commitFromPointer = true } = {}) => {
      const session = dragSessionRef.current
      if (!session || session.pointerId !== e.pointerId) return

      if (commitFromPointer) {
        const finalValue = ratingFromClientXRef.current(e.clientX)
        applyRatingRef.current(finalValue, { punch: true })
      } else if (session.lastValue != null) {
        // pointercancel — commit last known value rather than reverting
        applyRatingRef.current(session.lastValue, { punch: true })
      }

      cleanupDragSession(session)
      dragSessionRef.current = null
      setHover(0)
    },
    [cleanupDragSession]
  )

  const handleRowPointerDown = useCallback(
    (e) => {
      if (readOnly) return
      if (e.pointerType === 'mouse' && e.button !== 0) return

      const captureEl = e.currentTarget
      try {
        captureEl.setPointerCapture(e.pointerId)
      } catch {
        /* some engines reject capture for inactive pointer ids */
      }

      setHover(0)

      const session = {
        pointerId: e.pointerId,
        captureEl,
        lastValue: value,
        moved: false,
      }
      dragSessionRef.current = session

      // Immediate rating from press position — a tap is just down+up here.
      const next = ratingFromClientXRef.current(e.clientX)
      applyRatingRef.current(next)

      if (e.pointerType === 'touch') {
        session.onNativeTouchMove = handleNativeTouchMove
        captureEl.addEventListener('touchmove', handleNativeTouchMove, {
          passive: false,
        })
      }
    },
    [readOnly, value, handleNativeTouchMove]
  )

  const handleRowPointerMove = useCallback((e) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== e.pointerId) return

    session.moved = true
    const next = ratingFromClientXRef.current(e.clientX)
    applyRatingRef.current(next, { haptic: true })
  }, [])

  const handleRowPointerUp = useCallback(
    (e) => endDragSession(e, { commitFromPointer: true }),
    [endDragSession]
  )

  const handleRowPointerCancel = useCallback(
    (e) => endDragSession(e, { commitFromPointer: false }),
    [endDragSession]
  )

  const displayed = hover > 0 ? hover : value
  const isPreview = hover > 0 && hover !== value

  const renderStar = (star) => {
    const filled = star <= Math.floor(displayed)
    const half =
      !filled && star === Math.ceil(displayed) && displayed % 1 !== 0
    const empty = !filled && !half

    const state = filled ? 'filled' : half ? 'half' : 'empty'
    const isPunching = punchIndex === star

    const classes = [
      'form-star',
      `form-star--${state}`,
      isPreview && (filled || half) ? 'form-star--preview' : '',
      isPunching ? 'form-star--punch' : '',
    ]
      .filter(Boolean)
      .join(' ')

    // uid is unique per component instance — prevents duplicate-id warnings
    // when multiple pickers appear on the same page.
    const clipId = `fsc-${uid.replace(/:/g, '')}-${star}`

    return (
      <span key={star} className={classes}>
        <svg
          className="form-star__icon"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y="0" width="12" height="24" />
            </clipPath>
          </defs>
          <path
            className="form-star__outline"
            d={STAR_ICON_PATH}
          />
          <path
            className="form-star__fill"
            d={STAR_ICON_PATH}
            clipPath={half ? `url(#${clipId})` : undefined}
          />
        </svg>

        {!readOnly && (
          <>
            {/* Hover preview is intentionally MOUSE/PEN-ONLY (pointerType
                check below). Touch has no real "hovering" — browsers fire
                a synthetic mouseenter for a tap without a matching leave,
                which used to leave `hover` stuck on some other star than
                the one actually committed (filled-star count and the "N
                out of 5" label would then disagree). Gating on pointerType
                means touch taps only ever affect `hover` via the explicit
                setHover(0) in endDragSession above, so display always
                tracks the real committed value on touch. Selection itself
                is handled by the row-level pointer handlers — these
                buttons are hover targets for mouse/pen only. */}
            <button
              type="button"
              className="form-star__half-btn form-star__half-btn--left"
              tabIndex={-1}
              aria-hidden="true"
              onPointerEnter={(e) => { if (e.pointerType !== 'touch') setHover(star - 0.5) }}
              onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHover(0) }}
            />
            <button
              type="button"
              className="form-star__half-btn form-star__half-btn--right"
              tabIndex={-1}
              aria-hidden="true"
              onPointerEnter={(e) => { if (e.pointerType !== 'touch') setHover(star) }}
              onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHover(0) }}
            />
          </>
        )}
      </span>
    )
  }

  return (
    <div
      ref={rowRef}
      className={[
        'form-stars',
        readOnly ? 'form-stars--readonly' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--star-rating-size': `${px}px` }}
      role={readOnly ? 'img' : 'group'}
      aria-label={readOnly ? `${value} out of 5 stars` : ariaLabel}
      onPointerDown={readOnly ? undefined : handleRowPointerDown}
      onPointerMove={readOnly ? undefined : handleRowPointerMove}
      onPointerUp={readOnly ? undefined : handleRowPointerUp}
      onPointerCancel={readOnly ? undefined : handleRowPointerCancel}
      onPointerLeave={readOnly ? undefined : () => setHover(0)}
    >
      {STARS.map(renderStar)}
    </div>
  )
}

export default StarRatingInput

import React, { useState, useCallback, useEffect, useRef, useId } from 'react'
import { STAR_ICON_PATH, resolveStarRatingSize } from '../starRatingConfig'
import './forms.css'

const STARS = [1, 2, 3, 4, 5]

/**
 * Interactive star rating input with half-star support, hover preview,
 * and a brief scale punch animation on the just-selected star.
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

  const handleSelect = useCallback(
    (next, star) => {
      if (readOnly) return
      onChange?.(next)
      triggerPunch(star)
    },
    [readOnly, onChange, triggerPunch]
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
            <button
              type="button"
              className="form-star__half-btn form-star__half-btn--left"
              onClick={() => handleSelect(star - 0.5, star)}
              onMouseEnter={() => setHover(star - 0.5)}
              onMouseLeave={() => setHover(0)}
              aria-label={`Rate ${star - 0.5} of 5`}
            />
            <button
              type="button"
              className="form-star__half-btn form-star__half-btn--right"
              onClick={() => handleSelect(star, star)}
              onMouseEnter={() => setHover(star)}
              onMouseLeave={() => setHover(0)}
              aria-label={`Rate ${star} of 5`}
            />
          </>
        )}
      </span>
    )
  }

  return (
    <div
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
      onPointerLeave={readOnly ? undefined : () => setHover(0)}
    >
      {STARS.map(renderStar)}
    </div>
  )
}

export default StarRatingInput

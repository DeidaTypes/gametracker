import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import PlatformIcon from './PlatformIcon'
import './PlatformStep.css'

// Ids are what users.platforms stores.
const PLATFORMS = [
  { id: 'playstation', label: 'PlayStation' },
  { id: 'xbox', label: 'Xbox' },
  { id: 'nintendo', label: 'Nintendo' },
  { id: 'pc', label: 'PC' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'retro', label: 'Retro' },
]

// `year` is what users.gaming_since stores: the first year of the decade.
const DECADES = [
  { year: 1980, label: '80s' },
  { year: 1990, label: '90s' },
  { year: 2000, label: '2000s' },
  { year: 2010, label: '2010s' },
  { year: 2020, label: '2020s' },
]

/**
 * Step 2, "Where do you play?". Six platform tiles, then one "since when" rail:
 * tap the decade you started and the accent bar stretches from it to 2020s,
 * because nobody stopped playing in the 2000s. Tap that decade again to clear.
 * Saving happens in the frame's Continue (Onboarding.jsx).
 */
export default function PlatformStep({
  platforms,
  onTogglePlatform,
  gamingSince,
  onPickGamingSince,
}) {
  const railBarRef = useRef(null)
  const decadeRefs = useRef([])
  // Whether the bar is currently showing, so a first pick can grow it out of
  // the tapped decade instead of fading in already stretched.
  const barShownRef = useRef(false)

  const startIndex = DECADES.findIndex((d) => d.year === gamingSince)

  // Put the bar over [start decade .. 2020s]. offsetLeft/offsetWidth are
  // relative to the rail and ignore the step's slide transform.
  const placeBar = useCallback(() => {
    const bar = railBarRef.current
    const first = decadeRefs.current[startIndex]
    const last = decadeRefs.current[DECADES.length - 1]
    if (!bar || !first || !last) return
    bar.style.left = `${first.offsetLeft}px`
    bar.style.width = `${last.offsetLeft + last.offsetWidth - first.offsetLeft}px`
  }, [startIndex])

  useLayoutEffect(() => {
    const bar = railBarRef.current
    const first = decadeRefs.current[startIndex]
    if (!bar) return
    if (startIndex < 0 || !first) {
      barShownRef.current = false
      bar.classList.remove('ob-rail__bar--on')
      return
    }
    if (!barShownRef.current) {
      // First pick: start the bar exactly on the tapped decade, no transition,
      // then let placeBar() stretch it to 2020s with the transition back on.
      bar.style.transition = 'none'
      bar.style.left = `${first.offsetLeft}px`
      bar.style.width = `${first.offsetWidth}px`
      bar.classList.add('ob-rail__bar--on')
      void bar.offsetWidth
      bar.style.transition = ''
      barShownRef.current = true
    }
    placeBar()
  }, [startIndex, placeBar])

  // The rail can change width after first paint (rotation, font load).
  useEffect(() => {
    const rail = railBarRef.current?.parentElement
    if (!rail || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      if (barShownRef.current) placeBar()
    })
    observer.observe(rail)
    return () => observer.disconnect()
  }, [placeBar])

  const note =
    startIndex >= 0
      ? `Gaming since the ${DECADES[startIndex].label}`
      : 'Tap the decade you started'

  return (
    <>
      <h1 className="ob-title text-display-l">Where do you play?</h1>
      <p className="ob-sub text-body">Pick all that apply. It shapes what we suggest.</p>

      <div className="ob-plat" role="group" aria-label="Platforms you play on">
        {PLATFORMS.map((platform) => {
          const picked = platforms.includes(platform.id)
          return (
            <button
              key={platform.id}
              type="button"
              className={`ob-pt${picked ? ' ob-pt--on' : ''}`}
              aria-pressed={picked}
              onClick={() => onTogglePlatform(platform.id)}
            >
              <span className="ob-pt__icon">
                <PlatformIcon id={platform.id} />
              </span>
              <span>{platform.label}</span>
            </button>
          )
        })}
      </div>

      <h2 className="ob-sec text-label">Since when</h2>
      <div className="ob-rail" role="group" aria-label="Since when">
        {DECADES.map((decade, i) => (
          <button
            key={decade.year}
            ref={(el) => {
              decadeRefs.current[i] = el
            }}
            type="button"
            className={`ob-era${startIndex >= 0 && i >= startIndex ? ' ob-era--on' : ''}`}
            aria-pressed={i === startIndex}
            onClick={() => onPickGamingSince(decade.year)}
          >
            {decade.label}
          </button>
        ))}
        <span ref={railBarRef} className="ob-rail__bar" aria-hidden="true" />
      </div>
      <p className="ob-note text-caption" aria-live="polite">
        {note}
      </p>
    </>
  )
}

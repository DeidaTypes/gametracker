import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useScroll, useMotionValueEvent } from 'motion/react'

/** Within this distance of scrollTop 0 the nav always stays visible. */
const NEAR_TOP_PX = 8
/** Downward scroll must exceed this before hiding (avoids jitter). */
const SCROLL_DOWN_THRESHOLD_PX = 12

/**
 * Tracks scroll direction on the app's shared scroll container (`.main-content`)
 * and returns whether the bottom nav should hide.
 *
 * Rules:
 *   - Near the top (scrollTop ≤ NEAR_TOP_PX) → always visible
 *   - Scrolling down past SCROLL_DOWN_THRESHOLD_PX → hidden
 *   - Any upward scroll → visible immediately
 *
 * Driven by Motion's `useScroll({ container })` so work is scheduled on the
 * same rAF tick Motion uses — no separate scroll listener, no layout reads.
 *
 * Separate from LIST_REORDER_DRAG_EVENT (Library drag-to-delete), which hides
 * the nav via its own class while a reorder drag is active.
 *
 * @param {React.RefObject<HTMLElement>} containerRef
 * @returns {boolean} hidden
 */
export function useNavHideOnScroll(containerRef) {
  const location = useLocation()
  const [hidden, setHidden] = useState(false)
  const { scrollY } = useScroll({ container: containerRef })

  const stateRef = useRef({
    lastY: 0,
    downAcc: 0,
    hidden: false,
  })

  // Route changes reset scroll to top — show the nav again immediately.
  useEffect(() => {
    const s = stateRef.current
    s.lastY = containerRef.current?.scrollTop ?? 0
    s.downAcc = 0
    s.hidden = false
    setHidden(false)
  }, [location.pathname, containerRef])

  useMotionValueEvent(scrollY, 'change', (y) => {
    const s = stateRef.current
    const delta = y - s.lastY
    s.lastY = y

    let next = s.hidden

    if (y <= NEAR_TOP_PX) {
      next = false
      s.downAcc = 0
    } else if (delta < 0) {
      // Any upward movement reveals immediately, even mid-scroll.
      next = false
      s.downAcc = 0
    } else if (delta > 0) {
      s.downAcc += delta
      if (s.downAcc > SCROLL_DOWN_THRESHOLD_PX) {
        next = true
      }
    }

    if (next !== s.hidden) {
      s.hidden = next
      setHidden(next)
    }
  })

  return hidden
}

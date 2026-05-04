import { useState, useRef } from 'react'
import { useScroll, useMotionValueEvent } from 'motion/react'

/**
 * Tracks scroll direction on the app's shared scroll container and derives a
 * `compact` boolean used by <BottomNav> to shrink into a centered floating
 * pill (iOS 26 tab-bar behavior).
 *
 * Rules:
 *   - Within 60 px of the top → compact = false
 *   - Scrolling DOWN past 60 px → compact = true
 *   - Scrolling UP at any point → compact = false
 *
 * Hysteresis (12 px):
 *   We accumulate downward and upward scroll deltas in separate buckets; the
 *   bucket opposite to the current movement is reset every frame. The compact
 *   flag only flips once the active bucket exceeds 12 px, so a slow / hesitant
 *   scroll can't ping-pong the bar on every micro-event.
 *
 * The hook is driven by Motion's `useScroll({ container })` so the work is
 * scheduled on the same rAF tick Motion uses for layout animations — no
 * separate scroll listener, no main-thread thrash.
 *
 * @param {React.RefObject<HTMLElement>} containerRef
 *   Ref pointing at the scrollable element (in this app: `.main-content`).
 * @returns {boolean} compact
 */
export function useTabBarCompact(containerRef) {
  const [compact, setCompact] = useState(false)
  const { scrollY } = useScroll({ container: containerRef })

  // Persist the running counters across scroll events without forcing
  // re-renders. We only call setCompact when the boolean actually flips.
  const stateRef = useRef({
    lastY: 0,
    downAcc: 0,
    upAcc: 0,
    compact: false,
  })

  useMotionValueEvent(scrollY, 'change', (y) => {
    const s = stateRef.current
    const delta = y - s.lastY
    s.lastY = y

    if (delta > 0) {
      s.downAcc += delta
      s.upAcc = 0
    } else if (delta < 0) {
      s.upAcc += -delta
      s.downAcc = 0
    }

    let next = s.compact
    if (y <= 60) {
      next = false
    } else if (!s.compact && s.downAcc > 12) {
      next = true
    } else if (s.compact && s.upAcc > 12) {
      next = false
    }

    if (next !== s.compact) {
      s.compact = next
      setCompact(next)
    }
  })

  return compact
}

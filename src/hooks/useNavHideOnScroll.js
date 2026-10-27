import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'

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
 * Attaches a passive listener to the hydrated element. The caller must pass
 * the element from state (not only a ref) so this effect re-runs once
 * `<main>` mounts after AppContent's auth/onboarding early returns.
 * Motion's useScroll binds once against a null container and never re-binds
 * when `.current` later fills — which is why hide-on-scroll was a no-op.
 *
 * Separate from LIST_REORDER_DRAG_EVENT (Library drag-to-delete), which hides
 * the nav via its own class while a reorder drag is active.
 *
 * /settings and /settings/* opt out. The nav stays visible there, so a
 * push between settings screens never pops it back in. Other screens
 * are unchanged.
 *
 * @param {HTMLElement | null} container  Hydrated `.main-content` element
 * @returns {boolean} hidden
 */
/**
 * AnimatedRoutes restores a kept tab's scroll offset with one write. That
 * is not the user scrolling, so the scroll event it causes only moves the
 * baseline instead of hiding or showing the nav.
 */
let jumpTarget = null

export function markScrollJump(top) {
  jumpTarget = top
}

function isSettingsRoute(pathname) {
  return pathname === '/settings' || pathname.startsWith('/settings/')
}

export function useNavHideOnScroll(container) {
  const location = useLocation()
  const settingsRoute = isSettingsRoute(location.pathname)
  const [hidden, setHidden] = useState(false)

  const stateRef = useRef({
    lastY: 0,
    downAcc: 0,
    hidden: false,
  })

  // Route changes reset scroll to top — show the nav again immediately.
  useEffect(() => {
    const s = stateRef.current
    s.lastY = container?.scrollTop ?? 0
    s.downAcc = 0
    s.hidden = false
    setHidden(false)
  }, [location.pathname, container])

  useEffect(() => {
    if (!container || settingsRoute) return undefined

    const s = stateRef.current
    s.lastY = container.scrollTop

    const onScroll = () => {
      const y = container.scrollTop
      if (jumpTarget !== null) {
        const jumped = Math.abs(y - jumpTarget) < 1
        jumpTarget = null
        if (jumped) {
          s.lastY = y
          s.downAcc = 0
          return
        }
      }
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

      // Scroll fires at 60–120Hz on iOS. Only commit when the boolean flips.
      if (next !== s.hidden) {
        s.hidden = next
        setHidden(next)
      }
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [container, settingsRoute])

  return settingsRoute ? false : hidden
}

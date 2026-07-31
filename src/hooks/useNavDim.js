import { useEffect } from 'react'

/**
 * Body class toggled while a day/week activity bottom sheet is open, so
 * BottomNav.css can fade the floating pill nav to ~12% opacity, drop it
 * behind the sheet's scrim, and disable its pointer events (see
 * `body.nav-dimmed .bottom-nav` in BottomNav.css).
 *
 * Reference-counted (module-level, not per-hook-instance) so that if a
 * future case ever has two nav-dimming sheets mounted at once, the class
 * only comes off the body once the last one closes — one sheet's cleanup
 * can never accidentally re-enable the nav while another is still open.
 */
let dimCount = 0

function pushNavDim() {
  dimCount += 1
  document.body.classList.add('nav-dimmed')
}

function popNavDim() {
  dimCount = Math.max(0, dimCount - 1)
  if (dimCount === 0) document.body.classList.remove('nav-dimmed')
}

/**
 * Call from any bottom sheet that shares the floating nav's footprint.
 * While `isOpen` is true the nav fades out and stops intercepting taps;
 * on close (including unmount) it fades back in automatically.
 *
 * Usage: `useNavDim(isOpen)` — see WeekDetailSheet / DayLogSheet.
 */
export function useNavDim(isOpen) {
  useEffect(() => {
    if (!isOpen) return
    pushNavDim()
    return () => popNavDim()
  }, [isOpen])
}

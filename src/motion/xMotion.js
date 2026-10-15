/**
 * Shared X-style motion.
 * One duration, one curve. Navigation slides on X. Sheets slide on Y.
 * Reduced motion is an instant swap — callers pass `reduced` from
 * useMotionPreference, which covers the OS setting and the in-app toggle.
 */

export const MOTION_MS = 340
export const MOTION_EASE_CSS = 'cubic-bezier(0.32, 0.72, 0, 1)'
export const MOTION_EASE = [0.32, 0.72, 0, 1]
export const PARALLAX = 0.3
export const DIM_OPACITY = 0.12
export const EDGE_PX = 24
export const COMMIT_PROGRESS = 0.35
export const COMMIT_VELOCITY = 0.5
export const SHEET_DISMISS_Y = 80
export const SHEET_DISMISS_V = 500

export function sheetTransition(reduced) {
  return reduced ? { duration: 0 } : { duration: MOTION_MS / 1000, ease: MOTION_EASE }
}

export function sheetDragEnd(onClose) {
  return (_e, info) => {
    if (!onClose) return
    if (info.offset.y > SHEET_DISMISS_Y || info.velocity.y > SHEET_DISMISS_V) onClose()
  }
}

/* ------------------------------------------------------------------ */
/* Hold non-placeholder updates until the slide finishes.             */
/* A section still on a placeholder applies immediately so the push   */
/* is never blank. Anything that would replace painted content waits, */
/* and never longer than one slide.                                   */
/* ------------------------------------------------------------------ */

let holding = false
let holdTimer = 0
const queued = []

function flush() {
  const batch = queued.splice(0, queued.length)
  batch.forEach((fn) => {
    try { fn() } catch (err) { console.error('[motion] deferred update failed', err) }
  })
}

export function beginContentHold() {
  if (holding) return
  holding = true
  // The slide itself is MOTION_MS, but it starts a frame later (and a
  // button-back waits two frames for layout). Hold through that, and
  // no longer — a second navigation must not stack another full slide.
  holdTimer = setTimeout(() => {
    holding = false
    holdTimer = 0
    flush()
  }, MOTION_MS + 80)
}

export function endContentHold() {
  if (holdTimer) {
    clearTimeout(holdTimer)
    holdTimer = 0
  }
  if (!holding && queued.length === 0) return
  holding = false
  flush()
}

/**
 * Run `fn` now, or after the active slide.
 * `placeholder: true` means the section has nothing painted yet — apply
 * immediately so the slide doesn't travel over an empty box.
 */
export function runAfterSlide(fn, { placeholder = false } = {}) {
  if (placeholder || !holding) {
    fn()
    return
  }
  queued.push(fn)
}

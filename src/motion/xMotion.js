/**
 * Shared motion. One source of truth for every duration and curve; the same
 * values live in theme.css as --motion-* / --ease-* for CSS.
 *
 * Three curves: `move` for anything travelling or arriving, `fade` for pure
 * opacity, `leave` for anything going away (ease-in, so it leaves instead of
 * springing back). Navigation slides on X. Sheets slide on Y.
 *
 * Reduce Motion (OS or in-app, from useMotionPreference): nothing moves,
 * everything fades in MOTION.reducedFade. Every helper takes `reduced`.
 */

export const MOTION = {
  slide: 340,
  tabOut: 200,
  tabIn: 300,
  tabRise: 8,
  segOut: 140,
  segIn: 240,
  segRise: 6,
  segMove: 280,
  popIn: 260,
  popOut: 220,
  sheetIn: 340,
  sheetOut: 280,
  arrive: 240,
  image: 240,
  toastIn: 260,
  toastOut: 220,
  toastRise: 8,
  toastSwap: 200,
  reducedFade: 150,
  // Opening the app (src/motion/bootSplash.js). bootTheme is also the literal
  // in index.html's first-frame CSS: the launch navy easing to the saved theme.
  bootTheme: 260,
  bootWait: 330, // earliest hand-off after the first frame: bootTheme plus a beat
  bootGlide: 520, // boot mascot into the sign-in mascot
  bootFade: 260, // a page or the app fading into place
  bootLeave: 280, // boot mascot grows and fades out; splash background with it
  bootReduced: 200, // Reduce Motion: everything crossfades
  bootNavDelay: 40, // nav bars trail the app fade
  bootStaggerTitle: 120, // sign-in content, in the order it arrives
  bootStaggerGroup: 160,
  bootStaggerAction: 200,
  bootStaggerFooter: 240,
  bootRedirectWait: 400, // signed out on a gated route: how long LogIn gets to take the hand-off
}

/** Signed-in hand-off: the boot mascot grows to this as it fades out. */
export const BOOT_GROW = 1.12

export const EASE = {
  move: [0.32, 0.72, 0, 1],
  fade: [0.25, 0.1, 0.25, 1],
  leave: [0.4, 0, 1, 1],
}

export const EASE_CSS = {
  move: 'cubic-bezier(0.32, 0.72, 0, 1)',
  fade: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  leave: 'cubic-bezier(0.4, 0, 1, 1)',
}

export const MOTION_MS = MOTION.slide
export const MOTION_EASE_CSS = EASE_CSS.move
export const MOTION_EASE = EASE.move
export const PARALLAX = 0.3
export const DIM_OPACITY = 0.12
export const EDGE_PX = 24
export const COMMIT_PROGRESS = 0.35
export const COMMIT_VELOCITY = 0.5
export const SHEET_DISMISS_Y = 80
export const SHEET_DISMISS_V = 500

/* ------------------------------------------------------------------ */
/* Presence helpers                                                   */
/* Each returns Motion props: spread them on a motion element inside  */
/* AnimatePresence. Variant labels are namespaced so motion children  */
/* with their own variants never inherit them.                        */
/* ------------------------------------------------------------------ */

export const VARIANT = { from: 'xmFrom', in: 'xmIn', out: 'xmOut' }

function tween(ms, ease) {
  return { duration: ms / 1000, ease }
}

const REDUCED = tween(MOTION.reducedFade, EASE.fade)
const HIDDEN = { opacity: 0 }
const SHOWN = { opacity: 1 }

function presence(from, shown, gone, enter, leave) {
  return {
    variants: {
      [VARIANT.from]: from,
      [VARIANT.in]: { ...shown, transition: enter },
      [VARIANT.out]: { ...gone, transition: leave },
    },
    initial: VARIANT.from,
    animate: VARIANT.in,
    exit: VARIANT.out,
  }
}

function fadeOnly() {
  return presence(HIDDEN, SHOWN, HIDDEN, REDUCED, REDUCED)
}

// Popup cards animate a whole `transform` string, not `scale`: Motion hands
// opacity + transform strings to WAAPI (compositor), while independent
// transforms run on the main thread and drop frames as contents mount.
export function popCard(reduced) {
  if (reduced) return fadeOnly()
  return presence(
    { opacity: 0, transform: 'scale(0.96)' },
    { opacity: 1, transform: 'scale(1)' },
    { opacity: 0, transform: 'scale(0.98)' },
    tween(MOTION.popIn, EASE.move),
    tween(MOTION.popOut, EASE.leave),
  )
}

export function popDim(reduced) {
  if (reduced) return fadeOnly()
  return presence(HIDDEN, SHOWN, HIDDEN, tween(MOTION.popIn, EASE.move), tween(MOTION.popOut, EASE.leave))
}

/** WAAPI timing for a popup dim driven outside React (CenteredModal's shared dim). */
export function popDimTiming(reduced, leaving) {
  if (reduced) return { duration: MOTION.reducedFade, easing: EASE_CSS.fade }
  return leaving
    ? { duration: MOTION.popOut, easing: EASE_CSS.leave }
    : { duration: MOTION.popIn, easing: EASE_CSS.move }
}

// A sheet slides on an OUTER wrapper with a whole `transform` string, like
// popCard: Motion hands it to WAAPI, so the 340 ms slide runs on the
// compositor and keeps its frame rate while the sheet's contents mount.
// (Independent transforms such as `y` run on the main thread.) Drag-to-dismiss
// keeps `y` on the INNER panel, which is why the slide cannot share an element
// with it. The rest value is an identity translate, not `none`: Motion will not
// animate to a non-numeric value, it would jump there.
export function sheetSlide(reduced) {
  if (reduced) return fadeOnly()
  return presence(
    { transform: 'translate3d(0, 100%, 0)' },
    { transform: 'translate3d(0, 0%, 0)' },
    { transform: 'translate3d(0, 100%, 0)' },
    tween(MOTION.sheetIn, EASE.move),
    tween(MOTION.sheetOut, EASE.leave),
  )
}

// The backdrop fades on the fade curve in (a move curve is front-loaded and
// makes the dim look like it snaps on) and on the leave curve out. Spread this
// on the backdrop element only, never on an element that contains the panel.
export function sheetDim(reduced) {
  if (reduced) return fadeOnly()
  return presence(HIDDEN, SHOWN, HIDDEN, tween(MOTION.sheetIn, EASE.fade), tween(MOTION.sheetOut, EASE.leave))
}

// A notice drops in from 8 pt above its resting place (-toastRise), and fades
// out on the leave curve. When a newer notice replaces it, the old one fades
// out over toastSwap on the fade curve while the new one arrives, so the two
// crossfade instead of stacking. Pass `custom="swap"` to AnimatePresence for
// that case (an exiting child only sees the AnimatePresence `custom`).
// Reduce Motion: fades only, no movement.
export const TOAST_SWAP = 'swap'

export function toastMotion(reduced) {
  if (reduced) return fadeOnly()
  const swapOut = tween(MOTION.toastSwap, EASE.fade)
  const out = tween(MOTION.toastOut, EASE.leave)
  return {
    variants: {
      [VARIANT.from]: { opacity: 0, transform: `translateY(${-MOTION.toastRise}px)` },
      [VARIANT.in]: {
        opacity: 1,
        transform: 'translateY(0px)',
        transition: tween(MOTION.toastIn, EASE.move),
      },
      [VARIANT.out]: (custom) => ({
        opacity: 0,
        transform: 'translateY(0px)',
        transition: custom === TOAST_SWAP ? swapOut : out,
      }),
    },
    initial: VARIANT.from,
    animate: VARIANT.in,
    exit: VARIANT.out,
  }
}

/** Content replacing content in a box that is already at its final size. */
export function contentSwap(reduced) {
  if (reduced) return fadeOnly()
  const t = tween(MOTION.arrive, EASE.fade)
  return presence(HIDDEN, SHOWN, HIDDEN, t, t)
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

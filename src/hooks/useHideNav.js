import { useContext, useLayoutEffect, useRef } from 'react'
import { PageTransitionPhase } from '../components/PageTransition'
import { MOTION_MS } from '../motion/xMotion'

/**
 * Body class toggled while a comment composer owns the bottom of the
 * screen (Comments sub-screen, List Detail, Review Detail, and any future
 * comment surface). Unlike `useNavDim` (src/hooks/useNavDim.js), which
 * fades the floating pill nav to ~12% opacity for bottom sheets that share
 * its footprint, this REMOVES the nav's footprint from layout entirely —
 * `--bottom-nav-safe-area` and `.main-content` padding collapse to the
 * safe-area inset — so the composer can anchor flush against it instead of
 * floating above a nav pill that isn't there.
 *
 * Ref-counted (module-level, not per-hook-instance) for the same reason as
 * useNavDim: if two comment surfaces are ever mounted at once (unlikely,
 * but e.g. during a route transition), the class only comes off the body
 * once the last one unmounts/deactivates.
 *
 * Usage: `useHideNav(isCommentScreen)` — pass `true` unconditionally from
 * a screen that always has a composer (ReviewComments, ReviewDetail), or a
 * boolean expression from a screen where the composer only sometimes
 * renders (ListDetail — only for custom lists).
 *
 * THE PILL ITSELF is driven separately, by `body.nav-pill-away`. Layout
 * (`nav-hidden`) has to stay put for as long as the composer screen is
 * mounted, including its exit slide, or the composer would move mid-slide.
 * The pill only needs to stay away while a hiding screen is the CURRENT
 * page, so it leaves while a push slides in and comes back while the screen
 * slides out. backTransition.js releases it earlier still — the moment a
 * back commits — via releaseNavPillForBack.
 */
let hideCount = 0

function pushNavHidden() {
  hideCount += 1
  document.body.classList.add('nav-hidden')
}

function popNavHidden() {
  hideCount = Math.max(0, hideCount - 1)
  if (hideCount === 0) document.body.classList.remove('nav-hidden')
}

const PILL_AWAY = 'nav-pill-away'
const PILL_RETURN = 'nav-pill-return'
const PILL_SNAP = 'nav-pill-snap'

/** Hiding screens that are still the current page (not exiting). */
let awayCount = 0
/** A committed back is returning to a screen that shows the nav. */
let releasedForBack = false
let syncQueued = false
let syncAnimated = true
let returnTimer = 0

function flushPillSync() {
  syncQueued = false
  const animated = syncAnimated
  syncAnimated = true
  const body = document.body
  const away = awayCount > 0 && !releasedForBack
  if (body.classList.contains(PILL_AWAY) === away) return

  clearTimeout(returnTimer)
  body.classList.remove(PILL_RETURN)
  if (!animated) {
    body.classList.add(PILL_SNAP)
    body.classList.toggle(PILL_AWAY, away)
    // Commit the change with transitions off before they come back on.
    void body.offsetWidth
    const unsnap = () => body.classList.remove(PILL_SNAP)
    requestAnimationFrame(unsnap)
    setTimeout(unsnap, 50)
    return
  }
  body.classList.toggle(PILL_AWAY, away)
  if (!away) {
    body.classList.add(PILL_RETURN)
    returnTimer = setTimeout(() => body.classList.remove(PILL_RETURN), MOTION_MS + 60)
  }
}

// Batched to a microtask: a push from one hiding screen to another drops
// the count to 0 and back to 1 inside one commit, which must not flicker.
function schedulePillSync(animated) {
  if (!animated) syncAnimated = false
  if (syncQueued) return
  syncQueued = true
  queueMicrotask(flushPillSync)
}

function pushPillAway(animated) {
  awayCount += 1
  releasedForBack = false
  schedulePillSync(animated)
}

function popPillAway(animated) {
  awayCount = Math.max(0, awayCount - 1)
  if (awayCount === 0) releasedForBack = false
  schedulePillSync(animated)
}

/** backTransition.js: a back has committed to a screen that shows the nav. */
export function releaseNavPillForBack() {
  if (awayCount === 0 || releasedForBack) return
  releasedForBack = true
  schedulePillSync(true)
}

/** backTransition.js: the committed back never navigated. */
export function cancelNavPillRelease() {
  if (!releasedForBack) return
  releasedForBack = false
  schedulePillSync(true)
}

export function useHideNav(active = true) {
  const phaseCtx = useContext(PageTransitionPhase)
  const current = (phaseCtx?.phase ?? 'current') !== 'exiting'
  // false on cold start, tab switches, REPLACE and reduced motion.
  const animatedMountRef = useRef(!!phaseCtx?.deferWork)
  const currentRef = useRef(current)
  currentRef.current = current

  // Layout effect: body.nav-hidden must be set before the first paint, or the
  // screen paints once with the nav's safe-area reserved and then shifts.
  useLayoutEffect(() => {
    if (!active) return undefined
    pushNavHidden()
    return () => popNavHidden()
  }, [active])

  const away = active && current
  useLayoutEffect(() => {
    if (!away) return undefined
    pushPillAway(animatedMountRef.current)
    // Becoming the exiting layer animates the pill back with the slide.
    // Unmounting while still current is an instant swap (tab tap).
    return () => popPillAway(!currentRef.current)
  }, [away])
}

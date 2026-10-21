/**
 * BACK TRANSITION CONTROLLER — one implementation of "going back", shared by
 * the left-edge swipe gesture and every back BUTTON in the app.
 *
 * WHY A SNAPSHOT AND NOT A LIVE STACK
 * Native iOS reveals the previous screen sitting underneath the one being
 * popped. This app can't mount that screen live, for two reasons that are
 * architectural rather than incidental:
 *   1. `.main-content` is the app's single scroll container (see App.css) and
 *      every page renders in-flow inside it. Two simultaneously-visible
 *      layers would each need their own scroll offset, which means each layer
 *      becoming its own scroller — and PullToRefresh, Library's drag
 *      autoscroll, ListDetail's sticky header, useTabBarCompact, keyboard.css
 *      and the comment composers all resolve "the scroller" as
 *      `.main-content` by class or by `document.querySelector`.
 *   2. Revealing the previous screen is only worth doing if its state and
 *      scroll survive, which means keeping it mounted from push time — and
 *      several singletons assume exactly one page instance. GameColorContext
 *      holds ONE "current game" swatch that GameDetail sets on mount and
 *      clears on unmount, so Game A -> Game B -> back would leave A on screen
 *      untinted. Realtime subscriptions and useAppResume's refetch-everything
 *      would also double up.
 *
 * So instead, the outgoing page is cloned at push time while it's still
 * mounted (AnimatedRoutes holds it for the length of its exit). The clone is
 * inert DOM in the same document, so the same stylesheets paint it: no
 * effects, no fetches, no subscriptions, no context collisions. It is stale
 * only for the ~300ms the transition lasts, and is swapped for the live page
 * once that page has mounted and restored its scroll BEHIND the clone — which
 * has the side benefit of hiding the restore write entirely.
 *
 * HOW THE PARALLAX IS BUILT (and why it's built this way)
 * Everything animated per-frame here is compositor-only — transform and
 * opacity, nothing else. The obvious implementation, clipping the reveal to
 * the strip the top page has vacated with `clip-path: inset(...)`, is not
 * composited and repaints a full-screen layer every frame. Instead the reveal
 * is a viewport-sized `overflow: hidden` window that is itself translated so
 * its right edge tracks the top page's left edge, with the snapshot
 * translated the other way inside it:
 *
 *   window  x = (p - 1) * W                    -> right edge lands at p*W
 *   snapshot x = (1 - p) * (1 - PARALLAX) * W  -> absolute x = -(1-p)*PARALLAX*W
 *
 * At p=0 the previous screen sits PARALLAX*W to the left, exactly like
 * UINavigationController; at p=1 both are at rest. The dim is the snapshot's
 * own opacity over the window's opaque page background (the same one body
 * paints on the current theme), so darkening costs one composited property
 * and introduces no new color.
 *
 * ONE ENGINE, DELIBERATELY
 * The window's right edge and the top page's left edge are adjacent, so a
 * single frame of desync shows a seam. Both are therefore driven from here by
 * the same CSS transition string, never by a Motion tween on one side and a
 * CSS transition on the other. Nothing in this module touches AnimatePresence
 * or layout projection, so it cannot reintroduce the exit-complete deadlock
 * documented in AnimatedRoutes.
 *
 * Both entry points drive the same element: the outgoing `.route-layer`
 * (SwipeBackWrapper still passes its inner `.swipe-back` ref to beginBack,
 * which resolves up). One translateX on the wrapper, Framer's inner
 * motion.div held still via CSS, so the visual result is the same for swipe
 * and button back.
 */
import './backTransition.css'
import { cancelNavPillRelease, releaseNavPillForBack } from '../hooks/useHideNav'

// Fraction of the viewport the previous screen sits to the left while covered.
const PARALLAX = 0.3
// Dim over the screen underneath, at rest (covered). Fades to 0 as it returns.
const DIM_OPACITY = 0.12

// Settle duration and easing. Same 340ms curve as a push.
export const BACK_SETTLE_MS = 340
// Button backs defer settleTo by two rAFs so `.route-layer--exiting` commits
// first; budget that wait when sizing AnimatedRoutes' exit safety timer.
const BACK_SLIDE_START_DEFER_MS = 34
const BACK_SETTLE_BUFFER_MS = 20
/** Full button-back travel time from POP to settleTo completion (worst case). */
export const BACK_EXIT_ANIM_MS =
  BACK_SLIDE_START_DEFER_MS + BACK_SETTLE_MS + BACK_SETTLE_BUFFER_MS
const SETTLE_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const SETTLE = `transform ${BACK_SETTLE_MS}ms ${SETTLE_EASE}, opacity ${BACK_SETTLE_MS}ms ${SETTLE_EASE}`

// One entry per back-stack depth. Three is plenty for back-through-three
// screens, and bounds the retained DOM.
const MAX_SNAPSHOTS = 3
// Bounds the scroll-offset walk on pathologically large pages.
const MAX_WALK = 4000
// If navigate(-1) somehow produces no POP (history exhausted), never leave the
// reveal stranded over the app.
const COMMIT_SAFETY_MS = 500
// Upper and lower bounds on holding the snapshot over the live destination.
//
// The cap stops a page that never settles from showing stale content forever.
// The floor exists because the opposite failure is just as visible: a
// destination with nothing to restore reports settled almost immediately, and
// swapping to a page that is still on its skeletons would flick from real
// content to placeholders. The reveal is pointer-events: none throughout,
// but the live page underneath is hidden (see holdLiveLayer) rather than
// interactive during the hold — brief enough that trading that off for
// never showing two copies of the destination is the right call.
const HOLD_CAP_MS = 700

/** `.main-content` — registered by AppContent, see registerBackHost. */
let host = null
/** Back stack of snapshots, deepest first. Top of stack = where back goes. */
const stack = []
/** The mounted reveal, or null. */
let active = null
/** Set when the gesture finished its own slide and navigate(-1) is pending. */
let pendingCommit = null
/** Tracks the two conditions that must both hold before we drop the reveal. */
let holdState = null
/**
 * The live destination's `.route-layer` DOM node while a hold covers it, or
 * null. The snapshot (`.back-reveal`) is an imperatively-appended sibling of
 * the React-rendered route layers, so it competes with them for paint order
 * as peers rather than actually containing them — see the module docstring's
 * "ONE ENGINE, DELIBERATELY" section for the sibling relationship, and
 * backTransition.css for why that competition can go the wrong way. Rather
 * than trying to win a stacking contest that a future page's own positioned
 * child could silently re-lose, the live layer is made to not paint at all
 * for as long as the hold lasts — see holdLiveLayer below.
 */
let heldLiveLayer = null

/**
 * AppContent hands us `.main-content`. The reveal must be a child of it: the
 * exiting route layer is `position: fixed; z-index: 2` INSIDE `.main-content`,
 * which is itself a stacking context (`position: relative; z-index: 1`), so
 * nothing mounted outside it can be painted between the destination layer and
 * the exiting one.
 */
export function registerBackHost(el) {
  // Deliberately does NOT tear down a live reveal when called with null. A
  // callback ref is re-invoked (null, then the node) on every render of its
  // owner, and AppContent re-renders freely mid-transition — GameColorContext
  // alone re-renders it when GameDetail clears its swatches on unmount. Tying
  // teardown to this would kill the reveal partway through.
  if (el) host = el
  else if (!document.contains(host)) host = null
}

/* ------------------------------------------------------------------ */
/* Snapshots                                                          */
/* ------------------------------------------------------------------ */

function copyCanvases(src, dst) {
  // cloneNode copies a canvas element but not its bitmap. WebGL and
  // cross-origin-tainted canvases can't be read; those stay blank.
  try {
    const from = src.querySelectorAll('canvas')
    const to = dst.querySelectorAll('canvas')
    for (let i = 0; i < from.length && i < to.length; i += 1) {
      if (!from[i].width || !from[i].height) continue
      to[i].getContext('2d')?.drawImage(from[i], 0, 0)
    }
  } catch {
    /* leave blank rather than fail the capture */
  }
}

function sanitize(root) {
  // The clone is decoration: inert, unreachable, and invisible to assistive
  // tech (the live page is the real one).
  root.classList.remove('route-layer--exiting')
  root.removeAttribute('style')
  root.classList.add('back-reveal__page')
  root.setAttribute('aria-hidden', 'true')
  // Duplicate ids would break aria-labelledby/aria-controls on the live page
  // (Library's tab panels, for one) for as long as the clone is mounted.
  root.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'))
  // Freeze whatever Motion or the gesture had written inline at capture time
  // so the clone renders the page at rest.
  root.querySelectorAll('.page-transition').forEach((n) => {
    n.style.opacity = '1'
    n.style.transform = 'none'
    n.classList.remove('page-transition--animating')
  })
  root.querySelectorAll('.swipe-back, .back-slide-top').forEach((n) => {
    n.style.transform = 'none'
    n.style.transition = 'none'
    n.classList.remove('back-slide-top')
  })
}

function predecodeImages(root) {
  // A cloned <img> decodes again once inserted, and lazy ones wait for
  // intersection, so covers would pop in partway through the slide. Decode
  // now, while the clone sits on the stack. The live page is untouched.
  root.querySelectorAll('img').forEach((img) => {
    img.loading = 'eager'
    img.decoding = 'sync'
    img.decode?.().catch(() => {})
  })
}

/**
 * Clone the page we're leaving, so a later back can reveal it.
 *
 * `scrollEl.scrollTop` must be read by the caller BEFORE the route change
 * resets it; the clone itself carries no scroll state, and nested scrollers
 * (the horizontal cover shelves on Home and Discover) need their scrollLeft
 * recorded by index and replayed after insertion, since you can't set
 * scrollLeft on a detached node.
 */
export function captureSnapshot({ key, layerEl, scrollTop, padTop }) {
  if (!key || !layerEl) return
  try {
    const originals = layerEl.querySelectorAll('*')
    const offsets = []
    const walk = Math.min(originals.length, MAX_WALK)
    for (let i = 0; i < walk; i += 1) {
      const el = originals[i]
      if (el.scrollLeft || el.scrollTop) offsets.push([i, el.scrollLeft, el.scrollTop])
    }

    const node = layerEl.cloneNode(true)
    sanitize(node)
    predecodeImages(node)
    copyCanvases(layerEl, node)

    // Same history entry pushed twice shouldn't stack twice.
    const existing = stack.findIndex((s) => s.key === key)
    if (existing !== -1) stack.splice(existing, 1)

    stack.push({
      key,
      node,
      offsets,
      scrollTop: scrollTop || 0,
      padTop: padTop || '0px',
      // Captured before the incoming screen mounts, so this is the
      // outgoing screen's own nav state.
      navHidden: document.body.classList.contains('nav-hidden'),
    })
    while (stack.length > MAX_SNAPSHOTS) stack.shift()
  } catch {
    // A snapshot is an enhancement. Never let it break navigation.
  }
}

export function clearSnapshots() {
  stack.length = 0
}

/* ------------------------------------------------------------------ */
/* The reveal                                                         */
/* ------------------------------------------------------------------ */

function apply(p) {
  if (!active) return
  const { width, win, dim, topLayer } = active
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p
  active.progress = clamped

  // p=0: underneath parked at -30%, dim at 0.12, top covering the screen.
  // p=1: underneath home, dim gone, top off to the right.
  win.style.transform = `translate3d(${-PARALLAX * (1 - clamped) * width}px, 0, 0)`
  if (dim) dim.style.opacity = String(DIM_OPACITY * (1 - clamped))
  if (topLayer) {
    // AnimatedRoutes re-renders can reset route-layer className and drop a
    // classList-only `.back-slide-top` mid-gesture — re-apply every frame.
    if (!topLayer.classList.contains('back-slide-top')) {
      topLayer.classList.add('back-slide-top')
    }
    topLayer.style.transform = `translate3d(${clamped * width}px, 0, 0)`
  }
}

function setTransitioned(on) {
  if (!active) return
  const value = on ? SETTLE : 'none'
  active.win.style.transition = value
  if (active.dim) active.dim.style.transition = value
  if (active.topLayer) active.topLayer.style.transition = on ? SETTLE : 'none'
}

/** Always slide the route-layer wrapper — never an inner `.swipe-back`. */
function resolveSlideTarget(el) {
  if (!el) return null
  return el.closest?.('.route-layer') || el
}

/**
 * Animate from the current progress to `targetP` with the shared SETTLE
 * curve. Both the swipe release and the button back must go through here so
 * they stay on one timing path.
 */
function clearSettleCompletion(el) {
  if (!el) return
  if (el.settleEndHandler) {
    el.win.removeEventListener('transitionend', el.settleEndHandler)
    el.settleEndHandler = null
  }
  if (el.settleTimer) {
    clearTimeout(el.settleTimer)
    el.settleTimer = null
  }
}

function settleTo(targetP, onComplete) {
  if (!active) {
    onComplete?.()
    return
  }
  clearSettleCompletion(active)
  setTransitioned(true)
  // Record the start transform before changing it — without a flush, enabling
  // transition and updating transform in one turn jumps instantly (most visible
  // on button backs that travel the full width from p=0).
  void active.win.offsetWidth
  if (active.topLayer) void active.topLayer.offsetWidth
  apply(targetP)
  const el = active
  let finished = false
  const finish = () => {
    if (finished || active !== el) return
    finished = true
    clearSettleCompletion(el)
    onComplete?.()
  }
  const onTransitionEnd = (e) => {
    if (e.target !== el.win || e.propertyName !== 'transform') return
    finish()
  }
  el.settleEndHandler = onTransitionEnd
  el.win.addEventListener('transitionend', onTransitionEnd)
  // transitionend tracks the real curve; the timer is only a safety net.
  el.settleTimer = setTimeout(finish, BACK_SETTLE_MS + BACK_SETTLE_BUFFER_MS + 80)
}

/**
 * Mount the reveal and take ownership of `topLayer`'s transform.
 *
 * Returns the width the caller should divide finger travel by, or 0 if no
 * reveal could be mounted at all (in which case the caller should navigate
 * without animating). With no snapshot available — a cold start or deep link
 * straight into a pushed screen — the window still mounts, just without a
 * page inside it: a deliberate backdrop rather than the bare navy that
 * happened to show through before.
 */
export function beginBack({ topLayer } = {}) {
  if (!host) return 0
  if (active) return active.width

  const width = host.clientWidth || window.innerWidth || 0
  if (!width) return 0

  const slideTarget = resolveSlideTarget(topLayer)
  const snap = stack.length ? stack[stack.length - 1] : null

  const win = document.createElement('div')
  win.className = 'back-reveal'
  win.setAttribute('aria-hidden', 'true')

  if (snap) {
    // The clone was a child of `.main-content`, so its top edge sat at
    // (padding-top - scrollTop). Reproducing that offset is what makes the
    // revealed screen appear at the scroll position the user left it at.
    snap.node.style.top = `${(parseFloat(snap.padTop) || 0) - snap.scrollTop}px`
    win.appendChild(snap.node)
  }

  const dim = document.createElement('div')
  dim.className = 'back-reveal__dim'
  win.appendChild(dim)

  host.appendChild(win)

  if (snap?.offsets?.length) {
    const nodes = snap.node.querySelectorAll('*')
    snap.offsets.forEach(([i, left, top]) => {
      const el = nodes[i]
      if (!el) return
      if (left) el.scrollLeft = left
      if (top) el.scrollTop = top
    })
  }

  active = {
    win,
    dim,
    topLayer: slideTarget,
    width,
    progress: 0,
    snapKey: snap?.key || null,
    revealsNav: !!snap && !snap.navHidden,
    settleTimer: null,
    settleEndHandler: null,
  }
  if (slideTarget) slideTarget.classList.add('back-slide-top')
  setTransitioned(false)
  apply(0)
  // The window was just inserted, so it has no previously-computed transform
  // to transition from. Force a style flush before any animated change.
  void win.offsetWidth

  return width
}

/** 1:1 finger tracking — no transition, no rAF, no lag. */
export function setBackProgress(p) {
  if (!active) return
  // A finger landing again while a spring-back is still playing takes the
  // gesture over; the settle that was in flight must not go on to tear the
  // reveal down underneath it.
  clearSettleCompletion(active)
  setTransitioned(false)
  apply(p)
}

function clearHold() {
  if (!holdState) return
  if (holdState.timer) clearTimeout(holdState.timer)
  holdState = null
}

/**
 * Stop hiding whichever live layer is currently held, if any. Called from
 * every path that can end a hold — the normal settle-and-release in
 * maybeRelease, the HOLD_CAP_MS failsafe in startHold, and teardownBack —
 * so a hidden layer can never outlive the reveal that justified hiding it.
 */
function clearHeldLiveLayer() {
  if (!heldLiveLayer) return
  heldLiveLayer.classList.remove('route-layer--held')
  heldLiveLayer = null
}

/**
 * Hide the live destination's route layer for as long as a hold covers it.
 * AnimatedRoutes calls this once, from the ref callback, the moment the
 * incoming layer's DOM node mounts for a navigation whose claimBack call
 * returned 'gesture' or 'slide' (i.e. started a hold) — see App.jsx.
 *
 * `visibility: hidden`, not `display: none`: the layer still lays out and
 * still runs its effects (PageTransition's onEnterComplete fires immediately
 * under enterMode 'instant', which is what lets attemptRestore poll
 * scrollHeight and write scrollTop while nothing is visibly there to show
 * the write happening). It only stops painting.
 *
 * Idempotent and safe to call again with a different element — a second
 * back navigation arriving before the first's hold has released replaces
 * the held layer with the new one rather than leaving the old one hidden
 * forever after it unmounts.
 */
export function holdLiveLayer(el) {
  if (!el || el === heldLiveLayer) return
  clearHeldLiveLayer()
  heldLiveLayer = el
  el.classList.add('route-layer--held')
}

function destroy({ resetTopLayer = false } = {}) {
  if (!active) return
  clearSettleCompletion(active)
  const { win, topLayer } = active
  if (topLayer) {
    topLayer.classList.remove('back-slide-top')
    topLayer.style.transition = ''
    // Never clear transform when the layer is still mounted off-screen (p≈1).
    // Resetting translateX snaps the outgoing page back into view for a frame
    // before AnimatedRoutes unmounts it — the "jump" at exit.
    if (resetTopLayer) topLayer.style.transform = ''
  }
  win.remove()
  active = null
  clearHold()
  // The live page is about to be the only thing left — whatever was covering
  // it (settled release, HOLD_CAP_MS failsafe, or a stranded-reveal teardown)
  // is gone, so it must be visible again no matter which path got us here.
  clearHeldLiveLayer()
}

/** Drop everything immediately. Used whenever a navigation arrives that this
 *  reveal doesn't belong to, so a stale layer can never strand over the app. */
export function teardownBack() {
  if (pendingCommit?.timer) clearTimeout(pendingCommit.timer)
  pendingCommit = null
  destroy({ resetTopLayer: true })
}

/**
 * Release the top page's transform but leave the reveal mounted and fully
 * closed (p=1). Used the moment the gesture's slide finishes: the page is
 * off-screen and about to unmount, but the snapshot must keep covering the
 * live page until that page has settled.
 */
function detachTopLayer() {
  if (!active?.topLayer) return
  // Stop driving this element but leave `.back-slide-top` on until the route
  // layer unmounts. Removing the class here drops the compositor flatten in
  // backTransition.css while the layer is still mounted for a frame or two
  // before POP — Framer's motion.div re-applies its own transform and reads
  // as a second back transition on top of the settle.
  active.topLayer.style.transition = ''
  active.topLayer = null
}

function maybeRelease() {
  if (!holdState) return
  if (!holdState.slideDone || !holdState.settled) return
  if (holdState.timer) clearTimeout(holdState.timer)
  holdState = null
  // One motion only: the settle is the exit. Drop the cover after the scroll
  // restore has had a frame to paint underneath — same-turn destroy can flash
  // one frame at the wrong offset.
  const drop = () => {
    if (active) destroy()
  }
  requestAnimationFrame(() => requestAnimationFrame(drop))
  // A second frame sometimes never arrives in a backgrounded webview, which
  // used to leave the reveal up until HOLD_CAP_MS.
  setTimeout(drop, 48)
}

/**
 * Start holding the reveal over the live destination page. It comes down once
 * the slide has finished AND the page has restored its scroll (App.jsx's
 * attemptRestore calls notifyBackSettled), whichever is later — so the restore
 * write happens behind an opaque cover and the lurch it used to cause is never
 * visible. Capped so a page that never settles can't hold stale content.
 */
function startHold() {
  clearHold()
  holdState = {
    slideDone: false,
    settled: false,
    timer: setTimeout(() => {
      holdState = null
      destroy()
    }, HOLD_CAP_MS),
  }
}

/** Called by App.jsx when a POP's scroll restoration has resolved. */
export function notifyBackSettled() {
  if (!holdState) return
  holdState.settled = true
  maybeRelease()
}

/**
 * Release the gesture. `commit` slides the rest of the way and then calls
 * `onDone` (the caller's navigate(-1)); otherwise both layers spring back
 * together and the reveal is dropped.
 */
export function finishBack({ commit, onDone }) {
  if (!active) {
    if (commit) onDone?.()
    return
  }

  clearSettleCompletion(active)

  if (!commit) {
    settleTo(0, () => {
      if (active) destroy({ resetTopLayer: true })
    })
    return
  }

  const key = active.snapKey
  if (active.revealsNav) releaseNavPillForBack()
  settleTo(1, () => {
    if (!active) {
      onDone?.()
      return
    }
    // The page is off-screen; hand the reveal over to the POP that onDone is
    // about to trigger. claimBack picks it up as 'gesture'.
    detachTopLayer()
    pendingCommit = {
      key,
      fromGesture: true,
      timer: setTimeout(() => {
        // navigate(-1) produced no POP — don't strand the reveal.
        pendingCommit = null
        cancelNavPillRelease()
        destroy()
      }, COMMIT_SAFETY_MS),
    }
    onDone?.()
  })
}

/* ------------------------------------------------------------------ */
/* The POP side — shared by the gesture and every back button         */
/* ------------------------------------------------------------------ */

/**
 * AnimatedRoutes calls this on every POP to ask who owns the animation.
 *
 *   'gesture' — the swipe already performed the slide; the reveal is mounted
 *               and closed. Swap layers instantly and let the hold run.
 *   'slide'   — a button back: mount the reveal and run the identical slide
 *               over `topLayer` (the layer that's about to become
 *               `.route-layer--exiting`).
 *   'live'    — no snapshot for this destination. AnimatedRoutes slides the
 *               live layers (incoming from -30%, outgoing off to the right).
 *
 * A snapshot is only used when its key matches the destination. Anything else
 * falls through to a live-layer slide so the wrong screen is never revealed.
 */
export function claimBack(destKey, topLayer) {
  if (pendingCommit) {
    const { key, fromGesture, timer } = pendingCommit
    clearTimeout(timer)
    pendingCommit = null
    const handoff =
      active && (key === destKey || (fromGesture && key == null))
    if (handoff) {
      if (key != null) {
        const i = stack.findIndex((s) => s.key === destKey)
        if (i !== -1) stack.splice(i, 1)
      }
      startHold()
      // The gesture already travelled the full distance, so the only thing
      // left to wait on is the destination page settling.
      holdState.slideDone = true
      return 'gesture'
    }
    teardownBack()
    return 'live'
  }

  teardownBack()

  const top = stack.length ? stack[stack.length - 1] : null
  if (!top || top.key !== destKey || !topLayer) return 'live'

  const width = beginBack({ topLayer })
  if (!width) return 'live'

  if (active.revealsNav) releaseNavPillForBack()
  stack.pop()
  startHold()

  // claimBack runs inside AnimatedRoutes' layout effect, before the outgoing
  // layer commits as `.route-layer--exiting` (position: fixed + scroll offset).
  // Wait until that frame has been painted, then run the same settleTo the
  // swipe release uses. The timeout covers a webview that doesn't schedule
  // the second animation frame — without it the reveal sits at -30% until
  // the safety timer cuts the page away.
  let started = false
  const start = () => {
    if (started || !active || !holdState) return
    started = true
    settleTo(1, () => {
      if (!holdState) return
      holdState.slideDone = true
      maybeRelease()
    })
  }
  requestAnimationFrame(() => requestAnimationFrame(start))
  setTimeout(start, 48)
  return 'slide'
}

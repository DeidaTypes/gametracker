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
 * own opacity over the window's opaque midnight-navy gradient, so darkening
 * costs one composited property and introduces no new color.
 *
 * ONE ENGINE, DELIBERATELY
 * The window's right edge and the top page's left edge are adjacent, so a
 * single frame of desync shows a seam. Both are therefore driven from here by
 * the same CSS transition string, never by a Motion tween on one side and a
 * CSS transition on the other. Nothing in this module touches AnimatePresence
 * or layout projection, so it cannot reintroduce the exit-complete deadlock
 * documented in AnimatedRoutes.
 *
 * The top page element differs between the two entry points — the gesture
 * drives `.swipe-back` before navigating, the button drives
 * `.route-layer--exiting` after — but both represent the full-screen page at
 * its correct scroll offset, and both run through `apply()` below, so the
 * visual result is the same.
 */
import './backTransition.css'

// Fraction of the viewport the previous screen sits to the left by at rest,
// matching UINavigationController's reveal.
const PARALLAX = 0.28
// The previous screen's opacity at p=0, over the window's own navy gradient.
// This is the "slightly darkened" part of the native look.
const DIM_FLOOR = 0.55

// Same curve and duration SwipeBackWrapper has always used to settle. 300ms
// is the ceiling — past that a back gesture reads as broken, not polished.
export const BACK_SETTLE_MS = 300
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
// content to placeholders. The reveal is pointer-events: none throughout, so
// the live page underneath is already interactive either way.
const HOLD_CAP_MS = 700
const HOLD_FLOOR_MS = 180
const FADE_OUT_MS = 140

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
    copyCanvases(layerEl, node)

    // Same history entry pushed twice shouldn't stack twice.
    const existing = stack.findIndex((s) => s.key === key)
    if (existing !== -1) stack.splice(existing, 1)

    stack.push({ key, node, offsets, scrollTop: scrollTop || 0, padTop: padTop || '0px' })
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
  const { width, win, content, topLayer } = active
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p
  active.progress = clamped

  win.style.transform = `translate3d(${(clamped - 1) * width}px, 0, 0)`
  content.style.transform = `translate3d(${(1 - clamped) * (1 - PARALLAX) * width}px, 0, 0)`
  content.style.opacity = String(DIM_FLOOR + (1 - DIM_FLOOR) * clamped)
  if (topLayer) topLayer.style.transform = `translate3d(${clamped * width}px, 0, 0)`
}

function setTransitioned(on) {
  if (!active) return
  const value = on ? SETTLE : 'none'
  active.win.style.transition = value
  active.content.style.transition = value
  if (active.topLayer) active.topLayer.style.transition = on ? SETTLE : 'none'
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

  const snap = stack.length ? stack[stack.length - 1] : null

  const win = document.createElement('div')
  win.className = 'back-reveal'
  win.setAttribute('aria-hidden', 'true')

  const content = document.createElement('div')
  content.className = 'back-reveal__content'
  win.appendChild(content)

  if (snap) {
    // The clone was a child of `.main-content`, so its top edge sat at
    // (padding-top - scrollTop). Reproducing that offset is what makes the
    // revealed screen appear at the scroll position the user left it at.
    snap.node.style.top = `${(parseFloat(snap.padTop) || 0) - snap.scrollTop}px`
    content.appendChild(snap.node)
  }

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
    content,
    topLayer: topLayer || null,
    width,
    progress: 0,
    snapKey: snap?.key || null,
    settleTimer: null,
  }
  if (topLayer) topLayer.classList.add('back-slide-top')
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
  if (active.settleTimer) {
    clearTimeout(active.settleTimer)
    active.settleTimer = null
  }
  setTransitioned(false)
  apply(p)
}

function clearHold() {
  if (!holdState) return
  if (holdState.timer) clearTimeout(holdState.timer)
  if (holdState.floorTimer) clearTimeout(holdState.floorTimer)
  holdState = null
}

function destroy() {
  if (!active) return
  const { win, topLayer, settleTimer } = active
  if (settleTimer) clearTimeout(settleTimer)
  if (topLayer) {
    topLayer.classList.remove('back-slide-top')
    topLayer.style.transition = ''
    topLayer.style.transform = ''
  }
  win.remove()
  active = null
  clearHold()
}

/** Drop everything immediately. Used whenever a navigation arrives that this
 *  reveal doesn't belong to, so a stale layer can never strand over the app. */
export function teardownBack() {
  if (pendingCommit?.timer) clearTimeout(pendingCommit.timer)
  pendingCommit = null
  destroy()
}

/**
 * Release the top page's transform but leave the reveal mounted and fully
 * closed (p=1). Used the moment the gesture's slide finishes: the page is
 * off-screen and about to unmount, but the snapshot must keep covering the
 * live page until that page has settled.
 */
function detachTopLayer() {
  if (!active?.topLayer) return
  active.topLayer.classList.remove('back-slide-top')
  active.topLayer.style.transition = ''
  active.topLayer = null
}

function fadeOutAndDestroy() {
  if (!active) return
  const { win } = active
  detachTopLayer()
  win.style.transition = `opacity ${FADE_OUT_MS}ms linear`
  win.style.opacity = '0'
  const el = active
  setTimeout(() => {
    // Only tear down if this is still the same reveal.
    if (active === el) destroy()
  }, FADE_OUT_MS + 20)
}

function maybeRelease() {
  if (!holdState) return
  if (!holdState.slideDone || !holdState.settled) return
  const waited = Date.now() - holdState.startedAt
  if (waited < HOLD_FLOOR_MS) {
    if (holdState.floorTimer) return
    holdState.floorTimer = setTimeout(maybeRelease, HOLD_FLOOR_MS - waited)
    return
  }
  if (holdState.timer) clearTimeout(holdState.timer)
  if (holdState.floorTimer) clearTimeout(holdState.floorTimer)
  holdState = null
  fadeOutAndDestroy()
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
    startedAt: Date.now(),
    floorTimer: null,
    timer: setTimeout(() => {
      holdState = null
      fadeOutAndDestroy()
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

  if (active.settleTimer) clearTimeout(active.settleTimer)

  if (!commit) {
    setTransitioned(true)
    apply(0)
    const el = active
    active.settleTimer = setTimeout(() => {
      if (active === el) destroy()
    }, BACK_SETTLE_MS + 20)
    return
  }

  setTransitioned(true)
  apply(1)

  const key = active.snapKey
  active.settleTimer = setTimeout(() => {
    if (!active) {
      onDone?.()
      return
    }
    active.settleTimer = null
    // The page is off-screen; hand the reveal over to the POP that onDone is
    // about to trigger. claimBack picks it up as 'gesture'.
    detachTopLayer()
    pendingCommit = {
      key,
      timer: setTimeout(() => {
        // navigate(-1) produced no POP — don't strand the reveal.
        pendingCommit = null
        fadeOutAndDestroy()
      }, COMMIT_SAFETY_MS),
    }
    onDone?.()
  }, BACK_SETTLE_MS + 20)
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
 *   'fade'    — no snapshot for this destination. Existing back fade.
 *
 * A snapshot is only used when its key matches the destination, so a
 * multi-entry back or a history shape we didn't predict degrades to the fade
 * instead of revealing the wrong screen.
 */
export function claimBack(destKey, topLayer) {
  if (pendingCommit) {
    const matches = pendingCommit.key === destKey
    clearTimeout(pendingCommit.timer)
    pendingCommit = null
    if (matches && active) {
      const i = stack.findIndex((s) => s.key === destKey)
      if (i !== -1) stack.splice(i, 1)
      startHold()
      // The gesture already travelled the full distance, so the only thing
      // left to wait on is the destination page settling.
      holdState.slideDone = true
      return 'gesture'
    }
    teardownBack()
    return 'fade'
  }

  teardownBack()

  const top = stack.length ? stack[stack.length - 1] : null
  if (!top || top.key !== destKey || !topLayer) return 'fade'

  const width = beginBack({ topLayer })
  if (!width) return 'fade'

  stack.pop()
  startHold()

  // Same curve, same duration, same progress function the finger drives.
  setTransitioned(true)
  apply(1)
  setTimeout(() => {
    if (!holdState) return
    holdState.slideDone = true
    maybeRelease()
  }, BACK_SETTLE_MS + 20)
  return 'slide'
}

import { createContext, useContext, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import SwipeBackWrapper from './SwipeBackWrapper'

/**
 * Supplied by <AnimatedRoutes> (App.jsx) to every route layer it renders.
 * `phase` is 'current' for the page that's live/entering, or 'exiting'
 * for a page that's mid-exit but still mounted so its animation can play.
 * `direction` is 'forward' for a PUSH (or REPLACE) and 'back' for a POP,
 * and is shared by the exiting AND entering layer of the same navigation
 * so the two animate as a matched pair (see VARIANTS below).
 *
 * `onExitComplete` is only meaningful when phase === 'exiting' — calling
 * it tells AnimatedRoutes it's safe to unmount this layer.
 *
 * `exitMode` is 'fade' (this component's own tween) or 'slide' — a back
 * navigation whose horizontal travel is driven by backTransition.js on the
 * route-layer wrapper instead, so this component must hold still and let the
 * layer's own timer own the unmount. `enterMode` is 'animate' or 'instant';
 * 'instant' means the entering page is covered by the back reveal for the
 * whole transition, so it has nothing to fade in from.
 *
 * A component rendered with no provider (ctx === null) gets the historical
 * defaults (phase 'current', direction 'forward'), so PageTransition is
 * still safe to use anywhere outside the route-layer machinery.
 */
export const PageTransitionPhase = createContext(null)

/**
 * Whether THIS layer's entrance tween has finished painting.
 *
 * Defaults to `true` so anything reading it outside of a PageTransition
 * (no provider in the tree) treats "no pending transition" as "go ahead
 * now" rather than deadlocking — same defaulting philosophy as
 * PageTransitionPhase above.
 *
 * Consumers: any page that does non-critical work on mount (color
 * extraction, secondary data fetches, anything that isn't needed for the
 * very first paint) should gate that work on `useTransitionComplete()`
 * instead of firing it unconditionally in a mount effect. See GameDetail
 * for the reference usage — it's deliberately generic so any other screen
 * can adopt the same pattern later (out of scope for this pass, but
 * nothing here is GameDetail-specific).
 */
const TransitionCompleteContext = createContext(true)

export function useTransitionComplete() {
  return useContext(TransitionCompleteContext)
}

// Forward (push) and back (pop) are mirror images of each other: forward
// enters rising from below and exits continuing to rise away; back enters
// dropping in from above and exits falling back down — reusing the same
// 8px / opacity vocabulary as the original spec so the two directions read
// as "the same motion, run in reverse" rather than two unrelated effects.
const VARIANTS = {
  forward: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
  },
  back: {
    initial: { opacity: 0, y: -8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 8 },
  },
}

const PAGE_TRANSITION_ENTER = { duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }
// Slightly slower than enter — screen leaves should feel set down, not yanked.
// Easing matches backTransition.js SETTLE so fade-fallback backs read the same.
const PAGE_TRANSITION_EXIT = { duration: 0.3, ease: [0.32, 0.72, 0, 1] }
const PAGE_TRANSITION_INSTANT = { duration: 0 }
// Exported so anything that needs to run ITS OWN animation in lockstep with
// the page ENTER tween (e.g. GameDetail's color backdrop) can match durations
// instead of hardcoding a second copy of "0.22" that can silently drift
// from this one.
export const PAGE_TRANSITION_DURATION_MS = PAGE_TRANSITION_ENTER.duration * 1000
export const PAGE_TRANSITION_EXIT_DURATION_MS = PAGE_TRANSITION_EXIT.duration * 1000

// Safety net for useTransitionComplete, mirroring AnimatedRoutes' own
// EXIT_SAFETY_MS pattern (App.jsx) — if onAnimationComplete never fires for
// some unrelated reason, deferred work still unblocks instead of waiting
// forever on a signal that didn't arrive.
const TRANSITION_COMPLETE_SAFETY_MS = 320

/**
 * Wraps a top-level page in the canonical fade + 8 px vertical slide
 * described in the motion-system spec — now direction-aware and with a
 * real, playing exit.
 *
 * How this replaces the old enter-only pattern:
 * AnimatedRoutes (App.jsx) keeps the outgoing page mounted for the
 * duration of its exit instead of tearing it down the instant the route
 * changes (that instant teardown, driven by keying <Routes> on the
 * pathname with no AnimatePresence, is what made the old `exit` prop
 * dead code). It tells this component which phase it's in via
 * PageTransitionPhase context: the entering layer animates
 * initial → animate as before; the exiting layer's `animate` target is
 * switched to the exit variant, which — because the element is already
 * mounted, not being removed by AnimatePresence — is a plain, ordinary
 * animate-prop change. Its `onAnimationComplete` reliably fires (it's a
 * bare opacity/y tween, not a layout-projection or exit-tree completion),
 * and AnimatedRoutes uses that to unmount the layer once the animation is
 * actually done.
 *
 * Why not AnimatePresence? It was tried (see App.jsx's AnimatedRoutes
 * docstring for the full history) and deadlocked: with layoutId-heavy
 * descendants (SharedCover, BottomNav's pill, Profile tabs) somewhere in
 * the shared Motion layout tree, `onExitComplete` sometimes never fired,
 * permanently parking `mode="wait"` and blocking every future navigation.
 * This component's exit no longer depends on that machinery at all, so it
 * can't wedge the same way — see AnimatedRoutes for how layer isolation
 * (LayoutGroup per layer) plus a safety-net timeout close the remaining
 * gaps.
 *
 * Reduced motion collapses the durations to 0 ms; the global
 * @media (prefers-reduced-motion) fallback in _motion.css covers
 * any transition that bypasses this hook. AnimatedRoutes also never
 * creates an exiting layer at all when motion is reduced, so there is
 * nothing for this component to animate out in that mode.
 */
export default function PageTransition({ children, swipeBack = false }) {
  const { reduced } = useMotionPreference()
  const phaseCtx = useContext(PageTransitionPhase)
  const phase = phaseCtx?.phase ?? 'current'
  const direction = phaseCtx?.direction ?? 'forward'
  const onExitComplete = phaseCtx?.onExitComplete
  // Fired once the ENTERING layer's tween finishes — App.jsx's scroll-
  // restore effect waits on this before ever writing .main-content's
  // scrollTop, so a POP's restore write always lands after the fade is
  // visually settled instead of racing it. See App.jsx's `attemptRestore`
  // for the consumer side of this.
  const onEnterComplete = phaseCtx?.onEnterComplete
  const isExiting = phase === 'exiting'

  // A back navigation that reveals the previous screen: the outgoing layer's
  // travel belongs to backTransition.js (one element, one animation engine —
  // two would desync by a frame at the seam between the two layers), and the
  // incoming one is hidden behind the reveal, so neither animates here.
  const slidingOut = isExiting && phaseCtx?.exitMode === 'slide'
  const instantEnter = !isExiting && (reduced || phaseCtx?.enterMode === 'instant')
  const isStatic = slidingOut || instantEnter

  const variants = VARIANTS[direction] || VARIANTS.forward
  const transition =
    reduced || isStatic
      ? PAGE_TRANSITION_INSTANT
      : isExiting && !slidingOut
        ? PAGE_TRANSITION_EXIT
        : PAGE_TRANSITION_ENTER

  // The compositor hint is carried by a class rather than the stylesheet so
  // it can be dropped the moment the slide ends. Left on permanently, the
  // wrapper stays a containing block for position:fixed children and the
  // keyboard-aware composer bars anchor to the page's content box instead
  // of the viewport. Starts true because the enter animation runs on mount.
  const [animating, setAnimating] = useState(true)

  // Backs useTransitionComplete(). An exiting layer already played its own
  // entrance in a previous render of this same route, so it starts (and
  // stays) "complete" — there's nothing for it to gate. The entering layer
  // starts false (unless motion is reduced, in which case there is no
  // tween to wait for) and flips true the moment its tween's
  // onAnimationComplete fires, below.
  const [entered, setEntered] = useState(() => reduced || isExiting)

  // Safety net: if onAnimationComplete never fires for some reason, don't
  // strand a page's deferred work forever. Mount-only for the same reason
  // as the reduced-motion effect below — isExiting/reduced never change
  // during one layer's lifetime.
  useEffect(() => {
    if (entered) return undefined
    const timer = setTimeout(() => setEntered(true), TRANSITION_COMPLETE_SAFETY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Belt-and-suspenders for the modes that have no animation to wait on.
  // Exiting layers are never created while motion is reduced (AnimatedRoutes
  // swaps layers instantly instead), so the isExiting branch here should be
  // unreachable — kept so that invariant breaking doesn't strand a layer
  // forever waiting on an animation that won't run. The entering branch IS
  // reachable on every reduced-motion navigation and on every sliding back:
  // with transition duration 0 `onAnimationComplete` should still fire, but
  // this is the same "don't strand the caller" guarantee applied to
  // onEnterComplete, so the destination's scroll restore starts on time
  // either way — and on a sliding back that restore lands while the reveal is
  // still covering the page, which is what makes the old lurch invisible.
  //
  // Note this deliberately does NOT flip `entered`. useTransitionComplete's
  // consumers do non-critical work (color extraction, secondary fetches), and
  // running it the instant a covered page mounts would put it on the main
  // thread for the whole slide. The safety timer above releases it instead, a
  // few ms after the slide is done.
  //
  // Deliberately mount-only (empty deps, values read from the closure at
  // mount time): `onEnterComplete`/`onExitComplete` are new closures every
  // time AnimatedRoutes re-renders (unrelated to this navigation), and
  // `isExiting` never flips during one layer's lifetime (an exiting layer
  // is created already-exiting). Depending on them would re-fire this on
  // every unrelated parent re-render instead of once per mount.
  useEffect(() => {
    if (isExiting) {
      // A sliding exit is unmounted by AnimatedRoutes' own timer once the
      // controller has finished the travel — reporting completion here would
      // tear the page out from under the animation.
      if (reduced && !slidingOut) onExitComplete?.()
      return
    }
    if (instantEnter) onEnterComplete?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Secondary / pushed screens opt into the native left-edge swipe-back
  // gesture. The motion.div owns the page's enter/exit fade+slide (Y);
  // SwipeBackWrapper owns the horizontal drag transform, so the two
  // transforms never fight over the same element.
  return (
    <motion.div
      className={`page-transition${animating && !isStatic ? ' page-transition--animating' : ''}`}
      initial={isStatic ? variants.animate : variants.initial}
      animate={isExiting && !slidingOut ? variants.exit : variants.animate}
      transition={transition}
      onAnimationStart={() => setAnimating(true)}
      onAnimationComplete={() => {
        setAnimating(false)
        if (isExiting) {
          if (!slidingOut) onExitComplete?.()
          return
        }
        if (!instantEnter) setEntered(true)
        onEnterComplete?.()
      }}
    >
      <TransitionCompleteContext.Provider value={entered}>
        {swipeBack ? <SwipeBackWrapper>{children}</SwipeBackWrapper> : children}
      </TransitionCompleteContext.Provider>
    </motion.div>
  )
}

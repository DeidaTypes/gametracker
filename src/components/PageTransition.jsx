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
 * A component rendered with no provider (ctx === null) gets the historical
 * defaults (phase 'current', direction 'forward'), so PageTransition is
 * still safe to use anywhere outside the route-layer machinery.
 */
export const PageTransitionPhase = createContext(null)

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

const PAGE_TRANSITION = { duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }
const PAGE_TRANSITION_INSTANT = { duration: 0 }

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
  const isExiting = phase === 'exiting'

  const variants = VARIANTS[direction] || VARIANTS.forward
  const transition = reduced ? PAGE_TRANSITION_INSTANT : PAGE_TRANSITION

  // The compositor hint is carried by a class rather than the stylesheet so
  // it can be dropped the moment the slide ends. Left on permanently, the
  // wrapper stays a containing block for position:fixed children and the
  // keyboard-aware composer bars anchor to the page's content box instead
  // of the viewport. Starts true because the enter animation runs on mount.
  const [animating, setAnimating] = useState(true)

  // Belt-and-suspenders: AnimatedRoutes never puts a layer into 'exiting'
  // while motion is reduced (it swaps layers instantly instead), so this
  // should be unreachable. If that invariant is ever broken, don't strand
  // the layer forever waiting on an animation that won't run.
  useEffect(() => {
    if (isExiting && reduced) onExitComplete?.()
  }, [isExiting, reduced, onExitComplete])

  // Secondary / pushed screens opt into the native left-edge swipe-back
  // gesture. The motion.div owns the page's enter/exit fade+slide (Y);
  // SwipeBackWrapper owns the horizontal drag transform, so the two
  // transforms never fight over the same element.
  return (
    <motion.div
      className={`page-transition${animating ? ' page-transition--animating' : ''}`}
      initial={variants.initial}
      animate={isExiting ? variants.exit : variants.animate}
      transition={transition}
      onAnimationStart={() => setAnimating(true)}
      onAnimationComplete={() => {
        setAnimating(false)
        if (isExiting) onExitComplete?.()
      }}
    >
      {swipeBack ? <SwipeBackWrapper>{children}</SwipeBackWrapper> : children}
    </motion.div>
  )
}

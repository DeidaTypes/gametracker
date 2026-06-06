import { motion } from 'motion/react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import SwipeBackWrapper from './SwipeBackWrapper'

const PAGE_INITIAL = { opacity: 0, y: 8 }
const PAGE_ANIMATE = { opacity: 1, y: 0 }
const PAGE_EXIT = { opacity: 0, y: -8 }
const PAGE_TRANSITION = { duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }
const PAGE_TRANSITION_INSTANT = { duration: 0 }

/**
 * Wraps a top-level page in the canonical fade + 8 px vertical slide
 * described in the motion-system spec.
 *
 * Each navigation re-mounts the page (AnimatedRoutes keys <Routes>
 * by location.pathname), so the motion.div's initial → animate
 * transition fires every time the user lands on a new page. The
 * `exit` prop is declared too — if a parent AnimatePresence is ever
 * (re-)introduced, the spec's exit animation will activate without
 * touching the page components.
 *
 * Reduced motion collapses the durations to 0 ms; the global
 * @media (prefers-reduced-motion) fallback in _motion.css covers
 * any transition that bypasses this hook.
 */
export default function PageTransition({ children, swipeBack = false }) {
  const { reduced } = useMotionPreference()
  const transition = reduced ? PAGE_TRANSITION_INSTANT : PAGE_TRANSITION

  // Secondary / pushed screens opt into the native left-edge swipe-back
  // gesture. The motion.div owns the page's enter/exit fade+slide (Y);
  // SwipeBackWrapper owns the horizontal drag transform, so the two
  // transforms never fight over the same element.
  return (
    <motion.div
      className="page-transition"
      initial={PAGE_INITIAL}
      animate={PAGE_ANIMATE}
      exit={PAGE_EXIT}
      transition={transition}
    >
      {swipeBack ? <SwipeBackWrapper>{children}</SwipeBackWrapper> : children}
    </motion.div>
  )
}

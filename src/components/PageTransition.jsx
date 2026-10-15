import { createContext, useContext, useEffect, useState } from 'react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import SwipeBackWrapper from './SwipeBackWrapper'
import { MOTION_MS } from '../motion/xMotion'

/**
 * Supplied by <AnimatedRoutes>. `phase` is 'current' or 'exiting'.
 * `deferWork` holds non-critical mount work until the slide has finished.
 * `onEnterComplete` fires as soon as the entering layer mounts so scroll
 * restoration can run while the page is still covered.
 *
 * The horizontal travel itself is not done here. Pushes and live pops are
 * CSS transforms on `.route-layer`. Button backs and the edge swipe are
 * driven by backTransition.js. This wrapper stays layout-neutral so a
 * finished page does not trap position:fixed composers.
 */
export const PageTransitionPhase = createContext(null)

const TransitionCompleteContext = createContext(true)

export function useTransitionComplete() {
  return useContext(TransitionCompleteContext)
}

export const PAGE_TRANSITION_DURATION_MS = MOTION_MS
export const PAGE_TRANSITION_EXIT_DURATION_MS = MOTION_MS

const WORK_RELEASE_MS = MOTION_MS + 80

export default function PageTransition({ children, swipeBack = false }) {
  const { reduced } = useMotionPreference()
  const phaseCtx = useContext(PageTransitionPhase)
  const isExiting = (phaseCtx?.phase ?? 'current') === 'exiting'
  const defer = !reduced && !isExiting && !!phaseCtx?.deferWork
  const [entered, setEntered] = useState(() => !defer)
  const onEnterComplete = phaseCtx?.onEnterComplete

  useEffect(() => {
    if (!defer) return undefined
    const timer = setTimeout(() => setEntered(true), WORK_RELEASE_MS)
    return () => clearTimeout(timer)
  }, [defer])

  useEffect(() => {
    if (isExiting) return undefined
    onEnterComplete?.()
    return undefined
    // Mount only. The callback identity changes on unrelated parent renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="page-transition">
      <TransitionCompleteContext.Provider value={entered}>
        {swipeBack ? <SwipeBackWrapper>{children}</SwipeBackWrapper> : children}
      </TransitionCompleteContext.Provider>
    </div>
  )
}

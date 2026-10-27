import React, { useLayoutEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import { EASE, MOTION, VARIANT, contentSwap } from '../../motion/xMotion'

/**
 * In-page tab content (Profile, Library, Q&A, Search, Follows, Popular/New).
 *
 * The old pane fades out in MOTION.segOut; the new one fades in over
 * MOTION.segIn and rises MOTION.segRise over MOTION.segMove. Reduce Motion:
 * fades only, MOTION.reducedFade.
 *
 * Only transform and opacity animate. The pane is held at the height it had
 * when the swap started until the new pane has arrived, so the page under the
 * tab bar never collapses mid-swap and the scroll position stays anchored to
 * the bar. The first render never animates (the page's own transition owns it).
 *
 * `className` and any extra props land on the pane, so the pane keeps the
 * styling the old container had. `swapKey` is the active tab id.
 */
function tween(ms, ease) {
  return { duration: ms / 1000, ease }
}

function segmentSwap(reduced) {
  if (reduced) {
    const fade = tween(MOTION.reducedFade, EASE.fade)
    return {
      variants: {
        [VARIANT.from]: { opacity: 0 },
        [VARIANT.in]: { opacity: 1, transition: fade },
        [VARIANT.out]: { opacity: 0, transition: fade },
      },
      initial: VARIANT.from,
      animate: VARIANT.in,
      exit: VARIANT.out,
    }
  }
  return {
    variants: {
      [VARIANT.from]: { opacity: 0, y: MOTION.segRise },
      [VARIANT.in]: {
        opacity: 1,
        y: 0,
        transition: {
          opacity: tween(MOTION.segIn, EASE.fade),
          y: tween(MOTION.segMove, EASE.move),
        },
      },
      [VARIANT.out]: { opacity: 0, transition: tween(MOTION.segOut, EASE.fade) },
    },
    initial: VARIANT.from,
    animate: VARIANT.in,
    exit: VARIANT.out,
  }
}

export default function ContentSwap({ swapKey, children, className, ...rest }) {
  const { reduced } = useMotionPreference()
  const holderRef = useRef(null)
  const lastKey = useRef(swapKey)

  // Runs before paint on a key change, while the outgoing pane is still
  // mounted (AnimatePresence mode="wait"): pin the height it has now.
  useLayoutEffect(() => {
    if (lastKey.current === swapKey) return
    lastKey.current = swapKey
    const holder = holderRef.current
    if (holder) holder.style.minHeight = `${holder.offsetHeight}px`
  }, [swapKey])

  // Only the arriving pane releases the hold, never the one leaving.
  const release = (definition) => {
    if (definition !== VARIANT.in) return
    if (holderRef.current) holderRef.current.style.minHeight = ''
  }

  return (
    <div ref={holderRef}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={swapKey}
          className={className}
          {...rest}
          {...segmentSwap(reduced)}
          onAnimationComplete={release}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/**
 * Content arriving into a box that already has its final size.
 *
 * The placeholder and the real content share one grid cell, so the box never
 * changes size: the placeholder fades out while the content fades in
 * (MOTION.arrive on the fade curve; Reduce Motion: MOTION.reducedFade). The
 * placeholder must be the final size of the content. If the content is ready
 * on first render (a warm cache) nothing animates.
 *
 *   <Arrive ready={!loading} placeholder={<RailSkeleton />}>
 *     <Rail items={items} />
 *   </Arrive>
 *
 * `ready` flipping back to false (a refetch) cross-fades back to the
 * placeholder. `as` picks the element (use "span" inside buttons and text),
 * `className` styles the grid wrapper, `cellClassName` both layers, `center`
 * centres each layer in the cell (small values like a stat numeral).
 */
const STACK = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
}

const STACK_CENTER = { ...STACK, justifyItems: 'center' }

const CELL = {
  gridArea: '1 / 1',
  minWidth: 0,
}

export function Arrive({ ready, placeholder, children, className, cellClassName, as = 'div', center = false }) {
  const { reduced } = useMotionPreference()
  const Wrapper = as
  const Cell = motion[as]
  return (
    <Wrapper className={className} style={center ? STACK_CENTER : STACK}>
      <AnimatePresence initial={false}>
        {ready ? (
          <Cell key="content" className={cellClassName} style={CELL} {...contentSwap(reduced)}>
            {children}
          </Cell>
        ) : (
          <Cell
            key="placeholder"
            className={cellClassName}
            style={CELL}
            aria-hidden="true"
            {...contentSwap(reduced)}
          >
            {placeholder}
          </Cell>
        )}
      </AnimatePresence>
    </Wrapper>
  )
}

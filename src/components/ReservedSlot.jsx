import React from 'react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import './ReservedSlot.css'

/**
 * Keeps a section's box in the layout, then collapses it when the
 * section turns out empty. `open` stays true while loading and while
 * real content is shown. Flipping it false animates the height to 0
 * (150ms, instant under reduced motion) instead of removing the node
 * in one frame. Children stay mounted during the collapse so the
 * animation has a real height to shrink.
 */
export default function ReservedSlot({ open, children, className = '' }) {
  const { reduced } = useMotionPreference()
  const classes = ['reserved-slot', open ? '' : 'reserved-slot--empty', className]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classes}
      style={{ '--reserved-ms': reduced ? '0ms' : '150ms' }}
      aria-hidden={open ? undefined : true}
    >
      <div className="reserved-slot__clip">{children}</div>
    </div>
  )
}

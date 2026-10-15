import { useDragControls } from 'motion/react'
import { sheetDragEnd, sheetTransition } from './xMotion'

/**
 * Shared sheet motion: 340ms rise, backdrop fade, swipe-down dismiss.
 * Drag starts only from the handle (`startDrag`) so a scrolling body
 * still scrolls.
 */
export function useSheetDrag(reduced, onClose) {
  const dragControls = useDragControls()
  const transition = sheetTransition(reduced)
  const dragProps = reduced
    ? {}
    : {
        drag: 'y',
        dragControls,
        dragListener: false,
        dragConstraints: { top: 0, bottom: 0 },
        dragElastic: { top: 0, bottom: 0.6 },
        onDragEnd: sheetDragEnd(onClose),
      }
  const startDrag = (e) => {
    if (reduced) return
    dragControls.start(e)
  }
  return { transition, dragProps, startDrag }
}

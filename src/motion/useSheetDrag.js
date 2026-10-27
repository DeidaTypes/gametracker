import { useDragControls } from 'motion/react'
import { sheetDim, sheetDragEnd, sheetPanel } from './xMotion'

/**
 * Shared sheet motion: panel rises in MOTION.sheetIn on the move curve and
 * leaves in MOTION.sheetOut on the leave curve; the dim fades with it both
 * ways. Spread `dim` on the backdrop and `panel` on the sheet. Swipe-down
 * dismiss starts only from the handle (`startDrag`) so a scrolling body
 * still scrolls.
 */
export function useSheetDrag(reduced, onClose) {
  const dragControls = useDragControls()
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
  return { panel: sheetPanel(reduced), dim: sheetDim(reduced), dragProps, startDrag }
}

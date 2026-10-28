import { useDragControls } from 'motion/react'
import { sheetDim, sheetDragEnd, sheetPanel } from './xMotion'

/**
 * Shared sheet motion: panel rises in MOTION.sheetIn on the move curve and
 * leaves in MOTION.sheetOut on the leave curve; the dim fades with it both
 * ways. Swipe-down dismiss starts only from the handle (`startDrag`) so a
 * scrolling body still scrolls.
 *
 * Contract: `dim` and `panel` go on two SIBLING elements inside a plain
 * (non-animated) root, never parent and child:
 *
 *   <div className="…-root">
 *     <motion.div className="…-backdrop" onClick={close} {...dim} />
 *     <motion.div className="…-sheet" {...panel} {...dragProps}>…</motion.div>
 *   </div>
 *
 * The backdrop is the only element whose opacity animates. If the panel sat
 * inside the faded element it would inherit the fade and be see-through while
 * it rises. The panel is fully opaque from its first frame. The root must not
 * animate and the panel needs `position: relative` so it paints over the
 * absolutely positioned backdrop.
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

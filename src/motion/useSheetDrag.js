import { useDragControls } from 'motion/react'
import { sheetDim, sheetDragEnd, sheetSlide } from './xMotion'

/**
 * Shared sheet motion: the sheet rises in MOTION.sheetIn on the move curve and
 * leaves in MOTION.sheetOut on the leave curve; the dim fades with it both
 * ways. Swipe-down dismiss starts only from the handle (`startDrag`) so a
 * scrolling body still scrolls.
 *
 * The slide (`slide`, a transform string, compositor) and the drag (`y`, main
 * thread) are on two nested elements so the slide never waits on the main
 * thread. Contract: `dim` and `slide` go on two SIBLING branches inside a plain
 * (non-animated) root, never parent and child, and `dragProps` goes on the
 * panel INSIDE the slide wrapper:
 *
 *   <div className="…-root">
 *     <motion.div className="…-backdrop" onClick={close} {...dim} />
 *     <motion.div className="…-slide" {...slide}>
 *       <motion.div className="…-sheet" {...dragProps}>…</motion.div>
 *     </motion.div>
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
  return { slide: sheetSlide(reduced), dim: sheetDim(reduced), dragProps, startDrag }
}

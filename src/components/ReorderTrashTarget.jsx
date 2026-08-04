import React from 'react'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import './ReorderTrashTarget.css'

/**
 * Slide-up trash target shown while a game cover is being long-press
 * dragged on ListDetail (custom lists, owner/collaborator only).
 *
 * Rendered via a portal straight to document.body — same reasoning as
 * ToastHost: `position: fixed` here must resolve against
 * the real viewport, not whatever transformed ancestor a PageTransition
 * ancestor happens to be at rest (Framer Motion leaves a `transform`
 * style on its motion.div even after the enter animation finishes,
 * which would otherwise turn this into a `position: sticky`-like box
 * scoped to that ancestor instead of the viewport).
 *
 * Props:
 *   visible - true while a drag session is active; slides the bar up
 *             into view and fades it in (reversed when false).
 *   armed   - true while the dragged cover's center is over this bar's
 *             bounds; swaps in the danger tint + scales the glyphs up.
 *   barRef  - ref assigned to the bar element itself. ListDetail reads
 *             its live getBoundingClientRect() on every pointermove to
 *             hit-test the dragged cover against it.
 */
function ReorderTrashTarget({ visible, armed, barRef }) {
  return createPortal(
    <div
      ref={barRef}
      className={`reorder-trash-target${visible ? ' reorder-trash-target--visible' : ''}${
        armed ? ' reorder-trash-target--armed' : ''
      }`}
      aria-hidden={!visible}
    >
      <Trash2 size={20} aria-hidden="true" />
      <span className="reorder-trash-target__label">Remove from list</span>
    </div>,
    document.body
  )
}

export default ReorderTrashTarget

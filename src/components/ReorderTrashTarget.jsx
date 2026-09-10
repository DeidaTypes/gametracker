import React from 'react'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import './ReorderTrashTarget.css'

/**
 * Circular glass trash bubble shown while a game cover is being long-press
 * dragged on Library (My Games) or ListDetail (custom lists).
 *
 * Rendered via a portal straight to document.body — same reasoning as
 * ToastHost: `position: fixed` here must resolve against the real viewport,
 * not whatever transformed ancestor a PageTransition ancestor happens to be
 * at rest.
 *
 * Props:
 *   visible - true while a drag session is active; slides the bubble up
 *             into view and fades it in (reversed when false).
 *   armed   - true while the dragged cover's center is over this bubble's
 *             bounds; intensifies fill/border and scales up slightly.
 *   barRef  - ref assigned to the bubble element. Drag handlers read its
 *             getBoundingClientRect() once on activation for hit-testing.
 */
function ReorderTrashTarget({ visible, armed, barRef }) {
  return createPortal(
    <div
      ref={barRef}
      className={`reorder-trash-target${visible ? ' reorder-trash-target--visible' : ''}${
        armed ? ' reorder-trash-target--armed' : ''
      }`}
      aria-hidden={!visible}
      aria-label="Remove from library"
    >
      <span className="reorder-trash-target__specular" aria-hidden="true" />
      <Trash2 size={22} aria-hidden="true" className="reorder-trash-target__icon" />
    </div>,
    document.body
  )
}

export default ReorderTrashTarget

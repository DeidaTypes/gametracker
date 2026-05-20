import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './ActionSheet.css'

/**
 * Bottom-anchored action sheet.
 *
 * Props:
 *   isOpen       – boolean
 *   onClose      – () => void
 *   title        – optional string rendered as a heading above items
 *   items        – Array<{ label, onClick, destructive?, disabled? }>
 *                  label may be a string or JSX element.
 *                  Items are rendered before the Cancel row.
 *
 * The sheet always renders a "Cancel" row at the bottom separated
 * by a 1px divider.
 */
function ActionSheet({ isOpen, onClose, title, items = [] }) {
  const sheetRef = useRef(null)
  const titleId = title ? 'action-sheet-title' : undefined

  // Trap focus inside the sheet while open
  useEffect(() => {
    if (!isOpen) return
    const el = sheetRef.current
    if (!el) return
    // Small delay so CSS animation has started before we focus
    const id = setTimeout(() => el.focus(), 50)
    return () => clearTimeout(id)
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div
      className="action-sheet-overlay"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label={titleId ? undefined : 'Actions'}
      aria-labelledby={titleId}
    >
      <div
        ref={sheetRef}
        className="action-sheet"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="action-sheet__handle" aria-hidden="true" />
        {title && (
          <p id={titleId} className="action-sheet__title">{title}</p>
        )}

        <div className="action-sheet__items" role="menu">
          {items.map((item, idx) => (
            <button
              key={idx}
              className={`action-sheet__item${item.destructive ? ' action-sheet__item--destructive' : ''}`}
              onClick={() => {
                onClose()
                item.onClick()
              }}
              disabled={item.disabled}
              role="menuitem"
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="action-sheet__divider" aria-hidden="true" />

        <button
          className="action-sheet__item action-sheet__item--cancel"
          onClick={onClose}
          role="menuitem"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body
  )
}

export default ActionSheet

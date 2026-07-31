import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { LuChevronRight } from 'react-icons/lu'
import { useMotionPreference } from '../hooks/useMotionPreference'
import './ActionSheet.css'

/**
 * Bottom-anchored action sheet.
 *
 * Animation: backdrop fades from 0 to 0.5 opacity over 150 ms; sheet
 * slides up from y: 100% to 0 on a spring (stiffness 380, damping 32).
 * Both honor prefers-reduced-motion via useMotionPreference — when
 * reduced motion is requested, the sheet appears instantly.
 *
 * Props:
 *   isOpen       – boolean
 *   onClose      – () => void
 *   title        – optional string rendered as a heading above items
 *   items        – Array<Item>, where Item is one of:
 *                    { divider: true }  — a thin group separator
 *                    {
 *                      label, onClick, disabled?, destructive?,
 *                      icon?      – JSX rendered inside a tinted tile.
 *                                   Rows without an icon fall back to
 *                                   the plain text style (e.g. a lone
 *                                   destructive confirmation action).
 *                      tone?      – 'cobalt' | 'green' | 'purple' | 'neutral'
 *                                   tints the icon tile. Ignored without icon.
 *                      chevron?   – set to false to hide the trailing
 *                                   chevron on an icon row (defaults to true).
 *                    }
 *                  label may be a string or JSX element.
 *                  Items are rendered before the Cancel row.
 *
 * The sheet always renders a "Cancel" row at the bottom separated
 * by a 1px divider.
 */
function ActionSheet({ isOpen, onClose, title, items = [] }) {
  const sheetRef = useRef(null)
  const titleId = title ? 'action-sheet-title' : undefined
  const { reduced } = useMotionPreference()

  useEffect(() => {
    if (!isOpen) return
    const el = sheetRef.current
    if (!el) return
    const id = setTimeout(() => el.focus(), 50)
    return () => clearTimeout(id)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.15 }
  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="action-sheet-overlay"
          onClick={onClose}
          aria-modal="true"
          role="dialog"
          aria-label={titleId ? undefined : 'Actions'}
          aria-labelledby={titleId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <motion.div
            ref={sheetRef}
            className="action-sheet"
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? { y: 0 } : { y: '100%' }}
            transition={sheetTransition}
          >
            <div className="action-sheet__handle" aria-hidden="true" />
            {title && (
              <p id={titleId} className="action-sheet__title">{title}</p>
            )}

            <div className="action-sheet__items" role="menu">
              {items.map((item, idx) =>
                item.divider ? (
                  <div
                    key={idx}
                    className="action-sheet__divider"
                    aria-hidden="true"
                  />
                ) : (
                  <button
                    key={idx}
                    type="button"
                    className={`action-sheet__item${item.icon ? ' action-sheet__item--row' : ''}${item.destructive ? ' action-sheet__item--destructive' : ''}`}
                    onClick={() => {
                      onClose()
                      item.onClick()
                    }}
                    disabled={item.disabled}
                    role="menuitem"
                  >
                    {item.icon && (
                      <span
                        className={`action-sheet__icon-tile action-sheet__icon-tile--${item.tone || 'cobalt'}`}
                        aria-hidden="true"
                      >
                        {item.icon}
                      </span>
                    )}
                    <span className="action-sheet__item-label">{item.label}</span>
                    {item.icon && item.chevron !== false && (
                      <span className="action-sheet__chevron" aria-hidden="true">
                        <LuChevronRight size={18} />
                      </span>
                    )}
                  </button>
                )
              )}
            </div>

            <div className="action-sheet__divider" aria-hidden="true" />

            <button
              type="button"
              className="action-sheet__item action-sheet__item--cancel"
              onClick={onClose}
              role="menuitem"
            >
              Cancel
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default ActionSheet

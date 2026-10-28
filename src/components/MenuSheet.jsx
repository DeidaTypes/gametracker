import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { LuX, LuChevronRight } from 'react-icons/lu'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useSheetDrag } from '../motion/useSheetDrag'
import './MenuSheet.css'

function MenuRow({ icon, label, onClick, destructive = false, chevron = false, disabled = false }) {
  const cls = [
    'menu-sheet__row',
    destructive ? 'menu-sheet__row--destructive' : '',
    disabled ? 'menu-sheet__row--disabled' : '',
  ].filter(Boolean).join(' ')

  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      <span className="menu-sheet__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="menu-sheet__main">
        <span className="menu-sheet__label">{label}</span>
        {chevron ? (
          <LuChevronRight className="menu-sheet__chevron" size={16} aria-hidden="true" />
        ) : null}
      </span>
    </button>
  )
}

/**
 * MenuSheet — the one "⋯" menu sheet (Profile and List pages share it).
 * Handle (drag it down to dismiss), X on the right, 48pt rows with an 18px
 * line icon, hairlines that start at the label.
 *
 * Props:
 *   isOpen, onClose, ariaLabel
 *   items – Array<
 *     { icon, label, onClick, destructive?, chevron?, disabled? } |
 *     { divider: true }   8pt of space with a hairline
 *   >
 *
 * A row closes the sheet, then runs its action. Destructive rows draw their
 * icon and label in --status-danger.
 *
 * Motion: backdrop and panel are siblings (see motion/useSheetDrag.js), so the
 * panel is opaque from its first frame while the backdrop fades.
 */
function MenuSheet({ isOpen, onClose, ariaLabel = 'Actions', items = [] }) {
  const { reduced } = useMotionPreference()
  const sheetRef = useRef(null)
  const { panel, dim, dragProps, startDrag } = useSheetDrag(reduced, onClose)

  useEffect(() => {
    if (!isOpen) return
    const id = setTimeout(() => sheetRef.current?.focus(), 50)
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

  const go = (fn) => {
    onClose()
    fn?.()
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="menu-sheet-root" key="menu-sheet">
          <motion.div
            className="menu-sheet-backdrop"
            aria-hidden="true"
            onClick={onClose}
            {...dim}
          />
          <motion.div
            ref={sheetRef}
            className="menu-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            {...panel}
            {...dragProps}
          >
            <div className="menu-sheet__handle" aria-hidden="true" onPointerDown={startDrag} />

            <div className="menu-sheet__header">
              <button
                type="button"
                className="menu-sheet__close"
                onClick={onClose}
                aria-label="Close"
              >
                <LuX size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="menu-sheet__body">
              {items.map((item, idx) =>
                item.divider ? (
                  <div key={`divider-${idx}`} className="menu-sheet__divider" aria-hidden="true" />
                ) : (
                  <MenuRow
                    key={`${idx}-${typeof item.label === 'string' ? item.label : ''}`}
                    icon={item.icon}
                    label={item.label}
                    destructive={item.destructive}
                    chevron={item.chevron}
                    disabled={item.disabled}
                    onClick={() => go(item.onClick)}
                  />
                )
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default MenuSheet

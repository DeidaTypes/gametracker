import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { LuX, LuChevronRight, LuCheck } from 'react-icons/lu'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useSheetDrag } from '../motion/useSheetDrag'
import KeyboardAwareView from './KeyboardAwareView'
import './MenuSheet.css'

function MenuRow({
  icon,
  label,
  detail,
  onClick,
  onMouseDown,
  destructive = false,
  chevron = false,
  selected = false,
  disabled = false,
}) {
  // A disabled row that explains itself (detail) reads as "locked": dim
  // text, but not faded out like a plain disabled row.
  const locked = disabled && !!detail
  const cls = [
    'menu-sheet__row',
    destructive ? 'menu-sheet__row--destructive' : '',
    disabled ? 'menu-sheet__row--disabled' : '',
    locked ? 'menu-sheet__row--locked' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      onMouseDown={onMouseDown}
      disabled={disabled}
    >
      {icon ? (
        <span className="menu-sheet__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="menu-sheet__main">
        <span className="menu-sheet__copy">
          <span className="menu-sheet__label">{label}</span>
          {detail ? <span className="menu-sheet__detail">{detail}</span> : null}
        </span>
        {selected ? (
          <LuCheck className="menu-sheet__check" size={18} aria-hidden="true" />
        ) : null}
        {chevron ? (
          <LuChevronRight className="menu-sheet__chevron" size={16} aria-hidden="true" />
        ) : null}
      </span>
    </button>
  )
}

/**
 * MenuSheet — the one slide-up menu sheet. Profile and List "⋯", Q&A menus,
 * every confirm, and every one-tap picker render through it (ActionSheet is a
 * thin adapter onto this component).
 *
 * Handle (drag it down to dismiss), X on the right, 48pt rows with an 18px
 * line icon, hairlines that start at the label.
 *
 * Props:
 *   isOpen, onClose, ariaLabel
 *   title      – optional, left of the X. 17 semibold, sentence case.
 *   subtitle   – optional, under the title. 13 --text-secondary, 2 lines max.
 *   items – Array<
 *     { icon?, label, onClick, destructive?, chevron?, disabled?,
 *       detail?,    second line under the label (caption, --text-tertiary)
 *       selected?   18px check in --theme-primary at the right of the row } |
 *     { heading: string }   caption label, not tappable
 *     { divider: true }     8pt of space with a hairline
 *   >
 *   children   – optional custom content under the items (used by the two
 *                pickers that keep a Done / Filter footer). The frame stays
 *                the same.
 *   layer      – 'top' lifts the sheet above CenteredModal (.cm-overlay, 1100)
 *                so it can open over a popup (z-index 1120/1121).
 *   keepFocus  – never move focus into the sheet or off the field beneath it,
 *                so a popup's keyboard stays up. Rows preventDefault on
 *                mousedown for the same reason.
 *
 * A row closes the sheet, then runs its action. Destructive rows draw their
 * icon and label in --status-danger. A row without an icon keeps its label at
 * the gutter (no empty icon gap).
 *
 * Motion: backdrop and panel are siblings (see motion/useSheetDrag.js), so the
 * panel is opaque from its first frame while the backdrop fades. The panel
 * sits in a KeyboardAwareView mode="sheet" anchor so it lifts with the
 * keyboard on the shared curve.
 */
function MenuSheet({
  isOpen,
  onClose,
  ariaLabel = 'Actions',
  title,
  subtitle,
  items = [],
  layer = 'base',
  keepFocus = false,
  children,
}) {
  const { reduced } = useMotionPreference()
  const sheetRef = useRef(null)
  const titleId = useId()
  const { panel, dim, dragProps, startDrag } = useSheetDrag(reduced, onClose)

  const top = layer === 'top'
  // Keeps the field beneath focused: a mousedown on a button would otherwise
  // move focus to it (desktop) and take the keyboard with it.
  const holdFocus = keepFocus ? (e) => e.preventDefault() : undefined

  useEffect(() => {
    if (!isOpen || keepFocus) return
    const id = setTimeout(() => sheetRef.current?.focus(), 50)
    return () => clearTimeout(id)
  }, [isOpen, keepFocus])

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

  const hasHead = !!(title || subtitle)

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className={`menu-sheet-root${top ? ' menu-sheet-root--top' : ''}`}
          key="menu-sheet"
        >
          <motion.div
            className="menu-sheet-backdrop"
            aria-hidden="true"
            onClick={onClose}
            {...dim}
          />
          <KeyboardAwareView
            mode="sheet"
            className={`menu-sheet-anchor${top ? ' menu-sheet-anchor--top' : ''}`}
          >
            <motion.div
              ref={sheetRef}
              className="menu-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={title ? undefined : ariaLabel}
              aria-labelledby={title ? titleId : undefined}
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
              {...panel}
              {...dragProps}
            >
              <div className="menu-sheet__drag-zone" onPointerDown={startDrag}>
                <div className="menu-sheet__handle" aria-hidden="true" />
              </div>

              <div className="menu-sheet__header">
                {hasHead ? (
                  <div className="menu-sheet__head">
                    {title ? (
                      <p id={titleId} className="menu-sheet__title">{title}</p>
                    ) : null}
                    {subtitle ? <p className="menu-sheet__subtitle">{subtitle}</p> : null}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="menu-sheet__close"
                  onClick={onClose}
                  onMouseDown={holdFocus}
                  aria-label="Close"
                >
                  <LuX size={20} aria-hidden="true" />
                </button>
              </div>

              <div className="menu-sheet__body">
                {items.map((item, idx) =>
                  item.divider ? (
                    <div key={`divider-${idx}`} className="menu-sheet__divider" aria-hidden="true" />
                  ) : item.heading ? (
                    <p key={`heading-${idx}`} className="menu-sheet__section">
                      {item.heading}
                    </p>
                  ) : (
                    <MenuRow
                      key={`${idx}-${typeof item.label === 'string' ? item.label : ''}`}
                      icon={item.icon}
                      label={item.label}
                      detail={item.detail}
                      destructive={item.destructive}
                      chevron={item.chevron}
                      selected={item.selected}
                      disabled={item.disabled}
                      onMouseDown={holdFocus}
                      onClick={() => go(item.onClick)}
                    />
                  )
                )}
                {children}
              </div>
            </motion.div>
          </KeyboardAwareView>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default MenuSheet

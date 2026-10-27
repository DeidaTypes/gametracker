import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useDragControls } from 'motion/react'
import { LuChevronRight } from 'react-icons/lu'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { sheetDim, sheetDragEnd, sheetPanel } from '../motion/xMotion'
import KeyboardAwareView from './KeyboardAwareView'
import './ActionSheet.css'

/**
 * Bottom-anchored action sheet.
 *
 * Animation: the shared sheet motion (xMotion sheetPanel / sheetDim). The
 * sheet rises on the move curve and leaves on the leave curve; the backdrop
 * fades with it both ways. Reduced motion fades without moving.
 *
 * Props:
 *   isOpen       – boolean
 *   onClose      – () => void
 *   title        – optional string rendered as a heading above items
 *   items        – Array<Item>, where Item is one of:
 *                    { divider: true }  — a thin group separator
 *                    { heading: string } — non-interactive section label
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
 *   subtitle    – optional sentence under the title
 *   plain       – sentence-case title and bare icons (Q&A overflow menus)
 *   layer       – 'top' lifts the sheet above CenteredModal (.cm-overlay, 1100)
 *                 so it can open over a popup (see ConfirmSheet)
 *   keepFocus   – never move focus into the sheet or off the field beneath
 *                 it, so a popup's keyboard stays up (see ConfirmSheet)
 *
 * The sheet always renders a dismiss row at the bottom separated
 * by a 1px divider. Label defaults to "Cancel".
 */
function ActionSheet({
  isOpen,
  onClose,
  title,
  subtitle,
  plain = false,
  layer = 'base',
  keepFocus = false,
  items = [],
  cancelLabel = 'Cancel',
}) {
  const sheetRef = useRef(null)
  const titleId = title ? 'action-sheet-title' : undefined
  const { reduced } = useMotionPreference()
  const dragControls = useDragControls()

  const top = layer === 'top'
  // Keeps the field beneath focused: a mousedown on a button would otherwise
  // move focus to it (desktop) and take the keyboard with it.
  const holdFocus = keepFocus ? (e) => e.preventDefault() : undefined

  useEffect(() => {
    if (!isOpen || keepFocus) return
    const el = sheetRef.current
    if (!el) return
    const id = setTimeout(() => el.focus(), 50)
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

  const handleDragEnd = sheetDragEnd(onClose)

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={`action-sheet-overlay${top ? ' action-sheet-overlay--top' : ''}`}
          onClick={onClose}
          aria-modal="true"
          role="dialog"
          aria-label={titleId ? undefined : 'Actions'}
          aria-labelledby={titleId}
          {...sheetDim(reduced)}
        >
          <KeyboardAwareView mode="sheet" className={`action-sheet-anchor${top ? ' action-sheet-anchor--top' : ''}`}>
          <motion.div
            ref={sheetRef}
            className="action-sheet"
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
            {...sheetPanel(reduced)}
            drag={reduced ? false : 'y'}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={handleDragEnd}
          >
            <div
              className="action-sheet__drag-zone"
              onPointerDown={(e) => {
                if (!reduced) dragControls.start(e)
              }}
            >
              <div className="action-sheet__handle" aria-hidden="true" />
            </div>
            {title && (
              <p id={titleId} className={`action-sheet__title${plain ? ' action-sheet__title--plain' : ''}`}>{title}</p>
            )}
            {subtitle ? <p className="action-sheet__subtitle">{subtitle}</p> : null}

            <div className="action-sheet__items" role="menu">
              {items.map((item, idx) =>
                item.divider ? (
                  <div
                    key={idx}
                    className="action-sheet__divider"
                    aria-hidden="true"
                  />
                ) : item.heading ? (
                  <p key={idx} className="action-sheet__heading">
                    {item.heading}
                  </p>
                ) : (
                  <button
                    key={idx}
                    type="button"
                    className={[
                      'action-sheet__item',
                      item.icon && !plain ? 'action-sheet__item--row' : '',
                      plain ? 'action-sheet__item--plain' : '',
                      item.destructive ? 'action-sheet__item--destructive' : '',
                      item.disabled && item.detail ? 'action-sheet__item--locked' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => {
                      onClose()
                      item.onClick()
                    }}
                    onMouseDown={holdFocus}
                    disabled={item.disabled}
                    role="menuitem"
                  >
                    {item.icon && !plain ? (
                      <span
                        className={`action-sheet__icon-tile action-sheet__icon-tile--${item.tone || 'cobalt'}`}
                        aria-hidden="true"
                      >
                        {item.icon}
                      </span>
                    ) : null}
                    {item.icon && plain ? (
                      <span className="action-sheet__plain-icon" aria-hidden="true">
                        {item.icon}
                      </span>
                    ) : null}
                    <span className="action-sheet__item-copy">
                      <span className="action-sheet__item-label">{item.label}</span>
                      {item.detail ? (
                        <span className="action-sheet__item-detail">{item.detail}</span>
                      ) : null}
                    </span>
                    {item.icon && !plain && item.chevron !== false ? (
                      <span className="action-sheet__chevron" aria-hidden="true">
                        <LuChevronRight size={18} />
                      </span>
                    ) : null}
                  </button>
                )
              )}
            </div>

            <div className="action-sheet__divider" aria-hidden="true" />

            <button
              type="button"
              className="action-sheet__item action-sheet__item--cancel"
              onClick={onClose}
              onMouseDown={holdFocus}
              role="menuitem"
            >
              {cancelLabel}
            </button>
          </motion.div>
          </KeyboardAwareView>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default ActionSheet

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { LuCheck } from 'react-icons/lu'
import { useMotionPreference } from '../hooks/useMotionPreference'
import './SettingsPickerSheet.css'

/**
 * Bottom sheet with a vertical list of radio options. Used by the
 * Settings page for color-blind mode, message privacy, and activity
 * privacy pickers.
 *
 * Supports a live-preview pattern: every tap on an option calls
 * `onPreview(value)` so the sub-sheet can show the user the change
 * before they confirm. The change is committed via the Done button
 * (or Cancel reverts to the original value).
 *
 * Props:
 *   isOpen         – boolean
 *   onClose        – () => void  (reverts to initial value first)
 *   title          – string
 *   description    – optional string under the title
 *   value          – currently committed value
 *   options        – Array<{ value, label, description? }>
 *   onPreview      – (value: string) => void   called on every selection
 *                    so callers can implement a live-preview side effect
 *                    (eg. swapping accent tokens in real time).
 *   onApply        – (value: string) => void   committed on Done tap
 *   previewSlot    – optional React node rendered above the options;
 *                    callers use it to show a small palette preview
 *                    that reflects the currently-selected `value`.
 */
function SettingsPickerSheet({
  isOpen,
  onClose,
  title,
  description,
  value,
  options = [],
  onPreview,
  onApply,
  previewSlot = null,
}) {
  const sheetRef = useRef(null)
  const initialValueRef = useRef(value)
  const [pending, setPending] = useState(value)
  const { reduced } = useMotionPreference()

  useEffect(() => {
    if (isOpen) {
      initialValueRef.current = value
      setPending(value)
    }
  }, [isOpen, value])

  useEffect(() => {
    if (!isOpen) return
    const el = sheetRef.current
    if (!el) return
    const id = setTimeout(() => el.focus(), 50)
    return () => clearTimeout(id)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') handleCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const select = (next) => {
    setPending(next)
    if (onPreview) onPreview(next)
  }

  const handleApply = () => {
    if (onApply) onApply(pending)
    onClose()
  }

  const handleCancel = () => {
    if (onPreview && pending !== initialValueRef.current) {
      onPreview(initialValueRef.current)
    }
    setPending(initialValueRef.current)
    onClose()
  }

  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.15 }
  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="action-sheet-overlay"
          onClick={handleCancel}
          aria-modal="true"
          role="dialog"
          aria-label={title}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <motion.div
            ref={sheetRef}
            className="action-sheet settings-picker-sheet"
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? { y: 0 } : { y: '100%' }}
            transition={sheetTransition}
          >
            <div className="action-sheet__handle" aria-hidden="true" />
            <div className="settings-picker-sheet__header">
              <h2 className="settings-picker-sheet__title">{title}</h2>
              {description && (
                <p className="settings-picker-sheet__description">{description}</p>
              )}
            </div>

            {previewSlot && (
              <div className="settings-picker-sheet__preview">{previewSlot}</div>
            )}

            <ul
              className="settings-picker-sheet__options"
              role="radiogroup"
              aria-label={title}
            >
              {options.map((opt) => {
                const selected = pending === opt.value
                return (
                  <li key={opt.value} className="settings-picker-sheet__row">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`settings-picker-sheet__option${selected ? ' settings-picker-sheet__option--selected' : ''}`}
                      onClick={() => select(opt.value)}
                    >
                      <span className="settings-picker-sheet__labels">
                        <span className="settings-picker-sheet__label">
                          {opt.label}
                        </span>
                        {opt.description && (
                          <span className="settings-picker-sheet__sublabel">
                            {opt.description}
                          </span>
                        )}
                      </span>
                      <span
                        className="settings-picker-sheet__check"
                        aria-hidden="true"
                      >
                        {selected && <LuCheck size={18} />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            <div className="settings-picker-sheet__footer">
              <button
                type="button"
                className="settings-picker-sheet__btn settings-picker-sheet__btn--secondary"
                onClick={handleCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="settings-picker-sheet__btn settings-picker-sheet__btn--primary"
                onClick={handleApply}
              >
                Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default SettingsPickerSheet

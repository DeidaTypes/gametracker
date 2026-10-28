import React, { useEffect, useRef, useState } from 'react'
import { LuCheck } from 'react-icons/lu'
import MenuSheet from './MenuSheet'
import { hapticImpact } from '../utils/haptics'
import './SettingsPickerSheet.css'

/**
 * Radio-list sheet in the shared MenuSheet frame (handle, title on the left,
 * X on the right). The options, the live preview and the Cancel / Done footer
 * are its own content. Closing any way other than Done (X, tap outside, drag
 * down, Escape) reverts, same as Cancel.
 *
 * A vertical list of radio options. Used by the
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
 *   onClose        – () => void  (close only; does not revert)
 *   onCancel       – optional () => void. Cancel, backdrop, and Escape
 *                    call this before onClose. Done does not.
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
  onCancel,
  title,
  description,
  value,
  options = [],
  onPreview,
  onApply,
  previewSlot = null,
}) {
  const initialValueRef = useRef(value)
  const [pending, setPending] = useState(value)

  useEffect(() => {
    if (isOpen) {
      initialValueRef.current = value
      setPending(value)
    }
  }, [isOpen, value])

  const select = (next) => {
    if (next === pending) return
    hapticImpact('Light')
    setPending(next)
    if (onPreview) onPreview(next)
  }

  const handleApply = () => {
    if (onApply) onApply(pending)
    onClose()
  }

  const handleCancel = () => {
    if (onCancel) {
      onCancel()
    } else if (onPreview && pending !== initialValueRef.current) {
      onPreview(initialValueRef.current)
    }
    setPending(initialValueRef.current)
    onClose()
  }

  return (
    <MenuSheet isOpen={isOpen} onClose={handleCancel} ariaLabel={title} title={title}>
      {description && (
        <p className="settings-picker-sheet__description">{description}</p>
      )}

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
    </MenuSheet>
  )
}

export default SettingsPickerSheet

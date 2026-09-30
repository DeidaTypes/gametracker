import React from 'react'
import './IOSSwitch.css'

/**
 * iOS-style toggle switch.
 *
 * Uses a hidden `<input type="checkbox">` for native accessibility +
 * keyboard semantics, with the visible track + thumb rendered as
 * sibling spans skinned via CSS. Cobalt accent matches the rest of
 * the app when on; track turns dim when off.
 *
 * Props:
 *   checked    – boolean
 *   onChange   – (next: boolean) => void
 *   disabled   – boolean (optional)
 *   label           – aria-label string for screen readers when no visible label
 *   id              – optional id for label[for] association
 *   presentational  – render only the track. The parent row owns
 *                     role="switch" and the toggle.
 */
function IOSSwitch({ checked, onChange, disabled = false, label, id, presentational = false }) {
  const handleChange = (e) => {
    if (!onChange) return
    onChange(e.target.checked)
  }

  if (presentational) {
    return (
      <span
        className={`ios-switch${checked ? ' ios-switch--on' : ''}`}
        aria-hidden="true"
      >
        <span className="ios-switch__track">
          <span className="ios-switch__thumb" />
        </span>
      </span>
    )
  }

  return (
    <span
      className={`ios-switch${checked ? ' ios-switch--on' : ''}${disabled ? ' ios-switch--disabled' : ''}`}
    >
      <input
        type="checkbox"
        id={id}
        className="ios-switch__input"
        checked={!!checked}
        disabled={disabled}
        onChange={handleChange}
        aria-label={label}
        role="switch"
        aria-checked={!!checked}
      />
      <span className="ios-switch__track" aria-hidden="true">
        <span className="ios-switch__thumb" />
      </span>
    </span>
  )
}

export default IOSSwitch

import React from 'react'
import './forms.css'

/**
 * Ghost-styled secondary button (Cancel, dismiss, etc.).
 * Same dimensions as SubmitButton.
 */
function SecondaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  className = '',
  ...rest
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={[
        'form-button',
        'form-button--secondary',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}

export default SecondaryButton

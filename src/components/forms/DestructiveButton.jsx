import React from 'react'
import './forms.css'

/**
 * Destructive action button — muted red (#a04848) border + text.
 * Same dimensions as SubmitButton / SecondaryButton.
 * Use for delete confirmations only; never use the bright amber accent.
 */
function DestructiveButton({
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
        'form-button--destructive',
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

export default DestructiveButton

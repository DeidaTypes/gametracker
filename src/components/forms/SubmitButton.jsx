import React from 'react'
import './forms.css'

/**
 * Primary CTA button. When `loading` is true, the label is replaced
 * with three dots that pulse in sequence.
 */
function SubmitButton({
  primary = true,
  disabled = false,
  loading = false,
  children,
  type = 'submit',
  onClick,
  form,
  className = '',
  ...rest
}) {
  const isInert = disabled || loading

  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={isInert}
      aria-busy={loading || undefined}
      className={[
        'form-button',
        primary ? 'form-button--primary' : 'form-button--secondary',
        loading ? 'form-button--loading' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? (
        <span className="form-button__dots" aria-hidden="true">
          <span className="form-button__dot" />
          <span className="form-button__dot" />
          <span className="form-button__dot" />
        </span>
      ) : (
        children
      )}
      {loading && <span className="sr-only">Loading…</span>}
    </button>
  )
}

export default SubmitButton

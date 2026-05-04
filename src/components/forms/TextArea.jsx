import React, { useEffect, useId, useRef, useState } from 'react'
import './forms.css'

const MAX_HEIGHT = 200

/**
 * Recessed-fill textarea. Auto-grows up to 200px, then scrolls
 * internally. The native drag-resize handle is hidden.
 */
function TextArea({
  label,
  maxLength,
  value = '',
  onChange,
  onBlur,
  placeholder,
  hint,
  required = false,
  autoFocus,
  id,
  name,
  disabled,
  rows = 3,
  className = '',
  ...rest
}) {
  const reactId = useId()
  const inputId = id || `text-area-${reactId}`
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`

  const [touched, setTouched] = useState(false)
  const textareaRef = useRef(null)

  const showRequiredError =
    required && touched && (!value || !String(value).trim())
  const hasError = showRequiredError

  const showCounter = typeof maxLength === 'number' && maxLength > 0
  const charLength = value ? String(value).length : 0

  // Auto-grow: reset height then set to scrollHeight, capped at max.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, MAX_HEIGHT)
    el.style.height = next + 'px'
  }, [value])

  const handleBlur = (e) => {
    setTouched(true)
    onBlur?.(e)
  }

  const describedBy = []
  if (hint) describedBy.push(hintId)
  if (hasError) describedBy.push(errorId)

  return (
    <div
      className={[
        'form-field',
        hasError ? 'form-field--error' : '',
        disabled ? 'form-field--disabled' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {(label || showCounter) && (
        <div className="form-field__label-row">
          {label ? (
            <label htmlFor={inputId} className="form-field__label">
              <span>{label}</span>
              {required && (
                <span aria-hidden="true" className="form-field__required">
                  *
                </span>
              )}
            </label>
          ) : (
            <span />
          )}
          {showCounter && (
            <span className="form-field__counter">
              {charLength}/{maxLength}
            </span>
          )}
        </div>
      )}

      <textarea
        ref={textareaRef}
        id={inputId}
        name={name}
        value={value}
        onChange={onChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        disabled={disabled}
        required={required}
        rows={rows}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy.length ? describedBy.join(' ') : undefined}
        className="form-field__control form-field__textarea"
        {...rest}
      />

      {(hint || hasError) && (
        <div className="form-field__meta">
          {hint && !hasError && (
            <p id={hintId} className="form-field__hint">
              {hint}
            </p>
          )}
          {hasError && (
            <p id={errorId} className="form-field__error" role="alert">
              Required
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default TextArea

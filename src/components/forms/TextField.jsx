import React, { useId, useState } from 'react'
import './forms.css'

/**
 * Recessed-fill text input with label, optional character counter,
 * hint text, and required-field error state on blur.
 */
function TextField({
  label,
  maxLength,
  value = '',
  onChange,
  onBlur,
  placeholder,
  hint,
  required = false,
  type = 'text',
  autoFocus,
  autoComplete,
  inputMode,
  id,
  name,
  disabled,
  className = '',
  ...rest
}) {
  const reactId = useId()
  const inputId = id || `text-field-${reactId}`
  const counterId = `${inputId}-counter`
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`

  const [touched, setTouched] = useState(false)

  const showRequiredError =
    required && touched && (!value || !String(value).trim())
  const hasError = showRequiredError

  const showCounter = typeof maxLength === 'number' && maxLength > 0
  const charLength = value ? String(value).length : 0

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
            <span id={counterId} className="form-field__counter">
              {charLength}/{maxLength}
            </span>
          )}
        </div>
      )}

      <input
        id={inputId}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        inputMode={inputMode}
        disabled={disabled}
        required={required}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy.length ? describedBy.join(' ') : undefined}
        className="form-field__control"
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

export default TextField

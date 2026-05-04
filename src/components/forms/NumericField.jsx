import React, { useId, useState } from 'react'
import './forms.css'

/**
 * Numeric input with stepper buttons on either side and an optional
 * suffix label rendered inside the field at the right edge.
 *
 * Value is exposed as a string so callers can keep their form state
 * unchanged when the field is empty.
 */
function NumericField({
  label,
  value = '',
  onChange,
  suffix,
  hint,
  required = false,
  min,
  max,
  step = 1,
  placeholder = '0',
  id,
  name,
  disabled,
  className = '',
  ...rest
}) {
  const reactId = useId()
  const inputId = id || `numeric-field-${reactId}`
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`

  const [touched, setTouched] = useState(false)
  const showRequiredError = required && touched && (value === '' || value == null)
  const hasError = showRequiredError

  const numericValue =
    value === '' || value == null || isNaN(parseFloat(value))
      ? null
      : parseFloat(value)

  const clamp = (n) => {
    let next = n
    if (typeof min === 'number' && next < min) next = min
    if (typeof max === 'number' && next > max) next = max
    return next
  }

  const emit = (next) => {
    onChange?.({ target: { value: String(next) } })
  }

  const handleChange = (e) => {
    const v = e.target.value
    if (v === '') {
      onChange?.(e)
      return
    }
    if (!/^-?\d*\.?\d*$/.test(v)) return
    onChange?.(e)
  }

  const handleStep = (delta) => {
    const base = numericValue == null ? (typeof min === 'number' ? min : 0) : numericValue
    const next = clamp(parseFloat((base + delta).toFixed(10)))
    emit(next)
  }

  const handleBlur = () => setTouched(true)

  const decDisabled =
    disabled ||
    (typeof min === 'number' && numericValue != null && numericValue <= min)
  const incDisabled =
    disabled ||
    (typeof max === 'number' && numericValue != null && numericValue >= max)

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
      {label && (
        <div className="form-field__label-row">
          <label htmlFor={inputId} className="form-field__label">
            <span>{label}</span>
            {required && (
              <span aria-hidden="true" className="form-field__required">
                *
              </span>
            )}
          </label>
        </div>
      )}

      <div className="form-numeric">
        <button
          type="button"
          className="form-numeric__step"
          onClick={() => handleStep(-step)}
          disabled={decDisabled}
          aria-label="Decrease"
          tabIndex={-1}
        >
          −
        </button>

        <input
          id={inputId}
          name={name}
          type="text"
          inputMode="decimal"
          value={value ?? ''}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={
            describedBy.length ? describedBy.join(' ') : undefined
          }
          className="form-numeric__input"
          {...rest}
        />

        {suffix && <span className="form-numeric__suffix">{suffix}</span>}

        <button
          type="button"
          className="form-numeric__step"
          onClick={() => handleStep(step)}
          disabled={incDisabled}
          aria-label="Increase"
          tabIndex={-1}
        >
          +
        </button>
      </div>

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

export default NumericField

import React from 'react'
import { Link } from 'react-router-dom'
import { Check, X, AlertCircle } from 'lucide-react'

export function AuthFieldGroup({ children }) {
  return <div className="auth-field-group">{children}</div>
}

export function AuthFieldRow({
  icon: Icon,
  label,
  value = '',
  onChange,
  onFocus,
  onBlur,
  type = 'text',
  autoComplete,
  inputMode,
  autoCapitalize,
  autoCorrect,
  spellCheck,
  maxLength,
  name,
  focused = false,
  invalid = false,
  valid = false,
  showCount = false,
  countMax,
  endAdornment,
}) {
  const charLength = value ? String(value).length : 0

  return (
    <div
      className={[
        'auth-field-row',
        focused ? 'auth-field-row--focus' : '',
        valid ? 'auth-field-row--ok' : '',
        invalid ? 'auth-field-row--bad' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {Icon ? (
        <span className="auth-field-row__icon" aria-hidden="true">
          <Icon size={18} strokeWidth={2} />
        </span>
      ) : null}
      <input
        className="auth-field-row__input"
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={label}
        aria-label={label}
        autoComplete={autoComplete}
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        maxLength={maxLength}
      />
      <span className="auth-field-row__end">
        {showCount && focused && typeof countMax === 'number' ? (
          <span className="auth-field-row__count text-caption">
            {charLength}/{countMax}
          </span>
        ) : null}
        {valid ? (
          <Check
            className="auth-field-row__mark auth-field-row__mark--ok"
            size={16}
            strokeWidth={2}
            aria-hidden="true"
          />
        ) : null}
        {invalid ? (
          <X
            className="auth-field-row__mark auth-field-row__mark--bad"
            size={16}
            strokeWidth={2}
            aria-hidden="true"
          />
        ) : null}
        {endAdornment}
      </span>
    </div>
  )
}

export function AuthFieldStatus({ tone, message, icon = true }) {
  if (!message) {
    return (
      <p className="auth-field-status" aria-live="polite">
        {'\u00a0'}
      </p>
    )
  }

  const showCheck = icon && tone === 'ok'
  const showX = icon && tone === 'bad'

  return (
    <p
      className={[
        'auth-field-status',
        tone === 'ok' ? 'auth-field-status--ok' : '',
        tone === 'bad' ? 'auth-field-status--bad' : '',
        tone === 'muted' ? 'auth-field-status--muted' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-live="polite"
    >
      {showCheck ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : null}
      {showX ? <X size={14} strokeWidth={2} aria-hidden="true" /> : null}
      <span>{message}</span>
    </p>
  )
}

export function AuthForgotLink({ to, state, onClick, children }) {
  return (
    <p className="auth-forgot-link">
      <Link to={to} state={state} onClick={onClick} className="auth-link">
        {children}
      </Link>
    </p>
  )
}

/**
 * Form-level error card (replaces .auth-error banner).
 */
export function AuthNotice({ title, sub, actionLabel, actionTo, actionState, onActionClick }) {
  if (!title) return null

  const action =
    actionLabel && actionTo ? (
      <Link
        to={actionTo}
        state={actionState}
        onClick={onActionClick}
        className="auth-notice__action"
      >
        {actionLabel}
      </Link>
    ) : null

  return (
    <div className="auth-notice auth-notice--in" role="alert">
      <span className="auth-notice__icon" aria-hidden="true">
        <AlertCircle size={17} strokeWidth={2} />
      </span>
      <div className="auth-notice__text">
        <strong className="auth-notice__title text-body">{title}</strong>
        {sub ? <span className="auth-notice__sub text-caption">{sub}</span> : null}
      </div>
      {action}
    </div>
  )
}

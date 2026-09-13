import React, { forwardRef, useRef } from 'react'
import { HiX } from 'react-icons/hi'
import './SearchField.css'

/**
 * Shared search field: left magnifier, text input, and an in-field ✕
 * that appears only when the value is non-empty.
 *
 * The parent owns search state. `onClear` must empty the query and reset
 * any results / loading / in-flight work — this component only keeps
 * focus in the input so the keyboard stays up for a retype.
 */
const SearchField = forwardRef(function SearchField(
  {
    value,
    onChange,
    onClear,
    onFocus,
    onBlur,
    onKeyDown,
    placeholder,
    id,
    name,
    className = '',
    'aria-label': ariaLabel = 'Search',
    inputMode = 'search',
    enterKeyHint = 'search',
    autoComplete = 'off',
    autoCorrect = 'off',
    autoCapitalize = 'none',
    spellCheck = false,
    ...rest
  },
  ref
) {
  const innerRef = useRef(null)
  const hasValue = value != null && String(value).length > 0

  const setRefs = (node) => {
    innerRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }

  // preventDefault stops the input from blurring (which would dismiss
  // the iOS keyboard). Clear is invoked here as well as onClick because
  // preventing default on pointerdown can swallow the subsequent click
  // in WKWebView — both paths are idempotent.
  const activateClear = (e) => {
    e.preventDefault()
    onClear?.()
    innerRef.current?.focus()
  }

  return (
    <div
      className={`search-field${hasValue ? ' search-field--has-value' : ''}${className ? ` ${className}` : ''}`}
      data-kb-keep
    >
      <svg
        className="search-field__icon"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        ref={setRefs}
        id={id}
        name={name}
        role="searchbox"
        aria-label={ariaLabel}
        inputMode={inputMode}
        enterKeyHint={enterKeyHint}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className="search-field__input"
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
        autoCapitalize={autoCapitalize}
        spellCheck={spellCheck}
        {...rest}
        type="text"
      />
      {hasValue && (
        <button
          type="button"
          className="search-field__clear"
          aria-label="Clear search"
          onMouseDown={activateClear}
          onPointerDown={activateClear}
          onClick={activateClear}
        >
          <HiX aria-hidden="true" />
        </button>
      )}
    </div>
  )
})

export default SearchField

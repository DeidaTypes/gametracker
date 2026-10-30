import React, { forwardRef, useEffect, useId, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { HiX } from 'react-icons/hi'
import './SearchField.css'

/**
 * Shared search field: left magnifier, text input, and an in-field ✕
 * that appears only when the value is non-empty.
 *
 * The parent owns search state. `onClear` must empty the query and reset
 * any results / loading / in-flight work — this component only keeps
 * focus in the input so the keyboard stays up for a retype.
 *
 * `onboarding` is the favorites / now-playing pill (46px, dropdown slot).
 * Search and Library leave it off and keep the field below, unchanged.
 */
const SearchField = forwardRef(function SearchField(props, ref) {
  if (props.onboarding) return <OnboardingPill {...props} ref={ref} />
  return <DefaultSearchField {...props} ref={ref} />
})

const DefaultSearchField = forwardRef(function DefaultSearchField(
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

/**
 * Onboarding pill. The clear control stays mounted so it can scale in when
 * there is text. Pointer-down is cancelled so the tap does not blur the
 * input. `children` is the dropdown, shown only while the query has text
 * and the user has not tapped outside the field.
 */
const OnboardingPill = forwardRef(function OnboardingPill(
  {
    value,
    onChange,
    onClear,
    placeholder = 'Search games…',
    'aria-label': ariaLabel = 'Search games',
    children,
  },
  ref
) {
  const rootRef = useRef(null)
  const innerRef = useRef(null)
  const listId = useId()
  const [dismissed, setDismissed] = useState(false)
  const text = value == null ? '' : String(value)
  const trimmed = text.trim()
  const hasText = text.length > 0
  const open = trimmed.length > 0 && !dismissed && Boolean(children)

  const setRefs = (node) => {
    innerRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }

  useEffect(() => {
    setDismissed(false)
  }, [text])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setDismissed(true)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const clear = (event) => {
    event.preventDefault()
    onClear?.()
    innerRef.current?.focus({ preventScroll: true })
  }

  return (
    <div ref={rootRef} className={'sfield' + (hasText ? ' sfield--has' : '')}>
      <span className="sfield__icon" aria-hidden="true">
        <Search size={18} strokeWidth={1.8} />
      </span>
      <input
        ref={setRefs}
        id={`${listId}-input`}
        type="search"
        className="sfield__input"
        placeholder={placeholder}
        value={text}
        onChange={onChange}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="search"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      <button
        type="button"
        className="sfield__clear"
        aria-label="Clear search"
        aria-hidden={hasText ? undefined : true}
        tabIndex={hasText ? 0 : -1}
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={clear}
        onClick={clear}
      >
        <span className="sfield__clear-dot">
          <X size={12} strokeWidth={2.6} />
        </span>
      </button>
      {open && (
        <div
          id={listId}
          className="sfield__drop"
          role="listbox"
          aria-label="Search results"
        >
          {children}
        </div>
      )}
    </div>
  )
})

export default SearchField

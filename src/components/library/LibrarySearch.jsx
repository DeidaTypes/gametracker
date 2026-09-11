import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import SearchField from '../SearchField'

/**
 * Header search icon + slide-down SearchField row.
 *
 * Chosen reveal: a slide-down row under the header (not an inline
 * header expansion). The title / avatar stay put; the standardized
 * SearchField (magnifier + in-field clear) takes the full content
 * width. Tapping the icon again, or clearing the field, collapses
 * the row and empties the query.
 */
export function useLibrarySearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      if (wasOpen) setQuery('')
      return !wasOpen
    })
  }, [])

  const clear = useCallback(() => {
    setQuery('')
    setOpen(false)
  }, [])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  return { open, query, setQuery, toggle, clear, inputRef }
}

export function LibrarySearchToggle({ open, onToggle }) {
  return (
    <button
      type="button"
      className={`lib-search-toggle${open ? ' lib-search-toggle--open' : ''}`}
      onClick={onToggle}
      aria-label="Search library"
      aria-expanded={open}
      aria-controls="lib-search-panel"
    >
      <SearchIcon size={20} aria-hidden="true" />
    </button>
  )
}

export function LibrarySearchPanel({ open, query, onQueryChange, onClear, inputRef }) {
  if (!open) return null

  return (
    <div id="lib-search-panel" className="lib-search-panel" role="search">
      <SearchField
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onClear={onClear}
        placeholder="Search library"
        aria-label="Search library by title"
      />
    </div>
  )
}

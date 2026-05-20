import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './SortSheet.css'

export const SORT_OPTIONS = [
  { value: 'lastUpdated', label: 'Last Updated' },
  { value: 'latestFirst',  label: 'Latest First' },
  { value: 'oldestFirst',  label: 'Oldest First' },
  { value: 'mostLiked',    label: 'Most Liked' },
  { value: 'alphabetical', label: 'Alphabetically (A–Z)' },
]

/**
 * SortSheet — bottom sheet with pill-selector UX.
 *
 * Props:
 *   isOpen    – boolean
 *   onClose   – () => void
 *   value     – currently applied sort key (one of SORT_OPTIONS values)
 *   onApply   – (newValue: string) => void  called when user taps Filter
 */
function SortSheet({ isOpen, onClose, value, onApply }) {
  const [pending, setPending] = useState(value)
  const sheetRef = useRef(null)

  // Sync pending selection whenever the sheet opens
  useEffect(() => {
    if (isOpen) setPending(value)
  }, [isOpen, value])

  // Move focus into the sheet for keyboard / screen-reader users
  useEffect(() => {
    if (!isOpen) return
    const el = sheetRef.current
    if (!el) return
    const id = setTimeout(() => el.focus(), 50)
    return () => clearTimeout(id)
  }, [isOpen])

  // Escape closes
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div
      className="action-sheet-overlay"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label="Sort options"
    >
      <div
        ref={sheetRef}
        className="action-sheet sort-sheet"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="action-sheet__handle" aria-hidden="true" />
        <p className="action-sheet__title">Sort By</p>

        <div className="sort-sheet__pills" role="radiogroup" aria-label="Sort order">
          {SORT_OPTIONS.map((opt) => {
            const isSelected = pending === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={`sort-sheet__pill${isSelected ? ' sort-sheet__pill--active' : ''}`}
                onClick={() => setPending(opt.value)}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        <div className="sort-sheet__footer">
          <button
            type="button"
            className="sort-sheet__apply"
            onClick={() => { onApply(pending); onClose() }}
          >
            Filter
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default SortSheet

import React, { useState, useEffect } from 'react'
import MenuSheet from './MenuSheet'
import { hapticImpact } from '../utils/haptics'
import './SortSheet.css'

export const SORT_OPTIONS = [
  { value: 'lastUpdated', label: 'Last Updated' },
  { value: 'latestFirst',  label: 'Latest First' },
  { value: 'oldestFirst',  label: 'Oldest First' },
  { value: 'mostLiked',    label: 'Most Liked' },
  { value: 'alphabetical', label: 'Alphabetically (A–Z)' },
]

/**
 * SortSheet — pill-selector sheet in the shared MenuSheet frame (handle, title
 * on the left, X on the right). The pills and the Filter button are its own
 * content: the choice is held until Filter is tapped.
 *
 * Props:
 *   isOpen    – boolean
 *   onClose   – () => void
 *   value     – currently applied sort key (one of SORT_OPTIONS values)
 *   onApply   – (newValue: string) => void  called when user taps Filter
 */
function SortSheet({ isOpen, onClose, value, onApply }) {
  const [pending, setPending] = useState(value)

  // Sync pending selection whenever the sheet opens
  useEffect(() => {
    if (isOpen) setPending(value)
  }, [isOpen, value])

  return (
    <MenuSheet isOpen={isOpen} onClose={onClose} ariaLabel="Sort options" title="Sort by">
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
              onClick={() => {
                if (opt.value !== pending) hapticImpact('Light')
                setPending(opt.value)
              }}
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
    </MenuSheet>
  )
}

export default SortSheet

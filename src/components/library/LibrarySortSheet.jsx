import React from 'react'
import { Check } from 'lucide-react'
import ActionSheet from '../ActionSheet'
import { LIBRARY_SORTS } from './libraryConstants'

export default function LibrarySortSheet({ isOpen, onClose, sortKey, onSelect }) {
  return (
    <ActionSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Sort By"
      items={LIBRARY_SORTS.map((s) => ({
        label: (
          <span className="lib-sort-item">
            {s.label}
            {sortKey === s.key && <Check size={16} aria-hidden="true" />}
          </span>
        ),
        onClick: () => onSelect(s.key),
      }))}
    />
  )
}

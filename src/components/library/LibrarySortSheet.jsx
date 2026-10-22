import React from 'react'
import { Check } from 'lucide-react'
import ActionSheet from '../ActionSheet'
import { hapticImpact } from '../../utils/haptics'
import { LIBRARY_SORTS, LIBRARY_VIEWS } from './libraryConstants'

export default function LibrarySortSheet({
  isOpen,
  onClose,
  sortKey,
  onSelect,
  viewKey,
  onViewSelect,
}) {
  const sortItems = LIBRARY_SORTS.map((s) => ({
    label: (
      <span className="lib-sort-item">
        {s.label}
        {sortKey === s.key && <Check size={16} aria-hidden="true" />}
      </span>
    ),
    onClick: () => {
      if (sortKey !== s.key) hapticImpact('Light')
      onSelect(s.key)
    },
  }))

  const viewItems =
    viewKey != null && onViewSelect
      ? [
          { divider: true },
          { heading: 'View' },
          ...LIBRARY_VIEWS.map((v) => ({
            label: (
              <span className="lib-sort-item">
                {v.label}
                {viewKey === v.key && <Check size={16} aria-hidden="true" />}
              </span>
            ),
            onClick: () => {
              if (viewKey !== v.key) hapticImpact('Light')
              onViewSelect(v.key)
            },
          })),
        ]
      : []

  return (
    <ActionSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Sort By"
      items={[...sortItems, ...viewItems]}
    />
  )
}

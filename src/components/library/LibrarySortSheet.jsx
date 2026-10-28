import React from 'react'
import MenuSheet from '../MenuSheet'
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
    label: s.label,
    selected: sortKey === s.key,
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
            label: v.label,
            selected: viewKey === v.key,
            onClick: () => {
              if (viewKey !== v.key) hapticImpact('Light')
              onViewSelect(v.key)
            },
          })),
        ]
      : []

  return (
    <MenuSheet
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Sort by"
      title="Sort by"
      items={[...sortItems, ...viewItems]}
    />
  )
}

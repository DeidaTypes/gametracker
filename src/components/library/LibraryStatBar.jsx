import React from 'react'
import { STATUS_CELLS } from './libraryConstants'

export default function LibraryStatBar({ counts, activeStatus, onStatusTap }) {
  return (
    <div className="lib-statbar">
      {STATUS_CELLS.map((cell) => {
        const active = activeStatus === cell.key
        const count = counts[cell.key] ?? 0
        const isEmpty = count === 0
        return (
          <button
            key={cell.key}
            type="button"
            aria-pressed={active}
            className={`lib-statcell lib-statcell--${cell.key}${active ? ' lib-statcell--active' : ''}${isEmpty ? ' lib-statcell--empty' : ''}`}
            onClick={() => onStatusTap(cell.key)}
          >
            <span className="lib-statcell-num">{count}</span>
            <span className="lib-statcell-lbl">{cell.label}</span>
            <span className="lib-statcell-bar" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

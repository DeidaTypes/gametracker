import React from 'react'
import { hapticImpact } from '../utils/haptics'
import './StatusChip.css'

/**
 * StatusChip — the ONE primitive for rendering a tracker status
 * (Backlog / Currently Playing / Played / Dropped) as a chip, tile,
 * or sheet row. Color always comes from the shared --status-* map in
 * src/styles/theme.css, never a hardcoded hex, so the same status reads
 * as the same color everywhere it appears (Library's stat cells, which
 * originated this palette, read from the same tokens directly).
 *
 * STATUS_META.label is the single source of truth for status DISPLAY
 * labels. Sentence-form backlog copy lives in BACKLOG_COPY so grammar
 * stays consistent ("Add to backlog", not "Add to Backlog list").
 *
 * Haptics: a chip that is a button gives one Light tap when it picks a status
 * it is not already on (re-tapping the active one is silent). 'played' is the
 * exception — marking a game Played fires Success when the completion is
 * written (see GameDetail / Home), so the chip stays quiet for it.
 *
 * `variant` controls layout only, not color:
 *   - 'pill' (default) — inline text pill, e.g. Home's byline status pill
 *   - 'tile'            — icon-over-label square, e.g. GameDetail's status grid
 *   - 'row'             — full-width icon+label(+trailing) row, e.g.
 *                         AddToListButton's bottom-sheet status list
 */
export const STATUS_META = {
  want: { label: 'Backlog', colorVar: '--status-want-to-play' },
  currently: { label: 'Currently Playing', colorVar: '--status-currently-playing' },
  played: { label: 'Played', colorVar: '--status-played' },
  dropped: { label: 'Dropped', colorVar: '--status-dropped' },
}

export const STATUS_KEYS = Object.keys(STATUS_META)

export function statusLabel(status) {
  return STATUS_META[status]?.label ?? ''
}

const LIST_ID_TO_STATUS = {
  'want-to-play': 'want',
  'currently-playing': 'currently',
  played: 'played',
  dropped: 'dropped',
}

export function statusLabelForListId(listId) {
  return statusLabel(LIST_ID_TO_STATUS[listId])
}

/** Sentence-form copy for the backlog status. Standalone label is STATUS_META.want.label. */
export const BACKLOG_COPY = {
  add: 'Add to backlog',
  added: 'Added to backlog',
  remove: 'Remove from backlog',
  verb: 'backlogged',
}

function StatusChip({
  status,
  label,
  icon,
  trailing,
  active = false,
  variant = 'pill',
  as,
  className = '',
  style,
  onClick,
  ...rest
}) {
  const meta = STATUS_META[status]
  if (!meta) return null

  const Component = as || (onClick ? 'button' : 'span')
  const handleClick = onClick
    ? (event) => {
        if (!active && status !== 'played') hapticImpact('Light')
        onClick(event)
      }
    : undefined
  const text = label ?? meta.label
  const classes = [
    'status-chip',
    `status-chip--${variant}`,
    `status-chip--${status}`,
    active ? 'status-chip--active' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <Component
      className={classes}
      style={{ '--chip-color': `var(${meta.colorVar})`, ...style }}
      onClick={handleClick}
      {...rest}
    >
      {icon && <span className="status-chip__icon">{icon}</span>}
      <span className="status-chip__label">{text}</span>
      {trailing && <span className="status-chip__trailing">{trailing}</span>}
    </Component>
  )
}

export default StatusChip

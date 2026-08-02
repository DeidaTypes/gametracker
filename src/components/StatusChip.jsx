import React from 'react'
import './StatusChip.css'

/**
 * StatusChip — the ONE primitive for rendering a tracker status
 * (Want to Play / Currently Playing / Played / Dropped) as a chip, tile,
 * or sheet row. Color always comes from the shared --status-* map in
 * src/styles/theme.css, never a hardcoded hex, so the same status reads
 * as the same color everywhere it appears (Library's stat cells, which
 * originated this palette, read from the same tokens directly).
 *
 * `variant` controls layout only, not color:
 *   - 'pill' (default) — inline text pill, e.g. Home's byline status pill
 *   - 'tile'            — icon-over-label square, e.g. GameDetail's status grid
 *   - 'row'             — full-width icon+label(+trailing) row, e.g.
 *                         AddToListButton's bottom-sheet status list
 */
export const STATUS_META = {
  want: { label: 'Want to Play', colorVar: '--status-want-to-play' },
  currently: { label: 'Currently Playing', colorVar: '--status-currently-playing' },
  played: { label: 'Played', colorVar: '--status-played' },
  dropped: { label: 'Dropped', colorVar: '--status-dropped' },
}

export const STATUS_KEYS = Object.keys(STATUS_META)

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
  ...rest
}) {
  const meta = STATUS_META[status]
  if (!meta) return null

  const Component = as || (rest.onClick ? 'button' : 'span')
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
      {...rest}
    >
      {icon && <span className="status-chip__icon">{icon}</span>}
      <span className="status-chip__label">{text}</span>
      {trailing && <span className="status-chip__trailing">{trailing}</span>}
    </Component>
  )
}

export default StatusChip

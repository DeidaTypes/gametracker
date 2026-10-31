import React from 'react'
import './BadgeMedallion.css'

const LEVEL_LABELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard' }

export function BadgePips({ level, size = 6 }) {
  const label = LEVEL_LABELS[level] || 'Easy'
  return (
    <span className="badge-pips" aria-label={label}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`badge-pips__dot${i <= level ? ' badge-pips__dot--on' : ''}`}
          style={{ width: size, height: size }}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}

export function badgeLevelLabel(level) {
  return LEVEL_LABELS[level] || 'Easy'
}

/**
 * Accent medallion for kind === 'single' badges. Tiered badges keep their rings.
 */
export default function BadgeMedallion({
  badge,
  earned,
  progress = null,
  size = 64,
}) {
  const Icon = badge.icon
  const iconSize = Math.round(size * 0.43)
  const level = badge.level ?? 1
  const accent = badge.accent || 'app'

  const classNames = [
    'badge-medallion',
    `badge-medallion--${accent}`,
    level === 3 ? 'badge-medallion--hard' : '',
    !earned ? 'badge-medallion--locked' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const showRing = !earned && progress != null && progress > 0
  const ringOuter = size + 6
  const r = ringOuter / 2 - 2
  const circumference = 2 * Math.PI * r
  const dashOffset = circumference * (1 - Math.max(0, Math.min(1, progress)))

  return (
    <span
      className={classNames}
      style={{ '--bm-size': `${size}px` }}
      aria-hidden="true"
    >
      <Icon size={iconSize} strokeWidth={1.8} />
      {showRing && (
        <svg
          className="badge-medallion__ring"
          width={ringOuter}
          height={ringOuter}
          viewBox={`0 0 ${ringOuter} ${ringOuter}`}
          aria-hidden="true"
        >
          <circle
            cx={ringOuter / 2}
            cy={ringOuter / 2}
            r={r}
            fill="none"
            stroke="var(--text-secondary)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
      )}
    </span>
  )
}

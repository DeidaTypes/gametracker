import React from 'react'

const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond']
const STOP_OFFSETS = [0, 0.28, 0.55, 0.78, 1]

/**
 * Hidden SVG gradient defs for level tier rings. Mount once at the app root
 * so url(#cp-ring-*) references resolve everywhere (WebKit needs visibility,
 * not display:none).
 */
export default function LevelRingDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
      }}
    >
      <defs>
        {TIERS.map((tier) => (
          <linearGradient
            key={tier}
            id={`cp-ring-${tier}`}
            x1="0.1"
            y1="0"
            x2="0.9"
            y2="1"
          >
            {[1, 2, 3, 4, 5].map((n, i) => (
              <stop
                key={n}
                offset={STOP_OFFSETS[i]}
                style={{ stopColor: `var(--ring-${tier}-${n})` }}
              />
            ))}
          </linearGradient>
        ))}
      </defs>
    </svg>
  )
}

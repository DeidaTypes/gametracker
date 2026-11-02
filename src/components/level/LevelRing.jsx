import React, { useMemo } from 'react'
import { tierFor } from '../../data/levels'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import './LevelRing.css'

function ringGeometry(photoSize) {
  let stroke
  let gap
  if (photoSize >= 64) {
    stroke = 3
    gap = 3
  } else if (photoSize >= 56) {
    stroke = 2.5
    gap = 2.5
  } else if (photoSize >= 40) {
    stroke = 2
    gap = 2
  } else if (photoSize >= 32) {
    stroke = 2
    gap = 1.5
  } else {
    stroke = 1.5
    gap = 1
  }
  const edgeExtra = photoSize < 40 ? 1 : 1.5
  const edgeStroke = stroke + edgeExtra
  const r = photoSize / 2 + gap + stroke / 2
  const size = 2 * (r + edgeStroke / 2)
  return { size, stroke, edgeStroke, r, cx: size / 2, cy: size / 2 }
}

/**
 * Tier progress ring drawn outside a profile photo. Absolutely centered;
 * does not affect layout.
 *
 * @param {{ level: number, photoSize: number, progress?: number|null, glint?: boolean }} props
 * progress null = full circle (butt cap). A number 0–1 = partial arc (round cap).
 */
export default function LevelRing({
  level,
  photoSize,
  progress = null,
  glint = false,
}) {
  const { reduced } = useMotionPreference()
  const tier = tierFor(level)
  const gradId = `cp-ring-${tier.key}`
  const geom = useMemo(() => ringGeometry(photoSize), [photoSize])
  const { size, stroke, edgeStroke, r, cx, cy } = geom
  const circ = 2 * Math.PI * r

  const hasNumericProgress = typeof progress === 'number' && !Number.isNaN(progress)
  const pct = hasNumericProgress
    ? Math.min(1, Math.max(0, progress))
    : 1
  const fullButt = !hasNumericProgress
  const isComplete = hasNumericProgress && pct >= 1 - 1e-6
  const lineCap = fullButt ? 'butt' : 'round'
  const dash = isComplete ? circ : circ * pct
  const arcOffset = circ - dash
  const shouldDraw =
    hasNumericProgress && !reduced && !isComplete && pct > 0

  const showGlow = tier.key === 'platinum' || tier.key === 'diamond'
  const showGlint = glint && tier.key === 'diamond' && !reduced

  return (
    <span
      className="level-photo-ring"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {showGlow && (
        <span
          className={`level-photo-ring__glow level-photo-ring__glow--${tier.key}`}
          style={{ width: size, height: size }}
        />
      )}
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--ring-edge)"
          strokeWidth={edgeStroke}
        />
        {hasNumericProgress && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={stroke}
            style={{ strokeOpacity: 'var(--ring-track-opacity)' }}
          />
        )}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={stroke}
          strokeLinecap={lineCap}
          transform={`rotate(-90 ${cx} ${cy})`}
          className={
            shouldDraw
              ? 'level-photo-ring__arc level-photo-ring__arc--draw'
              : 'level-photo-ring__arc'
          }
          style={
            shouldDraw
              ? {
                  '--ring-circ': `${circ}`,
                  '--ring-offset': `${arcOffset}`,
                  strokeDasharray: `${circ} ${circ}`,
                }
              : {
                  strokeDasharray: fullButt || isComplete
                    ? `${circ} ${circ}`
                    : `${dash} ${circ - dash}`,
                  strokeDashoffset: fullButt || isComplete ? 0 : 0,
                }
          }
        />
        {showGlint && (
          <circle
            className="level-photo-ring__glint"
            cx={cx}
            cy={cy - r}
            r={0.8}
            fill="white"
          />
        )}
      </svg>
    </span>
  )
}

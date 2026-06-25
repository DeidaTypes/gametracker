import React, { useEffect, useRef, useState } from 'react'
import { Flame } from 'lucide-react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import './EmberRing.css'

/**
 * EmberRing — streak visualisation ring.
 *
 * A 52×52 circular badge (same footprint as GoalRing compact) whose
 * outer SVG arc fills and glows in proportion to the current streak.
 *
 * Intensity tiers:
 *   0        — no fill, ring is invisible
 *   1–3      — dim ember  (arc ≤ 10%)
 *   4–6      — low flame  (arc ≤ 20%)
 *   7–13     — warm glow  (arc ≤ 43%)
 *   14–29    — hot burn   (arc ≤ 97%)
 *   30+      — full blaze (arc 100%, pulsing glow)
 *
 * Tick-over: when streak increments during the session a brief radial
 * burst plays. `prefers-reduced-motion` / data-reduce-motion collapses
 * this to an instant intensity jump with no animation.
 *
 * Props:
 *   streak  {number}  current consecutive-day streak
 */

const SIZE   = 52
const STROKE = 5
const R      = (SIZE - STROKE) / 2        // 23.5
const CIRC   = 2 * Math.PI * R            // ≈ 147.65
const CX     = SIZE / 2
const CY     = SIZE / 2

/** Map a streak count to the 0-1 arc fill fraction. */
function fillFraction(streak) {
  if (!streak || streak <= 0) return 0
  return Math.min(streak / 30, 1)
}

/**
 * Intensity tier 0–4 used for glow CSS class.
 * Higher = more drop-shadow / opacity.
 */
function intensityLevel(streak) {
  if (!streak || streak <= 0) return 0
  if (streak <= 3)  return 1
  if (streak <= 6)  return 2
  if (streak <= 13) return 3
  if (streak <= 29) return 4
  return 5
}

export default function EmberRing({ streak = 0 }) {
  const { reduced } = useMotionPreference()
  const [celebrating, setCelebrating] = useState(false)
  const prevRef = useRef(null)

  // Detect streak tick-over (streak went up within this session).
  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = streak

    if (prev !== null && prev > 0 && streak > prev) {
      setCelebrating(true)
      if (!reduced) {
        const t = setTimeout(() => setCelebrating(false), 700)
        return () => clearTimeout(t)
      }
      // Reduced-motion: instant — clear on next frame
      const raf = requestAnimationFrame(() => setCelebrating(false))
      return () => cancelAnimationFrame(raf)
    }
  }, [streak, reduced])

  const fraction = fillFraction(streak)
  const dash     = CIRC * fraction
  const gap      = CIRC - dash
  const level    = intensityLevel(streak)

  const classes = [
    'ember-ring',
    level > 0  ? `ember-ring--l${level}` : '',
    celebrating ? 'ember-ring--celebrating' : '',
    reduced     ? 'ember-ring--reduced'    : '',
  ].filter(Boolean).join(' ')

  if (streak === 0) {
    return (
      <div
        className="ember-ring ember-ring--empty"
        aria-label="No active streak"
      >
        <Flame className="ember-ring__icon ember-ring__icon--dim" size={16} aria-hidden="true" />
      </div>
    )
  }

  return (
    <div
      className={classes}
      role="img"
      aria-label={`${streak}-day streak`}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
        className="ember-ring__svg"
      >
        {/* Track ring */}
        <circle
          className="ember-ring__track"
          cx={CX} cy={CY} r={R}
          strokeWidth={STROKE}
          fill="none"
        />
        {/* Ember arc — starts at top (–90°) */}
        {fraction > 0 && (
          <circle
            className="ember-ring__fill"
            cx={CX} cy={CY} r={R}
            strokeWidth={STROKE}
            fill="none"
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset="0"
            transform={`rotate(-90 ${CX} ${CY})`}
            strokeLinecap="round"
          />
        )}
      </svg>

      {/* Inner label: flame + count */}
      <div className="ember-ring__label" aria-hidden="true">
        <Flame className="ember-ring__icon" size={12} />
        <span className="ember-ring__count">{streak}</span>
      </div>
    </div>
  )
}

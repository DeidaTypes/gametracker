import React from 'react'
import './PulseDot.css'

/**
 * PulseDot — the live indicator primitive for Pulse.
 *
 * A small dot with a single concentric ring that pulses outward when
 * `live` is true. This is the ONE signature/playful moment Pulse owns:
 * everywhere else stays quiet. Used by later UI features (presence
 * row, "playing now" inline indicator, etc.) — never style this dot
 * differently per call site. Extend with props if you need a variant.
 *
 * Color tokens come from theme.css cobalt modern set; no hard-coded
 * hex anywhere. The dot itself is the accent color; the ring inherits
 * the same color with reduced alpha.
 *
 * Motion:
 *   - The ring expands + fades over 1600ms on an infinite loop. This
 *     is an ambient indicator, not a UI transition, so the standard
 *     ≤250ms transition budget does not apply.
 *   - `prefers-reduced-motion: reduce` AND the in-app reduce-motion
 *     setting (body[data-reduce-motion='true']) both collapse the
 *     animation to a static dot — see PulseDot.css. No jank, no jiggle.
 *
 * Accessibility:
 *   - Decorative by default (aria-hidden). Pass `label` to expose a
 *     screen-reader-only string for cases where the dot is the only
 *     signal of state (e.g. standalone "live" badge).
 *
 * @param {{
 *   live?: boolean,                  // pulse vs static
 *   size?: 'sm'|'md'|'lg',           // 6 / 8 / 10 px dot
 *   label?: string,                  // aria-label, if non-decorative
 *   className?: string,
 * }} props
 */
export default function PulseDot({
  live = true,
  size = 'md',
  label,
  className = '',
}) {
  const classes = [
    'pulse-dot',
    `pulse-dot--${size}`,
    live ? 'pulse-dot--live' : 'pulse-dot--idle',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const a11y = label
    ? { role: 'status', 'aria-label': label }
    : { 'aria-hidden': true }

  return (
    <span className={classes} {...a11y}>
      {live && <span className="pulse-dot__ring" aria-hidden="true" />}
      <span className="pulse-dot__core" aria-hidden="true" />
    </span>
  )
}

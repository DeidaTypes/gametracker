import React, { useId } from 'react'
import './GoalRing.css'

/* Tier color cycle — three accent tokens, no orange/amber. Tier 1 green,
 * tier 2 cobalt, tier 3 purple, tier 4 back to green, etc. Every 5th
 * ("prestige") tier swaps the solid color for a tri-hue gradient ring
 * instead — see `isPrestigeTier` below. */
const TIER_COLOR_VARS = ['var(--accent-review)', 'var(--accent)', 'var(--accent-journal)']

function tierColorVar(tier) {
  const idx = ((tier - 1) % TIER_COLOR_VARS.length + TIER_COLOR_VARS.length) % TIER_COLOR_VARS.length
  return TIER_COLOR_VARS[idx]
}

function isPrestigeTier(tier) {
  return Number.isFinite(tier) && tier > 0 && tier % 5 === 0
}

/**
 * GoalRing — SVG circular progress ring for the yearly game challenge.
 *
 * Props:
 *   current   {number}  — games finished so far (within the current tier)
 *   target    {number}  — goal target (current tier's target)
 *   year      {number}  — calendar year
 *   tier      {number}  — escalating-challenge tier (1-based). Cycles the
 *                          ring's color through the accent tokens; every
 *                          5th tier renders a tri-hue "prestige" gradient
 *                          instead of a solid color.
 *   variant   {'compact'|'full'}  — compact for TodayCard, full for Profile
 *   onSet     {Function}  — called when the "Set a goal" prompt is tapped
 *   className {string}   — optional extra class
 *
 * When target is null/undefined the ring shows a subtle "Set a {year} goal"
 * prompt — never a fabricated number.
 *
 * Reaching the target always renders green (`--accent-review`) regardless
 * of the tier's own color — green is this app's one universal "goal
 * reached" signal, never amber/orange.
 */
export default function GoalRing({
  current = 0,
  target = null,
  year = new Date().getFullYear(),
  tier = 1,
  variant = 'compact',
  onSet,
  className = '',
}) {
  const isFull = variant === 'full'
  const size   = isFull ? 100 : 52
  const stroke = isFull ? 8 : 5
  const r      = (size - stroke) / 2
  const circ   = 2 * Math.PI * r
  const cx     = size / 2
  const cy     = size / 2
  const gradientId = `${useId()}goal-ring-gradient`

  const hasGoal = target != null && target > 0
  const pct     = hasGoal ? Math.min(1, current / target) : 0
  const dash    = circ * pct
  const gap     = circ - dash

  // 100% reached — the current tier's "Goal reached!" celebration.
  const complete = hasGoal && current >= target
  const prestige = isPrestigeTier(tier)
  const fillStroke = complete
    ? 'var(--accent-review)'
    : prestige
      ? `url(#${gradientId})`
      : tierColorVar(tier)

  if (!hasGoal) {
    return (
      <button
        type="button"
        className={`goal-ring goal-ring--no-goal goal-ring--${variant} ${className}`.trim()}
        onClick={onSet}
        aria-label={`Set a ${year} games goal`}
      >
        {isFull ? (
          <>
            <svg
              width={size}
              height={size}
              viewBox={`0 0 ${size} ${size}`}
              aria-hidden="true"
              className="goal-ring__svg"
            >
              <circle
                className="goal-ring__track"
                cx={cx} cy={cy} r={r}
                strokeWidth={stroke}
                fill="none"
              />
            </svg>
            <span className="goal-ring__set-prompt">Set a {year} goal</span>
          </>
        ) : (
          <span className="goal-ring__set-prompt-compact">+</span>
        )}
      </button>
    )
  }

  return (
    <div
      className={`goal-ring goal-ring--${variant}${complete ? ' goal-ring--complete' : ''} ${className}`.trim()}
      role="img"
      aria-label={`${year} challenge: ${current} of ${target} games`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        className="goal-ring__svg"
      >
        {/* Tri-hue "prestige" gradient — every 5th tier, cobalt + green +
            purple in one ring, never rendered while celebrating (green
            always wins on completion). */}
        {prestige && !complete && (
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style={{ stopColor: 'var(--accent-review)' }} />
              <stop offset="50%" style={{ stopColor: 'var(--accent)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--accent-journal)' }} />
            </linearGradient>
          </defs>
        )}
        {/* Track */}
        <circle
          className="goal-ring__track"
          cx={cx} cy={cy} r={r}
          strokeWidth={stroke}
          fill="none"
        />
        {/* Progress arc — starts at top (–90°) */}
        <circle
          className={`goal-ring__fill${complete ? ' goal-ring__fill--complete' : ''}`}
          cx={cx} cy={cy} r={r}
          strokeWidth={stroke}
          fill="none"
          style={{ stroke: fillStroke }}
          strokeDasharray={`${dash} ${gap}`}
          strokeDashoffset="0"
          transform={`rotate(-90 ${cx} ${cy})`}
          strokeLinecap="round"
        />
      </svg>

      {/* Label */}
      {isFull ? (
        <div className="goal-ring__label-full">
          <span className="goal-ring__count">
            {current}<span className="goal-ring__sep">/</span>{target}
          </span>
          <span className="goal-ring__sub">{year} games</span>
        </div>
      ) : (
        <div className="goal-ring__label-compact">
          <span className="goal-ring__count-compact">{current}</span>
          <span className="goal-ring__target-compact">/{target}</span>
        </div>
      )}
    </div>
  )
}

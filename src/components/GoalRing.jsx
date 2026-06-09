import React from 'react'
import './GoalRing.css'

/**
 * GoalRing — SVG circular progress ring for the yearly game challenge.
 *
 * Props:
 *   current   {number}  — games finished so far
 *   target    {number}  — goal target
 *   year      {number}  — calendar year
 *   variant   {'compact'|'full'}  — compact for TodayCard, full for Profile
 *   onSet     {Function}  — called when the "Set a goal" prompt is tapped
 *   className {string}   — optional extra class
 *
 * When target is null/undefined the ring shows a subtle "Set a {year} goal"
 * prompt — never a fabricated number.
 */
export default function GoalRing({
  current = 0,
  target = null,
  year = new Date().getFullYear(),
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

  const hasGoal = target != null && target > 0
  const pct     = hasGoal ? Math.min(1, current / target) : 0
  const dash    = circ * pct
  const gap     = circ - dash

  // 100% reached
  const complete = hasGoal && current >= target

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

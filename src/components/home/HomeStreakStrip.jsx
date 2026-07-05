import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Flame, ChevronRight } from 'lucide-react'
import './HomeStreakStrip.css'

/**
 * HomeStreakStrip — compact single-row streak surface for Home.
 *
 * Feed-first spine (v3): replaces the old full TodayCard block. Renders
 * ONLY when the streak is real (current > 0) — a 0-day streak next to an
 * empty 7-day grid reads as a scoreboard the user is losing, not useful
 * information, so the strip stays hidden until there's something to show.
 *
 * Layout: flame + "N-day streak" (left) · 7 day-pips for the current
 * week (middle) · "Calendar ›" link (right). No "+GAMES" ring here — the
 * yearly-goal ring lives on Profile.
 *
 * Props:
 *   streak     {number}  current consecutive-day streak
 *   weekCells  {Array<{ key, dayLabel, active, isToday }>}  7 items,
 *              oldest → today (see useTodayData's buildWeekCells).
 */
function HomeStreakStrip({ streak = 0, weekCells = [] }) {
  const navigate = useNavigate()

  if (!streak || streak <= 0) return null

  return (
    <div className="streak-strip">
      <div className="streak-strip__flame" aria-hidden="true">
        <Flame size={15} />
      </div>
      <span className="streak-strip__label">{streak}-day streak</span>

      <div className="streak-strip__pips" role="group" aria-label="Last 7 days of activity">
        {weekCells.map((cell) => (
          <span
            key={cell.key}
            className={[
              'streak-strip__pip',
              cell.active ? 'streak-strip__pip--active' : '',
              cell.isToday ? 'streak-strip__pip--today' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-hidden="true"
          />
        ))}
      </div>

      <button
        type="button"
        className="streak-strip__calendar-link"
        onClick={() => navigate('/activity')}
        aria-label="View full activity calendar"
      >
        Calendar <ChevronRight size={12} aria-hidden="true" />
      </button>
    </div>
  )
}

export default HomeStreakStrip

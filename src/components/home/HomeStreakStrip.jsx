import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Flame, ChevronRight } from 'lucide-react'
import './HomeStreakStrip.css'

/**
 * HomeStreakStrip — compact single-row streak surface for Home.
 *
 * Feed-first spine (v3): replaces the old full TodayCard block. Always
 * renders for any user with account history (the parent hides it only for
 * the true new-user empty state) — including at a 0-day streak, where it
 * falls back to a neutral zero-state instead of a guilt-trippy "0 of 7"
 * grid.
 *
 * Layout: flame + label (left) · 7 day-pips for the current week (middle)
 * · "Calendar ›" link (right). No "+GAMES" ring here — the yearly-goal
 * ring lives on Profile.
 *
 * States:
 *   streak > 0  → purple flame + "N-day streak", filled pips for logged
 *                 days, today ringed cobalt.
 *   streak = 0  → muted flame + "Start a streak", all 7 pips empty
 *                 (logged-day fills are intentionally suppressed here —
 *                 this is a forward-looking prompt, not a progress
 *                 readout), today still ringed cobalt.
 *
 * Props:
 *   streak     {number}  current consecutive-day streak
 *   weekCells  {Array<{ key, dayLabel, active, isToday }>}  7 items,
 *              oldest → today (see useTodayData's buildWeekCells).
 */
function HomeStreakStrip({ streak = 0, weekCells = [] }) {
  const navigate = useNavigate()
  const isZero = !streak || streak <= 0

  return (
    <div className={['streak-strip', isZero ? 'streak-strip--zero' : ''].filter(Boolean).join(' ')}>
      <div className="streak-strip__flame" aria-hidden="true">
        <Flame size={15} />
      </div>
      <span className="streak-strip__label">
        {isZero ? 'Start a streak' : `${streak}-day streak`}
      </span>

      <div className="streak-strip__pips" role="group" aria-label="Last 7 days of activity">
        {weekCells.map((cell) => (
          <span
            key={cell.key}
            className={[
              'streak-strip__pip',
              !isZero && cell.active ? 'streak-strip__pip--active' : '',
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

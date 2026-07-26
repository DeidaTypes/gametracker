import React from 'react'
import { Calendar, Gamepad2 } from 'lucide-react'
import './HomeWeekCard.css'

function formatTotalHours(hours) {
  if (!hours || hours <= 0) return '0h'
  const rounded = Math.round(hours * 10) / 10
  return rounded % 1 === 0 ? `${rounded}h` : `${rounded.toFixed(1)}h`
}

/**
 * HomeWeekCard — "This week" rhythm card, replacing the old daily streak
 * strip. Shows real session count + total hours logged in the current
 * calendar week (Sun–Sat, see useWeekData). Tapping the card body opens the
 * week-detail view; the "Calendar" link is the kept entry point into the
 * full /activity calendar screen.
 *
 * A zero-session week is a neutral state ("No sessions yet this week"), not
 * a broken/guilt-trippy one — matches the streak strip's zero-state stance.
 *
 * Props:
 *   sessionCount {number}
 *   totalHours   {number}
 *   loading      {boolean}
 *   onOpenDetail {() => void}
 *   onOpenCalendar {() => void}
 */
function HomeWeekCard({ sessionCount = 0, totalHours = 0, loading = false, onOpenDetail, onOpenCalendar }) {
  const isEmpty = !loading && sessionCount === 0

  return (
    <div className="hwc-card">
      <div className="hwc-header">
        <div className="hwc-icon" aria-hidden="true">
          <Gamepad2 size={14} />
        </div>
        <span className="hwc-title">This week</span>
        <button
          type="button"
          className="hwc-calendar-link"
          onClick={(e) => {
            e.stopPropagation()
            onOpenCalendar?.()
          }}
          aria-label="View full activity calendar"
        >
          <Calendar size={13} aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        className="hwc-body"
        onClick={onOpenDetail}
        aria-label={
          isEmpty
            ? 'This week: no sessions yet — view week detail'
            : `This week: ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}, ${formatTotalHours(totalHours)} logged — view week detail`
        }
      >
        {loading ? (
          <div className="hwc-skeleton" aria-hidden="true">
            <span className="skeleton hwc-skeleton-line" />
            <span className="skeleton hwc-skeleton-line hwc-skeleton-line--short" />
          </div>
        ) : isEmpty ? (
          <span className="hwc-empty-text">No sessions yet this week</span>
        ) : (
          <>
            <span className="hwc-stat-primary">
              {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}
            </span>
            <span className="hwc-stat-secondary">{formatTotalHours(totalHours)} logged</span>
          </>
        )}
      </button>
    </div>
  )
}

export default HomeWeekCard

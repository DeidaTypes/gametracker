import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { LuChevronLeft, LuChevronRight } from 'react-icons/lu'
import { useAuth } from '../contexts/AuthContext'
import {
  getCachedActivityCalendar,
  computeStreaks,
  toLocalDateKey,
  invalidateActivityCache,
} from '../services/statsService'
import './ActivityCalendar.css'

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Build a flat array of cells for a given year/month.
 * Leading empty cells (null) pad to the first day-of-week.
 * Each real cell: { date: Date, day: number, key: 'YYYY-MM-DD' }
 */
function buildMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const startDow = firstDay.getDay()

  const cells = []
  for (let i = 0; i < startDow; i++) {
    cells.push(null)
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d)
    cells.push({ date, day: d, key: toLocalDateKey(date) })
  }
  return cells
}

export default function ActivityCalendar() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const [viewYear, setViewYear] = useState(() => today.getFullYear())
  const [viewMonth, setViewMonth] = useState(() => today.getMonth())
  const [dateCounts, setDateCounts] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchData = useCallback(async () => {
    if (!user?.id) {
      setDateCounts(new Map())
      setIsLoading(false)
      return
    }
    try {
      // 400 days back covers >13 months for prev/next navigation
      const counts = await getCachedActivityCalendar(user.id, 400)
      setDateCounts(counts)
    } catch (err) {
      console.error('[ActivityCalendar] fetch failed:', err)
      setDateCounts(new Map())
    } finally {
      setIsLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    setIsLoading(true)
    fetchData()
  }, [fetchData])

  useEffect(() => {
    function onActivityChange() {
      invalidateActivityCache()
      setIsLoading(true)
      fetchData()
    }
    window.addEventListener('activityUpdated', onActivityChange)
    window.addEventListener('reviewAdded', onActivityChange)
    window.addEventListener('libraryUpdated', onActivityChange)
    return () => {
      window.removeEventListener('activityUpdated', onActivityChange)
      window.removeEventListener('reviewAdded', onActivityChange)
      window.removeEventListener('libraryUpdated', onActivityChange)
    }
  }, [fetchData])

  const cells = useMemo(
    () => buildMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth]
  )

  const streak = useMemo(
    () => (dateCounts ? computeStreaks(dateCounts) : { current: 0, longest: 0 }),
    [dateCounts]
  )

  const totalDaysLogged = useMemo(
    () => (dateCounts ? dateCounts.size : 0),
    [dateCounts]
  )

  const hasActivity = totalDaysLogged > 0
  const todayKey = useMemo(() => toLocalDateKey(today), [today])

  const canGoNext =
    viewYear < today.getFullYear() ||
    (viewYear === today.getFullYear() && viewMonth < today.getMonth())

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1)
      setViewMonth(11)
    } else {
      setViewMonth((m) => m - 1)
    }
  }

  function nextMonth() {
    if (!canGoNext) return
    if (viewMonth === 11) {
      setViewYear((y) => y + 1)
      setViewMonth(0)
    } else {
      setViewMonth((m) => m + 1)
    }
  }

  return (
    <div className="ac-page">
      {/* Header — back chevron only, matching the comments screen pattern */}
      <header className="ac-header">
        <button
          className="ac-back"
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>

        <div className="ac-month-nav" aria-live="polite" aria-atomic="true">
          <button
            className="ac-month-btn"
            type="button"
            onClick={prevMonth}
            aria-label="Previous month"
          >
            <LuChevronLeft size={18} aria-hidden="true" />
          </button>
          <span className="ac-month-label">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </span>
          <button
            className="ac-month-btn"
            type="button"
            onClick={nextMonth}
            disabled={!canGoNext}
            aria-label="Next month"
          >
            <LuChevronRight size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Spacer keeps the month-nav centred in the 3-column header grid */}
        <span className="ac-header__spacer" aria-hidden="true" />
      </header>

      <div className="ac-body">
        {isLoading ? (
          <div className="ac-skeleton-wrap" aria-busy="true" aria-label="Loading activity calendar">
            <div className="skeleton ac-skel-summary" />
            <div className="skeleton ac-skel-grid" />
          </div>
        ) : !hasActivity ? (
          <div className="ac-empty" role="status">
            <div className="ac-empty-icon" aria-hidden="true">📅</div>
            <p className="ac-empty-title">No activity logged yet</p>
            <p className="ac-empty-body">
              Log a game to start your calendar.
            </p>
          </div>
        ) : (
          <>
            {/* Summary — streak + total days, from the same activity dates */}
            <div className="ac-summary" aria-label="Activity summary">
              {streak.current > 0 && (
                <div className="ac-stat">
                  <span className="ac-stat-value">{streak.current}</span>
                  <span className="ac-stat-label">day streak</span>
                </div>
              )}
              <div className="ac-stat">
                <span className="ac-stat-value">{totalDaysLogged}</span>
                <span className="ac-stat-label">days logged</span>
              </div>
            </div>

            {/* Month grid */}
            <div
              className="ac-grid-wrap"
              role="grid"
              aria-label={`${MONTH_NAMES[viewMonth]} ${viewYear} activity calendar`}
            >
              {/* Weekday header row */}
              <div className="ac-weekday-row" role="row" aria-hidden="true">
                {WEEKDAY_LABELS.map((d, i) => (
                  <div key={i} className="ac-weekday-cell">{d}</div>
                ))}
              </div>

              {/* Day cells */}
              <div className="ac-days-grid" role="rowgroup">
                {cells.map((cell, i) => {
                  if (!cell) {
                    return (
                      <div
                        key={`pad-${i}`}
                        className="ac-day-cell ac-day-cell--outside"
                        aria-hidden="true"
                      />
                    )
                  }

                  const isActive = (dateCounts?.get(cell.key) ?? 0) > 0
                  const isToday = cell.key === todayKey
                  const isFuture = cell.date > today

                  return (
                    <div
                      key={cell.key}
                      className={[
                        'ac-day-cell',
                        isActive ? 'ac-day-cell--active' : '',
                        isToday ? 'ac-day-cell--today' : '',
                        isFuture ? 'ac-day-cell--future' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      role="gridcell"
                      aria-label={`${cell.key}${isActive ? ', active' : ''}${isToday ? ', today' : ''}`}
                      aria-current={isToday ? 'date' : undefined}
                    >
                      <span className="ac-day-num">{cell.day}</span>
                      {/* TODO: tap to see that day's entries (future item) */}
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getSessionsForWeek } from '../services/sessionService'
import { getLocalWeekBounds, buildCalendarWeekCells } from '../services/statsService'
import { APP_RESUMED_EVENT } from './useAppResume'

/**
 * useWeekData — real session data for Home's "This week" card + week-detail
 * view (replaces the old daily streak strip; see HomeWeekRow).
 *
 * "This week" is a fixed local Sun–Sat calendar window (getLocalWeekBounds),
 * not a rolling 7-day lookback — a deep multi-week playthrough should read
 * as a strong week when the sessions land, not get spread thin across a
 * moving window.
 *
 * Returns:
 *   sessions      — Array of this week's completed play_sessions rows
 *                    (newest first), each { id, igdbGameId, gameTitle,
 *                    gameImage, hours, note, startedAt, playedOn }.
 *   sessionCount  — sessions.length
 *   totalHours    — sum of sessions[].hours
 *   dayCells      — 7 cells (Sun→Sat), reusing the same local-date-key +
 *                   "active if ≥1 logged" logic as the streak strip's day
 *                   dots (see buildCalendarWeekCells).
 *   weekStart     — Date, local midnight Sunday anchoring this week.
 *   weekEnd       — Date, exclusive upper bound (weekStart + 7 days).
 *   loading       — true while the async fetch is in flight.
 *   isEmpty       — true once loaded and there are zero sessions — render a
 *                   neutral empty state, never fabricated rows.
 */
export function useWeekData() {
  const { user } = useAuth()

  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const { start: weekStart, end: weekEnd } = getLocalWeekBounds()

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setSessions([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const { start, end } = getLocalWeekBounds()
      const rows = await getSessionsForWeek(user.id, start.toISOString(), end.toISOString())
      setSessions(rows)
    } catch (err) {
      console.error('[useWeekData] fetch failed:', err)
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  useEffect(() => {
    function onChange() { refresh() }
    window.addEventListener('libraryUpdated', onChange)
    window.addEventListener('activityUpdated', onChange)
    window.addEventListener(APP_RESUMED_EVENT, onChange)
    return () => {
      window.removeEventListener('libraryUpdated', onChange)
      window.removeEventListener('activityUpdated', onChange)
      window.removeEventListener(APP_RESUMED_EVENT, onChange)
    }
  }, [refresh])

  const sessionCount = sessions.length
  const totalHours = sessions.reduce((sum, s) => sum + (s.hours || 0), 0)
  const activeDateKeys = new Set(sessions.map((s) => s.playedOn).filter(Boolean))
  const dayCells = buildCalendarWeekCells(weekStart, activeDateKeys)

  return {
    sessions,
    sessionCount,
    totalHours,
    dayCells,
    weekStart,
    weekEnd,
    loading,
    isEmpty: !loading && sessionCount === 0,
  }
}

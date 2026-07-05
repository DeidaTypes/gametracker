import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getCachedActivityCalendar, computeStreaks, toLocalDateKey, invalidateActivityCache } from '../services/statsService'
import { APP_RESUMED_EVENT } from './useAppResume'

/**
 * Build the rolling 7-day week array.
 *
 * Returns an array of 7 objects ordered oldest (index 0) → today (index 6).
 * Each object:
 *   { key: 'YYYY-MM-DD', dayLabel: 'M', active: boolean, isToday: boolean }
 *
 * "active" = the user logged ≥1 activity on that local-calendar day.
 */
function buildWeekCells(dateCounts) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const SHORT_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const cells = []

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key = toLocalDateKey(d)
    cells.push({
      key,
      dayLabel: SHORT_DAYS[d.getDay()],
      active: (dateCounts?.get(key) ?? 0) > 0,
      isToday: i === 0,
    })
  }

  return cells
}

/**
 * useTodayData — streak + rolling-week activity data for Home's compact
 * streak strip (see HomeStreakStrip).
 *
 * Historically this hook also fed the old full TodayCard block (now-playing
 * spotlight, time-to-beat progress, yearly goal ring, circle streaks) — that
 * card was removed as part of the Home v3 feed-first pass and deleted as
 * dead code, so this hook was trimmed down to only what Home still consumes.
 * Name kept as-is (internal only) to minimize diff.
 *
 * Returns:
 *   weekCells  — Array<{ key, dayLabel, active, isToday }>, 7 items.
 *   streak     — { current: number, longest: number }
 *   isLoading  — true while the async activity fetch is in flight.
 */
export function useTodayData() {
  const { user } = useAuth()

  const [weekCells, setWeekCells] = useState(() => buildWeekCells(new Map()))
  const [streak, setStreak] = useState({ current: 0, longest: 0 })
  const [isLoading, setIsLoading] = useState(true)

  const refreshActivity = useCallback(async () => {
    if (!user?.id) {
      setWeekCells(buildWeekCells(new Map()))
      setStreak({ current: 0, longest: 0 })
      setIsLoading(false)
      return
    }

    try {
      const counts = await getCachedActivityCalendar(user.id, 60)
      setWeekCells(buildWeekCells(counts))
      setStreak(computeStreaks(counts))
    } catch (err) {
      console.error('[useTodayData] activity fetch failed:', err)
      setWeekCells(buildWeekCells(new Map()))
      setStreak({ current: 0, longest: 0 })
    } finally {
      setIsLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    setIsLoading(true)
    refreshActivity()
  }, [refreshActivity])

  useEffect(() => {
    function onActivityChange() {
      invalidateActivityCache()
      setIsLoading(true)
      refreshActivity()
    }

    window.addEventListener('activityUpdated', onActivityChange)
    window.addEventListener('reviewAdded', onActivityChange)
    window.addEventListener(APP_RESUMED_EVENT, onActivityChange)

    return () => {
      window.removeEventListener('activityUpdated', onActivityChange)
      window.removeEventListener('reviewAdded', onActivityChange)
      window.removeEventListener(APP_RESUMED_EVENT, onActivityChange)
    }
  }, [refreshActivity])

  return {
    weekCells,
    streak,
    isLoading,
  }
}

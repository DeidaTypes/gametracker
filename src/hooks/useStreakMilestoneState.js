import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getStreakData } from '../services/streakMilestoneService'
import { getCachedActivityCalendar } from '../services/statsService'
import {
  buildRollingWeekCells,
  buildStreakMilestoneView,
} from '../services/streakMilestoneState'
import { APP_RESUMED_EVENT } from './useAppResume'

/**
 * useStreakMilestoneState — loads streak row + rolling week activity,
 * returns the S16-2 read-model for Home strip and detail sheet.
 */
export function useStreakMilestoneState() {
  const { user } = useAuth()
  const userId = user?.id || null

  const [loading, setLoading] = useState(!!userId)
  const [view, setView] = useState(null)

  const refresh = useCallback(async () => {
    if (!userId) {
      setView(null)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [streakData, calendar] = await Promise.all([
        getStreakData(userId),
        getCachedActivityCalendar(userId),
      ])
      const weekCells = buildRollingWeekCells(calendar)
      setView(buildStreakMilestoneView({ streakData, weekCells }))
    } catch (err) {
      console.error('[streak] useStreakMilestoneState failed:', err)
      setView(buildStreakMilestoneView({ streakData: null, weekCells: [] }))
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!userId) return undefined
    function onChange() {
      refresh()
    }
    window.addEventListener('streakUpdated', onChange)
    window.addEventListener('activityUpdated', onChange)
    window.addEventListener(APP_RESUMED_EVENT, onChange)
    return () => {
      window.removeEventListener('streakUpdated', onChange)
      window.removeEventListener('activityUpdated', onChange)
      window.removeEventListener(APP_RESUMED_EVENT, onChange)
    }
  }, [userId, refresh])

  return { loading, view, refresh }
}

export default useStreakMilestoneState

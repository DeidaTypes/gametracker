import { useCallback, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getStreakData } from '../services/streakMilestoneService'
import { getCachedActivityCalendar } from '../services/statsService'
import { getGoalProgress, getRivalryData } from '../services/goalService'
import {
  buildRollingWeekCells,
  buildStreakMilestoneView,
} from '../services/streakMilestoneState'
import { APP_RESUMED_EVENT } from './useAppResume'
import { useCachedResource } from './useCachedResource'

/**
 * Home progress strip — streak, yearly goal, and circle rivalry —
 * cached for the session under `home:progress:{uid}`. A revisit paints
 * the last value on the first frame and revalidates in the background.
 */
export function useStreakMilestoneState() {
  const { user } = useAuth()
  const userId = user?.id || null
  const key = userId ? `home:progress:${userId}` : null

  const fetcher = useCallback(async () => {
    const year = new Date().getFullYear()
    const [streakData, calendar, goalProgress, rivalryData] = await Promise.all([
      getStreakData(userId),
      getCachedActivityCalendar(userId),
      getGoalProgress(userId, year),
      getRivalryData(userId, year),
    ])
    return {
      view: buildStreakMilestoneView({
        streakData,
        weekCells: buildRollingWeekCells(calendar),
      }),
      goalProgress,
      rivalryData: rivalryData || [],
    }
  }, [userId])

  const { data, error, refresh, isRevalidating } = useCachedResource(key, fetcher, {
    enabled: !!userId,
  })

  useEffect(() => {
    if (!userId) return undefined
    const onChange = () => {
      refresh().catch(() => {})
    }
    window.addEventListener('streakUpdated', onChange)
    window.addEventListener('activityUpdated', onChange)
    window.addEventListener('libraryUpdated', onChange)
    window.addEventListener(APP_RESUMED_EVENT, onChange)
    return () => {
      window.removeEventListener('streakUpdated', onChange)
      window.removeEventListener('activityUpdated', onChange)
      window.removeEventListener('libraryUpdated', onChange)
      window.removeEventListener(APP_RESUMED_EVENT, onChange)
    }
  }, [userId, refresh])

  const loading = !!userId && data === undefined && !error

  return {
    loading,
    view: data?.view ?? null,
    goalProgress: data?.goalProgress ?? null,
    rivalryData: data?.rivalryData ?? [],
    refresh,
    isRevalidating,
  }
}

export default useStreakMilestoneState

import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useWeekData } from '../../hooks/useWeekData'
import { getGoalProgress } from '../../services/goalService'
import { APP_RESUMED_EVENT } from '../../hooks/useAppResume'
import HomeWeekCard from './HomeWeekCard'
import HomeGoalCard from './HomeGoalCard'
import WeekDetailSheet from './WeekDetailSheet'
import './HomeWeekRow.css'

/**
 * HomeWeekRow — "weekly rhythm" surface for Home, replacing the old daily
 * streak strip (a daily streak punishes deep multi-week playthroughs;
 * weekly rhythm rewards them instead). Two small cards side by side:
 *
 *   1. "This week" (HomeWeekCard) — real sessions-this-week + total hours
 *      (useWeekData, backed by play_sessions). Tapping it opens
 *      WeekDetailSheet with every session, its note, and a day-by-day
 *      activity tracker. The "Calendar" link inside the card is the kept
 *      entry point into the full /activity calendar screen.
 *   2. "{year} goal" (HomeGoalCard) — reuses goalService/GoalRing from the
 *      existing yearly-challenge feature (Profile). Renders nothing at all
 *      when no goal is set — this row never invites the user to set one;
 *      that CTA already lives on Profile.
 *
 * When there's no goal, the grid collapses to a single full-width "This
 * week" card rather than leaving an empty second cell.
 */
function HomeWeekRow() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const weekData = useWeekData()

  const [goalProgress, setGoalProgress] = useState(null) // null = loading
  const [detailOpen, setDetailOpen] = useState(false)

  const refreshGoal = useCallback(() => {
    if (!user?.id) {
      setGoalProgress({ hasGoal: false, target: null, current: 0, year: new Date().getFullYear(), percent: 0 })
      return
    }
    getGoalProgress(user.id, new Date().getFullYear())
      .then((gp) => setGoalProgress(gp))
      .catch(() => setGoalProgress({ hasGoal: false, target: null, current: 0, year: new Date().getFullYear(), percent: 0 }))
  }, [user?.id])

  useEffect(() => {
    setGoalProgress(null)
    refreshGoal()
  }, [refreshGoal])

  useEffect(() => {
    function onChange() { refreshGoal() }
    window.addEventListener('activityUpdated', onChange)
    window.addEventListener('libraryUpdated', onChange)
    window.addEventListener(APP_RESUMED_EVENT, onChange)
    return () => {
      window.removeEventListener('activityUpdated', onChange)
      window.removeEventListener('libraryUpdated', onChange)
      window.removeEventListener(APP_RESUMED_EVENT, onChange)
    }
  }, [refreshGoal])

  const goalLoading = goalProgress === null
  const showGoalCard = goalLoading || goalProgress.hasGoal

  return (
    <>
      <div className={`hwr-row${showGoalCard ? '' : ' hwr-row--single'}`}>
        <HomeWeekCard
          sessionCount={weekData.sessionCount}
          totalHours={weekData.totalHours}
          loading={weekData.loading}
          onOpenDetail={() => setDetailOpen(true)}
          onOpenCalendar={() => navigate('/activity')}
        />
        {showGoalCard && (
          <HomeGoalCard goalProgress={goalProgress} loading={goalLoading} />
        )}
      </div>

      <WeekDetailSheet
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        sessions={weekData.sessions}
        dayCells={weekData.dayCells}
        sessionCount={weekData.sessionCount}
        totalHours={weekData.totalHours}
        loading={weekData.loading}
        weekStart={weekData.weekStart}
        weekEnd={weekData.weekEnd}
      />
    </>
  )
}

export default HomeWeekRow

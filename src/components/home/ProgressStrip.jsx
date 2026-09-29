import React, { useCallback, useEffect, useState } from 'react'
import { Flame } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useStreakMilestoneState } from '../../hooks/useStreakMilestoneState'
import { getGoalProgress, getRivalryData } from '../../services/goalService'
import { getProfile } from '../../services/profileService'
import ChallengeCard, { challengePathSegment } from '../ChallengeCard'
import StreakDetailSheet from '../streak/StreakDetailSheet'
import { APP_RESUMED_EVENT } from '../../hooks/useAppResume'
import './ProgressStrip.css'

function computeCircleRank(goalProgress, rivalryData) {
  if (!goalProgress?.hasGoal || !rivalryData?.length) return null
  const withSelf = [
    { userId: 'self', current: goalProgress.current, isSelf: true },
    ...rivalryData.map((r) => ({ ...r, isSelf: false })),
  ].sort((a, b) => b.current - a.current || (a.isSelf ? -1 : 1))
  const idx = withSelf.findIndex((r) => r.isSelf)
  return idx === -1 ? null : idx + 1
}

function ChallengeRing({ current, target }) {
  const size = 44
  const stroke = 4
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const cx = size / 2
  const cy = size / 2
  const pct = target > 0 ? Math.min(1, current / target) : 0
  const dash = circ * pct
  const gap = circ - dash

  return (
    <div className="ps-challenge-ring" aria-hidden="true">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ps-challenge-ring__svg">
        <circle
          className="ps-challenge-ring__track"
          cx={cx}
          cy={cy}
          r={r}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          className="ps-challenge-ring__fill"
          cx={cx}
          cy={cy}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${gap}`}
          strokeDashoffset="0"
          transform={`rotate(-90 ${cx} ${cy})`}
          strokeLinecap="round"
        />
      </svg>
      <span className="ps-challenge-ring__num">{current}</span>
    </div>
  )
}

/**
 * ProgressStrip — merged Home streak + yearly challenge surface (V4-02).
 * Left cell: streak count, tier, rolling week dots. Right cell: challenge
 * ring (hidden when no goal is set).
 */
function ProgressStrip() {
  const { user, profile } = useAuth()
  const { loading: streakLoading, view } = useStreakMilestoneState()
  const [detailOpen, setDetailOpen] = useState(false)
  const [goalProgress, setGoalProgress] = useState(null)
  const [rivalryData, setRivalryData] = useState([])

  const refreshGoal = useCallback(() => {
    if (!user?.id) {
      setGoalProgress({
        hasGoal: false,
        target: null,
        current: 0,
        year: new Date().getFullYear(),
        percent: 0,
      })
      setRivalryData([])
      return
    }
    const year = new Date().getFullYear()
    Promise.all([
      getGoalProgress(user.id, year),
      getRivalryData(user.id, year),
    ])
      .then(([gp, rivalry]) => {
        setGoalProgress(gp)
        setRivalryData(rivalry || [])
      })
      .catch(() => {
        setGoalProgress({
          hasGoal: false,
          target: null,
          current: 0,
          year,
          percent: 0,
        })
        setRivalryData([])
      })
  }, [user?.id])

  useEffect(() => {
    setGoalProgress(null)
    refreshGoal()
  }, [refreshGoal])

  useEffect(() => {
    function onChange() {
      refreshGoal()
    }
    window.addEventListener('activityUpdated', onChange)
    window.addEventListener('libraryUpdated', onChange)
    window.addEventListener(APP_RESUMED_EVENT, onChange)
    return () => {
      window.removeEventListener('activityUpdated', onChange)
      window.removeEventListener('libraryUpdated', onChange)
      window.removeEventListener(APP_RESUMED_EVENT, onChange)
    }
  }, [refreshGoal])

  if (streakLoading || !view) return null

  const {
    currentStreak,
    currentTier,
    nextTier,
    daysToNextTier,
    weekCells,
    hasStreak,
  } = view

  const goalLoading = goalProgress === null
  const showChallenge = !goalLoading && goalProgress.hasGoal
  const circleRank = showChallenge
    ? computeCircleRank(goalProgress, rivalryData)
    : null

  const profilePathSegment = challengePathSegment({
    username: profile?.username || getProfile()?.username,
    userId: user?.id,
  })

  const line2Parts = []
  if (!hasStreak) {
    line2Parts.push('Start a streak')
  } else if (nextTier && daysToNextTier != null) {
    line2Parts.push(
      daysToNextTier === 1
        ? `1 day to ${nextTier.name}`
        : `${daysToNextTier} days to ${nextTier.name}`
    )
  }
  const line2 = line2Parts.join(' · ')

  return (
    <>
      <div
        className={[
          'ps',
          showChallenge ? 'ps--dual' : 'ps--single',
        ].filter(Boolean).join(' ')}
      >
        <button
          type="button"
          className={['ps-streak', !hasStreak ? 'ps-streak--zero' : ''].filter(Boolean).join(' ')}
          onClick={() => setDetailOpen(true)}
          aria-label={
            hasStreak
              ? `${currentStreak}-day streak, ${currentTier?.name || 'in progress'}. Open streak details.`
              : 'Start a streak. Open streak details.'
          }
        >
          <div className="ps-streak__head">
            <Flame className="ps-streak__flame" size={20} strokeWidth={1.75} aria-hidden="true" />
            <span className="ps-streak__count">{currentStreak}</span>
            {hasStreak && currentTier && (
              <span className="ps-streak__tier text-label">{currentTier.name}</span>
            )}
          </div>
          <div className="ps-streak__pips" aria-hidden="true">
            {weekCells.map((cell) => (
              <span
                key={cell.key}
                className={[
                  'ps-streak__pip',
                  hasStreak && cell.active ? 'ps-streak__pip--active' : '',
                  cell.isToday ? 'ps-streak__pip--today' : '',
                ].filter(Boolean).join(' ')}
              />
            ))}
          </div>
          {line2 && (
            <p className="ps-streak__line2 text-caption">{line2}</p>
          )}
        </button>

        {showChallenge && (
          <ChallengeCard
            className="ps-challenge"
            year={goalProgress.year}
            current={goalProgress.current}
            target={goalProgress.target}
            profilePathSegment={profilePathSegment}
          >
            <ChallengeRing current={goalProgress.current} target={goalProgress.target} />
            <div className="ps-challenge__info">
              <span className="ps-challenge__ratio">
                {goalProgress.current}/{goalProgress.target}
              </span>
              {circleRank != null && (
                <span className="ps-challenge__rank text-caption">
                  #{circleRank} in circle
                </span>
              )}
            </div>
          </ChallengeCard>
        )}
      </div>

      <StreakDetailSheet
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        view={view}
      />
    </>
  )
}

export default ProgressStrip

import React, { useState } from 'react'
import { Flame } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useStreakMilestoneState } from '../../hooks/useStreakMilestoneState'
import ChallengeCard from '../ChallengeCard'
import StreakDetailSheet from '../streak/StreakDetailSheet'
import { Arrive } from '../motion/ContentSwap'
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
  const size = 20
  const stroke = 3
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
    </div>
  )
}

/**
 * ProgressStrip — merged Home streak + yearly challenge surface (V4-02).
 * Left cell: streak count, tier, rolling week dots. Right cell: challenge
 * ring (hidden when no goal is set).
 */
function ProgressStripPlaceholder() {
  return (
    <div className="ps ps--single" aria-hidden="true">
      <div className="ps-streak">
        <div className="ps-streak__head">
          <span className="skeleton ps-streak__skel-flame" />
          <span className="skeleton ps-streak__skel-count" />
          <div className="ps-streak__pips">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} className="ps-streak__pip" />
            ))}
          </div>
        </div>
        <p className="ps-streak__line2 text-caption">&nbsp;</p>
      </div>
    </div>
  )
}

function ProgressStripBody({ view, goalProgress, rivalryData }) {
  const { user } = useAuth()
  const [detailOpen, setDetailOpen] = useState(false)

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

  const daysToNextLine =
    nextTier && daysToNextTier != null
      ? daysToNextTier === 1
        ? `1 day to ${nextTier.name}`
        : `${daysToNextTier} days to ${nextTier.name}`
      : null

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
            <Flame className="ps-streak__flame" size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="ps-streak__count">{currentStreak}</span>
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
          </div>
          <p className="ps-streak__line2 text-caption">
            {!hasStreak ? (
              'Start a streak'
            ) : (
              <>
                {currentTier && (
                  <span className="ps-streak__tier-name">{currentTier.name}</span>
                )}
                {daysToNextLine && (
                  <>
                    {currentTier && ' · '}
                    {daysToNextLine}
                  </>
                )}
              </>
            )}
          </p>
        </button>

        {showChallenge && (
          <ChallengeCard
            className="ps-challenge"
            year={goalProgress.year}
            current={goalProgress.current}
            target={goalProgress.target}
            userId={user?.id}
            isOwnProfile
          >
            <div className="ps-challenge__row1">
              <ChallengeRing current={goalProgress.current} target={goalProgress.target} />
              <span className="ps-challenge__ratio">
                <span className="ps-challenge__current">{goalProgress.current}</span>
                <span className="ps-challenge__target">/{goalProgress.target}</span>
              </span>
            </div>
            {circleRank != null && (
              <span className="ps-challenge__rank text-caption">
                #{circleRank} in circle
              </span>
            )}
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

/**
 * The placeholder is the strip's final box, so the numbers crossfade in
 * place rather than the card appearing in one frame.
 */
function ProgressStrip() {
  const { loading, view, goalProgress, rivalryData } = useStreakMilestoneState()
  const ready = !loading && !!view
  return (
    <Arrive ready={ready} placeholder={<ProgressStripPlaceholder />}>
      {ready ? (
        <ProgressStripBody view={view} goalProgress={goalProgress} rivalryData={rivalryData} />
      ) : null}
    </Arrive>
  )
}

export default ProgressStrip

import React, { useState } from 'react'
import { Flame, Shield } from 'lucide-react'
import { useStreakMilestoneState } from '../../hooks/useStreakMilestoneState'
import StreakDetailSheet from '../streak/StreakDetailSheet'
import './HomeStreakStrip.css'

/**
 * HomeStreakStrip — enhanced streak surface for Home (S16-1).
 *
 * Large streak count + flame, current tier pill, progress toward next
 * milestone, rolling 7-day calendar pips, and rest-day shield chip.
 * All milestone math comes from useStreakMilestoneState (S16-2).
 */
function HomeStreakStrip() {
  const { loading, view } = useStreakMilestoneState()
  const [detailOpen, setDetailOpen] = useState(false)

  if (loading || !view) return null

  const {
    currentStreak,
    currentTier,
    nextTier,
    daysToNextTier,
    progressToNext,
    weekCells,
    hasRestDayShield,
    hasStreak,
  } = view

  const progressPct = Math.round(progressToNext * 100)

  return (
    <>
      <button
        type="button"
        className={[
          'hss',
          !hasStreak ? 'hss--zero' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => setDetailOpen(true)}
        aria-label={
          hasStreak
            ? `${currentStreak}-day streak, ${currentTier?.name || 'in progress'}. Open streak details.`
            : 'Start a streak. Open streak details.'
        }
      >
        <div className="hss-hero">
          <div className="hss-hero-left">
            <Flame className="hss-flame" size={28} strokeWidth={1.75} aria-hidden="true" />
            <span className="hss-count text-display-l" aria-hidden="true">
              {currentStreak}
            </span>
          </div>

          {currentTier && (
            <span className="hss-tier-pill text-label">{currentTier.name}</span>
          )}
        </div>

        {nextTier && hasStreak && (
          <div className="hss-progress-block">
            <div
              className="hss-progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPct}
              aria-label={`Progress toward ${nextTier.name}`}
            >
              <div
                className="hss-progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="hss-next text-caption">
              {daysToNextTier === 1
                ? `1 day to ${nextTier.name}`
                : `${daysToNextTier} days to ${nextTier.name}`}
            </p>
          </div>
        )}

        {!hasStreak && (
          <p className="hss-zero-copy text-caption">Log any activity to start a streak</p>
        )}

        <div className="hss-calendar" aria-hidden="true">
          <div className="hss-pips" role="presentation">
            {weekCells.map((cell) => (
              <span
                key={cell.key}
                className={[
                  'hss-pip',
                  hasStreak && cell.active ? 'hss-pip--active' : '',
                  cell.isToday ? 'hss-pip--today' : '',
                ].filter(Boolean).join(' ')}
              />
            ))}
          </div>
        </div>

        {hasRestDayShield && (
          <div className="hss-shield text-label">
            <Shield size={12} aria-hidden="true" />
            <span>Rest-day shield available</span>
          </div>
        )}
      </button>

      <StreakDetailSheet
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        view={view}
      />
    </>
  )
}

export default HomeStreakStrip

import React from 'react'
import { AlertTriangle, Check, Flame, Lock } from 'lucide-react'
import CenteredModal from '../CenteredModal'
import './StreakDetailSheet.css'

/**
 * StreakDetailSheet — 5-milestone ladder, longest streak, at-risk card.
 * Reads view state from useStreakMilestoneState (S16-2); computes nothing.
 *
 * Presented as a centered popup (CenteredModal): "Your streak" centered in
 * the top bar, Done on the right, tap outside to close. No grab bar, no X,
 * no drag to dismiss. It is as tall as its content, up to 80% of the
 * viewport, and scrolls inside when the content is taller.
 */
function StreakDetailSheet({ isOpen, onClose, view }) {
  if (!view) return null

  const {
    currentStreak,
    longestStreak,
    ladder,
    isAtRisk,
    hasRestDayShield,
  } = view

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Your streak"
      maxWidth={400}
      className="sds-card"
    >
      <header className="sds-top">
        <span aria-hidden="true" />
        <h2 className="sds-top__title text-title">Your streak</h2>
        <button type="button" className="sds-top__done" onClick={onClose}>
          Done
        </button>
      </header>

      <div className="cm-scroll sds-body">
        <div className="sds-summary">
          <div className="sds-current">
            <Flame size={20} aria-hidden="true" />
            <span className="text-heading">{currentStreak}</span>
            <span className="text-caption">day streak</span>
          </div>
          <p className="sds-longest text-caption">
            Longest ever: {longestStreak} {longestStreak === 1 ? 'day' : 'days'}
          </p>
        </div>

        {isAtRisk && (
          <div className="sds-at-risk" role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              <p className="sds-at-risk-title text-caption">Streak at risk</p>
              <p className="sds-at-risk-body text-body">
                Log any activity today to keep your {currentStreak}-day streak alive.
              </p>
            </div>
          </div>
        )}

        <ol className="sds-ladder" aria-label="Streak milestones">
          {ladder.map((step) => (
            <li
              key={step.days}
              className={[
                'sds-step',
                `sds-step--${step.status}`,
              ].join(' ')}
            >
              <div className="sds-step-icon" aria-hidden="true">
                {step.status === 'done' && <Check size={16} />}
                {step.status === 'next' && <Flame size={16} />}
                {step.status === 'locked' && <Lock size={14} />}
              </div>
              <div className="sds-step-copy">
                <span className="sds-step-name text-title">{step.name}</span>
                <span className="sds-step-days text-caption">{step.days} days</span>
              </div>
              {step.status === 'next' && (
                <span className="sds-step-badge text-label">Next</span>
              )}
            </li>
          ))}
        </ol>

        {hasRestDayShield && (
          <p className="sds-shield-note text-caption">
            Rest-day shield available this week — covers one missed day.
          </p>
        )}
      </div>
    </CenteredModal>
  )
}

export default StreakDetailSheet

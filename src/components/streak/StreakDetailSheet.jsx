import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { AlertTriangle, Check, Flame, Lock, X } from 'lucide-react'
import { useMotionPreference } from '../../hooks/useMotionPreference'
import { useSheetDrag } from '../../motion/useSheetDrag'
import { useNavDim } from '../../hooks/useNavDim'
import './StreakDetailSheet.css'

/**
 * StreakDetailSheet — 5-milestone ladder, longest streak, at-risk card.
 * Reads view state from useStreakMilestoneState (S16-2); computes nothing.
 */
function StreakDetailSheet({ isOpen, onClose, view }) {
  const { reduced } = useMotionPreference()

  useNavDim(isOpen)
  const { panel, dim, dragProps, startDrag } = useSheetDrag(reduced, onClose)

  useEffect(() => {
    if (!isOpen) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!view) return null

  const {
    currentStreak,
    longestStreak,
    ladder,
    isAtRisk,
    hasRestDayShield,
  } = view

  const content = (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="sds-backdrop"
            {...dim}
            onClick={onClose}
            aria-hidden="true"
          />

          <motion.div
            className="sds-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sds-title"
            {...panel}
            {...dragProps}
          >
            <div className="sds-handle" aria-hidden="true" onPointerDown={startDrag} />

            <header className="sds-header">
              <h2 id="sds-title" className="sds-title text-heading">Your streak</h2>
              <button
                type="button"
                className="sds-close"
                onClick={onClose}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </header>

            <div className="sds-body">
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
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )

  return createPortal(content, document.body)
}

export default StreakDetailSheet

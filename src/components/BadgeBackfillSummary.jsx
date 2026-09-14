import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { useBadgeBackfill } from '../hooks/useBadgeBackfill'
import { hapticSuccess } from '../utils/haptics'
import './BadgeBackfillSummary.css'

/**
 * One-time summary of historical badge grants. Shown exactly once,
 * the first time backfill_my_badges() returns a non-empty grant list.
 * Brand-new users (zero earned tiers) never see this.
 *
 * Reuses BadgeReveal's overlay / card / halo / dismiss language, but
 * renders a compact grid instead of a queued one-at-a-time reveal.
 */
export default function BadgeBackfillSummary() {
  const reducedMotion = useReducedMotion()
  const { settled, grants } = useBadgeBackfill()
  const [dismissed, setDismissed] = useState(false)

  const visible = settled && grants.length > 0 && !dismissed
  const count = grants.length

  useEffect(() => {
    if (visible) hapticSuccess()
  }, [visible])

  const dismiss = useCallback(() => {
    setDismissed(true)
  }, [])

  const overlayMotion = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.18 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.22 } }

  const cardMotion = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.18 } }
    : {
        initial: { opacity: 0, scale: 0.82, y: 24 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.94, y: 8 },
        transition: { type: 'spring', stiffness: 360, damping: 28 },
      }

  const content = (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="badge-backfill-summary"
          className="bbs-overlay"
          role="alertdialog"
          aria-live="polite"
          aria-label={`You've already earned ${count} ${count === 1 ? 'badge' : 'badges'}`}
          onClick={dismiss}
          {...overlayMotion}
        >
          <motion.div
            className="bbs-card"
            onClick={(e) => e.stopPropagation()}
            {...cardMotion}
          >
            <div className="bbs-halo" aria-hidden="true" />

            <p className="bbs-eyebrow">Already earned</p>
            <h2 className="bbs-title text-heading">
              {`You've already earned ${count} ${count === 1 ? 'badge' : 'badges'}`}
            </h2>
            <p className="bbs-lede text-body">
              These were waiting for you from your existing play history.
            </p>

            <ul className="bbs-grid">
              {grants.map((badge) => {
                const Icon = badge.icon
                return (
                  <li key={badge.id} className={`bbs-tile bbs-tile--${badge.tier}`}>
                    <span className={`bbs-icon bbs-icon--${badge.tier}`} aria-hidden="true">
                      <Icon size={22} strokeWidth={1.6} />
                    </span>
                    <span className="bbs-name text-label">{badge.name}</span>
                    <span className={`bbs-tier bbs-tier--${badge.tier}`}>{badge.tier}</span>
                  </li>
                )
              })}
            </ul>

            <button
              type="button"
              className="bbs-dismiss"
              onClick={dismiss}
              aria-label="Dismiss badge summary"
            >
              Got it
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return createPortal(content, document.body)
}

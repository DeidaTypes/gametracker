import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useBadgeBackfill } from '../hooks/useBadgeBackfill'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { popCard, popDim } from '../motion/xMotion'
import { hapticSuccess } from '../utils/haptics'
import BadgeMedallion, { badgeLevelLabel } from './BadgeMedallion'
import './BadgeBackfillSummary.css'

/**
 * One-time summary of historical badge grants. Shown exactly once,
 * the first time backfill_my_badges() returns a non-empty grant list.
 * Brand-new users (zero earned tiers) never see this.
 *
 * Also the card for a `badgeSummary` event (onboarding, or two or more
 * unlocks at once). Same shell. One card at a time: if the backfill
 * card is open, the event card waits until it is dismissed.
 */
export default function BadgeBackfillSummary() {
  const { reduced } = useMotionPreference()
  const { settled, grants } = useBadgeBackfill()
  const [dismissed, setDismissed] = useState(false)
  const [queue, setQueue] = useState([])
  const summaryKey = useRef(0)

  const backfillVisible = settled && grants.length > 0 && !dismissed

  useEffect(() => {
    const onSummary = (event) => {
      const detail = event?.detail
      if (!detail?.badges?.length) return
      summaryKey.current += 1
      const key = `badge-summary-${summaryKey.current}`
      setQueue((prev) => [
        ...prev,
        {
          key,
          eyebrow: detail.eyebrow,
          title: detail.title,
          lede: detail.lede,
          cta: detail.cta,
          badges: detail.badges,
        },
      ])
    }
    window.addEventListener('badgeSummary', onSummary)
    return () => window.removeEventListener('badgeSummary', onSummary)
  }, [])

  const summary = !backfillVisible && queue.length > 0 ? queue[0] : null
  const backfillCount = grants.length
  const active = backfillVisible
    ? {
        key: 'badge-backfill-summary',
        eyebrow: 'Already earned',
        title: `You've already earned ${backfillCount} ${backfillCount === 1 ? 'badge' : 'badges'}`,
        lede: 'These were waiting for you from your existing play history.',
        cta: 'Got it',
        badges: grants,
        ariaLabel: `You've already earned ${backfillCount} ${backfillCount === 1 ? 'badge' : 'badges'}`,
      }
    : summary
      ? { ...summary, ariaLabel: summary.title }
      : null

  const activeKey = active?.key ?? null

  useEffect(() => {
    if (activeKey) hapticSuccess()
  }, [activeKey])

  const dismiss = useCallback(() => {
    if (backfillVisible) {
      setDismissed(true)
      return
    }
    setQueue((prev) => prev.slice(1))
  }, [backfillVisible])

  const overlayMotion = popDim(reduced)
  const cardMotion = popCard(reduced)

  const content = (
    <AnimatePresence>
      {active && (
        <motion.div
          key={active.key}
          className="bbs-overlay"
          role="alertdialog"
          aria-live="polite"
          aria-label={active.ariaLabel}
          onClick={dismiss}
          {...overlayMotion}
        >
          <motion.div
            className="bbs-card"
            onClick={(e) => e.stopPropagation()}
            {...cardMotion}
          >
            <div className="bbs-halo" aria-hidden="true" />

            <p className="bbs-eyebrow">{active.eyebrow}</p>
            <h2 className="bbs-title text-heading">{active.title}</h2>
            <p className="bbs-lede text-body">{active.lede}</p>

            <ul className="bbs-grid">
              {active.badges.map((badge) => {
                const Icon = badge.icon
                const isSingle = badge.kind === 'single'
                return (
                  <li key={badge.id} className={`bbs-tile bbs-tile--${badge.tier}`}>
                    {isSingle ? (
                      <BadgeMedallion badge={badge} earned size={48} />
                    ) : (
                      <span className={`bbs-icon bbs-icon--${badge.tier}`} aria-hidden="true">
                        <Icon size={22} strokeWidth={1.6} />
                      </span>
                    )}
                    <span className="bbs-name text-label">{badge.name}</span>
                    {isSingle ? (
                      <span className="bbs-difficulty">{badgeLevelLabel(badge.level)}</span>
                    ) : (
                      <span className={`bbs-tier bbs-tier--${badge.tier}`}>{badge.tier}</span>
                    )}
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
              {active.cta}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return createPortal(content, document.body)
}

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useBadgeBackfill } from '../hooks/useBadgeBackfill'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { popCard, popDim } from '../motion/xMotion'
import { hapticSuccess } from '../utils/haptics'
import { beginMoment, endMoment, isMomentShowing } from '../services/badgeMoments'
import BadgeMedallion, { badgeLevelLabel } from './BadgeMedallion'
import './BadgeBackfillSummary.css'

const BACKFILL_KEY = 'badge-backfill-summary'

/**
 * One-time summary of historical badge grants. Shown exactly once,
 * the first time backfill_my_badges() returns a non-empty grant list.
 * Brand-new users (zero earned tiers) never see this.
 *
 * Also the card for a `badgeSummary` event (onboarding, two or more
 * unlocks at once, or the one-time level card). Same shell. One card
 * at a time, and never while another moment is open. An empty badges
 * array hides the tile grid.
 */
function backfillCard(grants) {
  const count = grants.length
  const title = `You've already earned ${count} ${count === 1 ? 'badge' : 'badges'}`
  return {
    key: BACKFILL_KEY,
    eyebrow: 'Already earned',
    title,
    lede: 'These were waiting for you from your existing play history.',
    cta: 'Got it',
    badges: grants,
    ariaLabel: title,
  }
}

export default function BadgeBackfillSummary() {
  const { reduced } = useMotionPreference()
  const { settled, grants } = useBadgeBackfill()
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(null)
  const summaryKey = useRef(0)
  const queueRef = useRef([])
  const momentKeyRef = useRef(null)
  const closingKeyRef = useRef(null)
  const releaseTimerRef = useRef(null)
  const dismissedRef = useRef(false)
  const activeRef = useRef(null)
  const grantsRef = useRef(grants)
  const backfillReadyRef = useRef(false)

  const backfillReady = settled && grants.length > 0 && !dismissed
  grantsRef.current = grants
  backfillReadyRef.current = backfillReady && !dismissedRef.current
  activeRef.current = active

  const show = useCallback((item) => {
    activeRef.current = item
    setActive(item)
  }, [])

  const pump = useCallback(() => {
    if (momentKeyRef.current || closingKeyRef.current) return
    if (isMomentShowing()) return
    const next = backfillReadyRef.current
      ? backfillCard(grantsRef.current)
      : queueRef.current.shift()
    if (!next) return
    if (!beginMoment(next.key)) {
      if (next.key !== BACKFILL_KEY) queueRef.current.unshift(next)
      return
    }
    momentKeyRef.current = next.key
    show(next)
  }, [show])

  const pumpRef = useRef(pump)
  pumpRef.current = pump

  useEffect(() => {
    const onSummary = (event) => {
      const detail = event?.detail
      if (!detail || !Array.isArray(detail.badges)) return
      summaryKey.current += 1
      queueRef.current = [
        ...queueRef.current,
        {
          key: `badge-summary-${summaryKey.current}`,
          eyebrow: detail.eyebrow,
          title: detail.title,
          lede: detail.lede,
          cta: detail.cta,
          badges: detail.badges,
          ariaLabel: detail.title,
        },
      ]
      pumpRef.current()
    }
    const onEnded = () => pumpRef.current()
    window.addEventListener('badgeSummary', onSummary)
    window.addEventListener('momentEnded', onEnded)
    return () => {
      window.removeEventListener('badgeSummary', onSummary)
      window.removeEventListener('momentEnded', onEnded)
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current)
        releaseTimerRef.current = null
      }
      const key = momentKeyRef.current || closingKeyRef.current
      momentKeyRef.current = null
      closingKeyRef.current = null
      if (key) endMoment(key)
    }
  }, [])

  useEffect(() => {
    if (
      backfillReady
      && momentKeyRef.current
      && activeRef.current
      && activeRef.current.key !== BACKFILL_KEY
    ) {
      queueRef.current = [activeRef.current, ...queueRef.current]
      show(backfillCard(grantsRef.current))
      return
    }
    pumpRef.current()
  }, [backfillReady, show])

  const activeKey = active?.key ?? null

  useEffect(() => {
    if (activeKey) hapticSuccess()
  }, [activeKey])

  const releaseMoment = useCallback(() => {
    if (releaseTimerRef.current) {
      clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
    }
    if (momentKeyRef.current) return
    const key = closingKeyRef.current
    if (!key) return
    closingKeyRef.current = null
    endMoment(key)
  }, [])

  const dismiss = useCallback(() => {
    if (!momentKeyRef.current) return
    if (activeRef.current?.key === BACKFILL_KEY) {
      dismissedRef.current = true
      backfillReadyRef.current = false
      setDismissed(true)
    }
    const next = queueRef.current.shift() || (
      backfillReadyRef.current ? backfillCard(grantsRef.current) : null
    )
    if (next) {
      show(next)
      return
    }
    closingKeyRef.current = momentKeyRef.current
    momentKeyRef.current = null
    activeRef.current = null
    setActive(null)
    releaseTimerRef.current = setTimeout(() => releaseMoment(), 800)
  }, [show, releaseMoment])

  const overlayMotion = popDim(reduced)
  const cardMotion = popCard(reduced)

  const content = (
    <AnimatePresence onExitComplete={releaseMoment}>
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

            {active.badges.length > 0 && (
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
            )}

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

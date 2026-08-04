import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import Lottie from 'lottie-react'
import celebrationAnimation from '../assets/lottie/celebration.json'
import {
  getPendingMilestones,
  markMilestoneSeen,
} from '../services/streakMilestoneService'
import { useAuth } from '../contexts/AuthContext'
import { hapticSuccess } from '../utils/haptics'
import './MilestoneCelebration.css'

const MILESTONE_COPY = {
  7:   { headline: '7-day streak!',    sub: 'A whole week of gaming — you\'re on fire.' },
  30:  { headline: '30-day streak!',   sub: 'A full month of play. That\'s dedication.' },
  100: { headline: '100-day streak!',  sub: 'An epic run. Legendary.' },
}

const AUTO_DISMISS_MS = 4000

/**
 * MilestoneCelebration — app-level overlay for streak milestones.
 *
 * Mount once in App.jsx. Subscribes to a custom 'streakUpdated' window
 * event emitted by streakMilestoneService after updateStreak() returns,
 * and checks getPendingMilestones() each time.
 *
 * Rules:
 *   - Shows one milestone at a time (the highest pending one)
 *   - Auto-dismisses after AUTO_DISMISS_MS
 *   - Reduced-motion: no Lottie, no scale animation — just a fade
 *   - Never shows guilt, only celebration
 */
export default function MilestoneCelebration() {
  const { user } = useAuth()
  const reducedMotion = useReducedMotion()
  const [milestone, setMilestone] = useState(null)
  const timerRef = useRef(null)

  function dismiss() {
    clearTimeout(timerRef.current)
    setMilestone(null)
  }

  // Check for pending milestones after a streak update
  function checkMilestones(currentStreak) {
    if (!user?.id || !currentStreak) return
    const pending = getPendingMilestones(user.id, currentStreak)
    if (pending.length === 0) return
    // Show the highest pending milestone
    const top = Math.max(...pending)
    markMilestoneSeen(user.id, top)
    setMilestone(top)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS)
    // Haptic beat on milestone threshold — success notification pulse,
    // via the shared Capacitor Haptics integration (src/utils/haptics.js).
    hapticSuccess()
  }

  useEffect(() => {
    function onStreakUpdated(e) {
      const streak = e?.detail?.currentStreak
      checkMilestones(streak)
    }
    window.addEventListener('streakUpdated', onStreakUpdated)
    return () => {
      window.removeEventListener('streakUpdated', onStreakUpdated)
      clearTimeout(timerRef.current)
    }
  }, [user?.id])

  if (!milestone) return null

  const copy = MILESTONE_COPY[milestone] || {
    headline: `${milestone}-day streak!`,
    sub: 'Keep it up!',
  }

  const content = (
    <AnimatePresence>
      {milestone && (
        <motion.div
          className="mc-overlay"
          role="alertdialog"
          aria-live="assertive"
          aria-label={copy.headline}
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
          animate={reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
          transition={reducedMotion
            ? { duration: 0.15 }
            : { type: 'spring', stiffness: 340, damping: 28 }
          }
          onClick={dismiss}
        >
          <div className="mc-card" onClick={(e) => e.stopPropagation()}>
            {/* Lottie animation — skip when reduced motion requested */}
            {!reducedMotion && (
              <div className="mc-lottie" aria-hidden="true">
                <Lottie
                  animationData={celebrationAnimation}
                  loop={false}
                  autoplay
                  style={{ width: 160, height: 160 }}
                />
              </div>
            )}

            <div className="mc-flame" aria-hidden="true">🔥</div>
            <h2 className="mc-headline">{copy.headline}</h2>
            <p className="mc-sub">{copy.sub}</p>

            <button
              type="button"
              className="mc-dismiss"
              onClick={dismiss}
              aria-label="Dismiss celebration"
            >
              Amazing!
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return createPortal(content, document.body)
}

/* ── Public helper: dispatch event from streakMilestoneService ────────
   Import and call this after updateStreak() returns. */
export function dispatchStreakUpdated(currentStreak) {
  try {
    window.dispatchEvent(
      new CustomEvent('streakUpdated', { detail: { currentStreak } })
    )
  } catch {
    // SSR / no-window
  }
}

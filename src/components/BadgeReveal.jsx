import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { TIER_STYLES } from '../data/badges'
import { hapticSuccess } from '../utils/haptics'
import './BadgeReveal.css'

const AUTO_DISMISS_MS = 4200

/**
 * BadgeReveal — full-screen celebration overlay for badge unlocks.
 *
 * Mount once at the app root (App.jsx). Subscribes to `badgeEarned`
 * window events dispatched by useBadgeUnlockWatcher. Multiple unlocks
 * are queued and shown one at a time.
 *
 * Animation:
 *   Normal motion   — spring scale 0.82→1 + opacity fade
 *   Reduced motion  — opacity fade only (0.18s), no Lottie, no scale
 *
 * Haptics: success notification pulse via the shared Capacitor Haptics
 * integration (src/utils/haptics.js) — a no-op on web.
 */
export default function BadgeReveal() {
  const reducedMotion = useReducedMotion()
  const [queue, setQueue] = useState([])
  const timerRef = useRef(null)

  // Current badge is always the head of the queue.
  const current = queue[0] ?? null

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current)
    setQueue((q) => q.slice(1))
  }, [])

  // Listen for badgeEarned events dispatched by useBadgeUnlockWatcher.
  useEffect(() => {
    function onBadgeEarned(e) {
      const badge = e?.detail?.badge
      if (!badge) return
      setQueue((q) => [...q, badge])
    }
    window.addEventListener('badgeEarned', onBadgeEarned)
    return () => window.removeEventListener('badgeEarned', onBadgeEarned)
  }, [])

  // Auto-dismiss and haptic whenever a new badge enters view.
  useEffect(() => {
    if (!current) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS)

    hapticSuccess()
  }, [current, dismiss])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  if (!current) return null

  const Icon = current.icon
  const tierStyle = TIER_STYLES[current.tier] || TIER_STYLES.bronze
  const isPlatinum = current.tier === 'platinum' && tierStyle.gradient

  const iconWrapStyle = isPlatinum
    ? { borderColor: 'transparent', borderImage: `${tierStyle.gradient} 1` }
    : { borderColor: tierStyle.color }

  const glowStyle = { '--badge-reveal-glow': tierStyle.color }

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

  const iconMotion = reducedMotion
    ? {}
    : {
        initial: { scale: 0.6, opacity: 0 },
        animate: { scale: 1, opacity: 1 },
        transition: { type: 'spring', stiffness: 420, damping: 22, delay: 0.12 },
      }

  const content = (
    <AnimatePresence mode="wait">
      {current && (
        <motion.div
          key={current.id}
          className="br-overlay"
          role="alertdialog"
          aria-live="assertive"
          aria-label={`Badge unlocked: ${current.name}`}
          onClick={dismiss}
          {...overlayMotion}
        >
          <motion.div
            className="br-card"
            style={glowStyle}
            onClick={(e) => e.stopPropagation()}
            {...cardMotion}
          >
            {/* Radial glow halo keyed to tier color */}
            <div className="br-halo" aria-hidden="true" />

            <p className="br-eyebrow" aria-hidden="true">Badge Unlocked</p>

            <motion.div
              className={`br-icon-wrap br-icon-wrap--${current.tier}`}
              style={iconWrapStyle}
              aria-hidden="true"
              {...iconMotion}
            >
              <Icon size={52} strokeWidth={1.5} />
            </motion.div>

            <h2 className="br-name">{current.name}</h2>
            <p className={`br-tier br-tier--${current.tier}`}>{current.tier}</p>
            <p className="br-desc">{current.description}</p>

            <button
              type="button"
              className="br-dismiss"
              onClick={dismiss}
              aria-label="Dismiss badge unlock"
            >
              Awesome!
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return createPortal(content, document.body)
}

/** Dispatch a badgeEarned event. Called by useBadgeUnlockWatcher. */
export function dispatchBadgeEarned(badge) {
  try {
    window.dispatchEvent(new CustomEvent('badgeEarned', { detail: { badge } }))
  } catch {
    // SSR / no-window
  }
}

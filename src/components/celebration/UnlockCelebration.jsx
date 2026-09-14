import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { Flame } from 'lucide-react'
import { shareContent } from '../../utils/share'
import { hapticSuccess } from '../../utils/haptics'
import './UnlockCelebration.css'

/**
 * UnlockCelebration — shared full-screen celebration shell for streak
 * milestones (S16-1) and badge unlocks (S16-5).
 *
 * Parameterized overlay: icon, ring color, tier chip, eyebrow, title,
 * category, description, progress dots (3 or 5), Share + dismiss CTAs.
 */
export default function UnlockCelebration({
  open = false,
  onDismiss,
  icon,
  ringColor = 'var(--accent)',
  tierLabel,
  eyebrow,
  title,
  category,
  description,
  progressDots = { total: 5, filled: 0 },
  primaryCta = 'Share it',
  dismissCta = 'Not now',
  shareTitle,
  shareText,
  shareUrl,
}) {
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    if (!open) return undefined
    hapticSuccess()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onDismiss?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onDismiss])

  const handleShare = async () => {
    await shareContent({
      title: shareTitle || title,
      text: shareText || description,
      url: shareUrl || (typeof window !== 'undefined' ? window.location.origin : ''),
      dialogTitle: 'Share',
    })
  }

  const totalDots = Math.max(1, progressDots?.total ?? 5)
  const filledDots = Math.min(totalDots, Math.max(0, progressDots?.filled ?? 0))

  const overlayMotion = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.22 } }

  const cardMotion = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, scale: 0.92, y: 20 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.96, y: 8 },
        transition: { type: 'spring', stiffness: 340, damping: 28 },
      }

  const iconMotion = reducedMotion
    ? {}
    : {
        initial: { scale: 0.65, opacity: 0 },
        animate: { scale: 1, opacity: 1 },
        transition: { type: 'spring', stiffness: 420, damping: 24, delay: 0.08 },
      }

  const renderIcon = () => {
    if (icon === 'flame' || icon == null) {
      return <Flame size={44} strokeWidth={1.75} aria-hidden="true" />
    }
    if (typeof icon === 'string') return <span aria-hidden="true">{icon}</span>
    return icon
  }

  const content = (
    <AnimatePresence>
      {open && (
        <motion.div
          className="uc-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="uc-title"
          aria-live="assertive"
          onClick={onDismiss}
          {...overlayMotion}
        >
          <motion.div
            className="uc-card"
            style={{ '--uc-ring-color': ringColor }}
            onClick={(e) => e.stopPropagation()}
            {...cardMotion}
          >
            <div className="uc-halo" aria-hidden="true" />

            {eyebrow && (
              <p className="uc-eyebrow text-label">{eyebrow}</p>
            )}

            <motion.div
              className="uc-icon-ring"
              aria-hidden="true"
              {...iconMotion}
            >
              <div className="uc-icon-inner">
                {renderIcon()}
              </div>
            </motion.div>

            {tierLabel && (
              <span className="uc-tier-chip text-label">{tierLabel}</span>
            )}

            <h2 id="uc-title" className="uc-title text-display-l">{title}</h2>

            {category && (
              <p className="uc-category text-caption">{category}</p>
            )}

            {description && (
              <p className="uc-desc text-body">{description}</p>
            )}

            <div
              className="uc-dots"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={totalDots}
              aria-valuenow={filledDots}
              aria-label={`${filledDots} of ${totalDots} milestones`}
            >
              {Array.from({ length: totalDots }, (_, i) => (
                <span
                  key={i}
                  className={[
                    'uc-dot',
                    i < filledDots ? 'uc-dot--filled' : '',
                  ].filter(Boolean).join(' ')}
                  aria-hidden="true"
                />
              ))}
            </div>

            <div className="uc-actions">
              <button
                type="button"
                className="uc-primary"
                onClick={handleShare}
              >
                {primaryCta}
              </button>
              <button
                type="button"
                className="uc-dismiss"
                onClick={onDismiss}
              >
                {dismissCta}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return createPortal(content, document.body)
}

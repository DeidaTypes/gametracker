import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import '../styles/keyboard.css'
import './CenteredModal.css'

/**
 * CenteredModal — a stable, centered iOS-style popup dialog.
 *
 * This is the shared presentation shell for flows that previously used
 * slide-up bottom sheets and glitched on device. Unlike a bottom sheet it
 * does NOT depend on scroll position or drag gestures: it fades + scales in
 * (0.95 → 1.0, 250 ms) over a dimmed, blurred backdrop and stays centered.
 *
 * Keyboard-aware for free: every modal rendered through this shell adopts the
 * shared `modal` keyboard behaviour (see src/styles/keyboard.css). The card is
 * transform-lifted by half the keyboard height — re-centering it in the space
 * that remains — and capped in height so overflow scrolls rather than hiding
 * behind the keyboard. No per-modal measurement, and no per-modal CSS.
 *
 * The card itself is `overflow: hidden` + flex column; children own their
 * internal scroll regions (so e.g. a pinned header can stay fixed while a
 * results list scrolls). Wrap free-flowing content in `.cm-scroll` to get a
 * single scrollable body.
 *
 * Props:
 *   isOpen            boolean — drives mount + enter/exit animation
 *   onClose           () => void — backdrop tap / Escape (parent decides
 *                      whether to confirm-if-unsaved)
 *   onExited          () => void — fired after the exit animation completes
 *                      (use to navigate away only once the close is smooth)
 *   children          modal contents
 *   className         extra class on the card
 *   ariaLabel         dialog aria-label
 *   maxWidth          card max width in px (default 360)
 *   dismissOnBackdrop whether tapping the backdrop calls onClose (default true)
 */
function CenteredModal({
  isOpen,
  onClose,
  onExited,
  children,
  className = '',
  ariaLabel,
  maxWidth = 360,
  dismissOnBackdrop = true,
}) {
  const { reduced } = useMotionPreference()

  // ── Body scroll lock while open ───────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isOpen])

  // ── Escape to dismiss ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  const handleBackdrop = () => {
    if (dismissOnBackdrop) onClose?.()
  }

  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.2 }
  const cardTransition = reduced
    ? { duration: 0 }
    : { duration: 0.25, ease: [0.16, 1, 0.3, 1] }

  return createPortal(
    <AnimatePresence onExitComplete={onExited}>
      {isOpen && (
        <motion.div
          className="cm-overlay kb-no-blur-while-animating"
          onClick={handleBackdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <div className="cm-lift kb-modal-lift">
            <motion.div
              className={`cm-card kb-modal-fit ${className}`.trim()}
              style={{ maxWidth: `${maxWidth}px` }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
              transition={cardTransition}
            >
              {children}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export default CenteredModal

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Capacitor } from '@capacitor/core'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useSheetDrag } from '../motion/useSheetDrag'
import {
  hideKeyboard,
  isKeyboardOpen,
  subscribeKeyboardInset,
  whenKeyboardSettled,
} from '../services/keyboardInset'
import '../styles/keyboard.css'
import './CenteredModal.css'

// Steady cards reserve room for the keyboard before it ever opens. Until one
// has been measured, assume an iPhone keyboard with the QuickType bar. Desktop
// web has no software keyboard, so it reserves nothing.
const DEFAULT_KEYBOARD_INSET =
  Capacitor.isNativePlatform() ||
  (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)
    ? 336
    : 0

// The tallest keyboard seen so far. Fields differ (QuickType on or off), and
// reserving the tallest one means the card fits above all of them and the
// reserve stops changing once each kind has been seen.
let measuredKeyboardInset = 0
subscribeKeyboardInset((inset) => {
  if (inset > measuredKeyboardInset) measuredKeyboardInset = inset
})

function keyboardReserve() {
  return measuredKeyboardInset || DEFAULT_KEYBOARD_INSET
}

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
 *   steady            submit boxes only. true: the card hugs its content up to
 *                      the height left with the keyboard up; 'fill': it takes
 *                      that height. The size never follows the keyboard, the
 *                      keyboard only slides the card. Taps inside the card keep
 *                      the keyboard up, and the backdrop blur is dropped while
 *                      the card slides in and out.
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
  steady = false,
}) {
  const { reduced } = useMotionPreference()
  const { transition, dragProps, startDrag } = useSheetDrag(reduced, onClose)
  const overlayRef = useRef(null)
  const cardRef = useRef(null)
  const wasOpen = useRef(false)
  const [reserve, setReserve] = useState(keyboardReserve)

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

  // ── Steady: size once per open, correct at most once ──────────────────
  // The reserve is read when the card opens. If the first keyboard of this
  // open turns out taller, grow the reserve once, after the keyboard has
  // settled, so the correction never lands mid-slide.
  useLayoutEffect(() => {
    if (!steady || !isOpen) return undefined
    setReserve(keyboardReserve())
    let corrected = false
    let cancelSettled = null
    const unsubscribe = subscribeKeyboardInset((inset) => {
      if (corrected || inset <= 0) return
      cancelSettled?.()
      cancelSettled = whenKeyboardSettled(() => {
        corrected = true
        setReserve((prev) => Math.max(prev, keyboardReserve()))
      })
    })
    return () => {
      unsubscribe()
      cancelSettled?.()
    }
  }, [steady, isOpen])

  // ── Steady: the keyboard goes down with the card ──────────────────────
  // Taps inside a steady card keep the keyboard up, so closing it (Cancel,
  // Post, opening a matching question) has to drop the keyboard itself.
  useEffect(() => {
    const closing = wasOpen.current && !isOpen
    wasOpen.current = isOpen
    if (!steady || !closing || !isKeyboardOpen()) return
    if (cardRef.current?.contains(document.activeElement)) void hideKeyboard()
  }, [steady, isOpen])

  // ── Steady: no backdrop blur while the card slides ────────────────────
  // Toggled on the DOM node, not through state, so the enter and exit never
  // re-render the card's contents.
  const setSliding = (on) => {
    overlayRef.current?.classList.toggle('cm-overlay--sliding', on)
  }
  useLayoutEffect(() => {
    if (!steady || !isOpen || reduced) return undefined
    setSliding(true)
    // Safety net if Motion never reports completion (e.g. interrupted enter).
    const timer = window.setTimeout(() => setSliding(false), 1000)
    return () => window.clearTimeout(timer)
  }, [steady, isOpen, reduced])

  const slideHandlers =
    steady && !reduced
      ? {
          onAnimationStart: () => setSliding(true),
          onAnimationComplete: () => setSliding(false),
        }
      : {}

  const handleBackdrop = () => {
    if (isKeyboardOpen()) {
      void hideKeyboard()
      return
    }
    if (dismissOnBackdrop) onClose?.()
  }

  let sizeClass = 'kb-modal-fit'
  if (steady === 'fill') sizeClass = 'cm-card--steady cm-card--steady-fill'
  else if (steady) sizeClass = 'cm-card--steady'

  const cardStyle = steady
    ? { maxWidth: `${maxWidth}px`, '--cm-keyboard-reserve': `${reserve}px` }
    : { maxWidth: `${maxWidth}px` }

  return createPortal(
    <AnimatePresence onExitComplete={onExited}>
      {isOpen && (
        <motion.div
          ref={overlayRef}
          className={`cm-overlay kb-no-blur-while-animating${steady ? ' cm-overlay--steady' : ''}`}
          onClick={handleBackdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
        >
          <div className="cm-lift kb-modal-lift">
            <motion.div
              ref={cardRef}
              className={`cm-card ${sizeClass} ${className}`.trim()}
              style={cardStyle}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel}
              data-kb-keep={steady ? '' : undefined}
              initial={reduced ? false : { y: '100dvh' }}
              animate={{ y: 0 }}
              exit={reduced ? { y: 0 } : { y: '100dvh' }}
              transition={transition}
              {...slideHandlers}
              {...dragProps}
            >
              <div
                className="cm-grab"
                aria-hidden="true"
                onPointerDown={startDrag}
              />
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

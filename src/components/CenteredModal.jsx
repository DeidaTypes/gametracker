import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Capacitor } from '@capacitor/core'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useSheetDrag } from '../motion/useSheetDrag'
import { MOTION, VARIANT, popCard, popDim, popDimTiming } from '../motion/xMotion'
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

// ── One dim for every box ─────────────────────────────────────────────────
// Each open box holds the shared dim. When the last holder lets go, the fade
// out waits one frame: a box that opens in the same commit (picker → Log a
// session) or the next frame takes the hold over and the dim never moves. A
// box that opens later reverses the fade from wherever it is. A box opened
// over another box that is still open is nested and adds its own dim.
let sharedDim = null
let dimHolders = 0
let dimReleaseFrame = 0

function sharedDimElement() {
  if (!sharedDim) {
    sharedDim = document.createElement('div')
    sharedDim.className = 'cm-dim cm-dim--shared'
    sharedDim.setAttribute('aria-hidden', 'true')
    sharedDim.style.opacity = '0'
    document.body.appendChild(sharedDim)
  }
  return sharedDim
}

function fadeSharedDim(to, reduced) {
  const el = sharedDimElement()
  const from = Number(getComputedStyle(el).opacity)
  el.getAnimations().forEach((a) => a.cancel())
  el.style.opacity = String(to)
  if (from === to) return
  el.animate([{ opacity: from }, { opacity: to }], popDimTiming(reduced, to === 0))
}

/** Returns true when another box is already open underneath (nested). */
function holdSharedDim(reduced) {
  const nested = dimHolders > 0
  dimHolders += 1
  if (dimReleaseFrame) {
    cancelAnimationFrame(dimReleaseFrame)
    dimReleaseFrame = 0
  }
  fadeSharedDim(1, reduced)
  return nested
}

function releaseSharedDim(reduced) {
  dimHolders = Math.max(0, dimHolders - 1)
  if (dimHolders > 0 || dimReleaseFrame) return
  dimReleaseFrame = requestAnimationFrame(() => {
    dimReleaseFrame = 0
    if (dimHolders === 0) fadeSharedDim(0, reduced)
  })
}

// A field that focuses while its card is still fading in (an autoFocus, or a
// composer's open timer) is focused when the fade completes instead, so the
// keyboard never rises during the enter. Only `.focus()` calls are held; a
// tap focuses natively.
const ENTERING = 'cm-pop--entering'
const pendingFocus = new WeakMap()
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.focus.cmHeld) {
  const nativeFocus = HTMLElement.prototype.focus
  const heldFocus = function focus(options) {
    const pop = this.closest?.(`.${ENTERING}`)
    if (pop) {
      pendingFocus.set(pop, [this, options])
      return
    }
    nativeFocus.call(this, options)
  }
  heldFocus.cmHeld = true
  HTMLElement.prototype.focus = heldFocus
}

/**
 * CenteredModal — a stable, centered iOS-style popup dialog.
 *
 * This is the shared presentation shell for every box you type in. It never
 * slides: it fades in at the center (opacity 0 → 1, scale 0.96 → 1,
 * MOTION.popIn on the move curve) over a dim that fades with it, and fades
 * out (scale 0.98, MOTION.popOut on the leave curve). One dim is shared by
 * every box, so a box replacing a box crossfades over a steady dim. Reduced
 * motion keeps the fade and drops the scale. Only opacity and transform
 * animate, and nothing that animates is blurred.
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
 *                      the keyboard up.
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
  const { dragProps, startDrag } = useSheetDrag(reduced, onClose)
  const popRef = useRef(null)
  const cardRef = useRef(null)
  const wasOpen = useRef(false)
  const [reserve, setReserve] = useState(keyboardReserve)
  const [nested, setNested] = useState(false)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  // ── Shared dim: hold while open ───────────────────────────────────────
  // Layout effect so the hold is taken before paint, and so a box closing
  // and a box opening in the same commit release and hold back to back.
  useLayoutEffect(() => {
    if (!isOpen) return undefined
    setNested(holdSharedDim(reducedRef.current))
    return () => releaseSharedDim(reducedRef.current)
  }, [isOpen])

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

  // ── Enter / exit bookkeeping ──────────────────────────────────────────
  // Classes are toggled on the DOM node, not through state, so the fade
  // never re-renders the card's contents. The pop mounts with ENTERING
  // (see the JSX); it holds focus and carries will-change until the enter
  // completes. A card closed mid-enter keeps holding focus until it unmounts.
  const finishEnter = () => {
    const pop = popRef.current
    if (!pop?.classList.contains(ENTERING) || pop.classList.contains('cm-pop--leaving')) return
    pop.classList.remove(ENTERING)
    const pending = pendingFocus.get(pop)
    pendingFocus.delete(pop)
    if (pending && pending[0].isConnected) pending[0].focus(pending[1])
  }

  useEffect(() => {
    if (!isOpen) return undefined
    // Safety net if Motion never reports completion.
    const timer = window.setTimeout(finishEnter, MOTION.popIn * 2)
    return () => window.clearTimeout(timer)
  }, [isOpen])

  const popHandlers = {
    onAnimationStart: (definition) => {
      if (definition !== VARIANT.out) return
      const pop = popRef.current
      if (!pop) return
      pop.classList.add('cm-pop--leaving')
      pendingFocus.delete(pop)
    },
    onAnimationComplete: (definition) => {
      if (definition === VARIANT.in) finishEnter()
    },
  }

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
          className={`cm-overlay kb-no-blur-while-animating${steady ? ' cm-overlay--steady' : ''}`}
          onClick={handleBackdrop}
        >
          {nested && <motion.div className="cm-dim" aria-hidden="true" {...popDim(reduced)} />}
          <div className="cm-lift kb-modal-lift">
            {/* The fade lives on its own layer: Motion's whole-transform
                string would override the card's drag `y`. */}
            <motion.div
              ref={popRef}
              className={`cm-pop ${ENTERING}`}
              {...popCard(reduced)}
              {...popHandlers}
            >
              <motion.div
                ref={cardRef}
                className={`cm-card ${sizeClass} ${className}`.trim()}
                style={cardStyle}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
                data-kb-keep={steady ? '' : undefined}
                {...dragProps}
              >
                <div
                  className="cm-grab"
                  aria-hidden="true"
                  onPointerDown={startDrag}
                />
                {children}
              </motion.div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export default CenteredModal

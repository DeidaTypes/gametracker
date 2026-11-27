import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import {
  LuPlus,
  LuPencilLine,
  LuListPlus,
  LuClock,
  LuMessageCircle,
} from 'react-icons/lu'
import Pressable from './Pressable'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useQuickAddActions } from '../hooks/useQuickAddActions'
import { hapticImpact } from '../utils/haptics'
import './HomeFAB.css'

// ── Radial item positions (from FAB center) ────────────────────────────────
// Quarter-circle arc: 0° (straight up) → 90° (straight left), radius 100px.
// tx = -r·sin(θ),  ty = -r·cos(θ)  where θ=0 is straight up, increasing CCW.
// Items are evenly spaced at 30° so chord ≈ 52px > 44px button — no overlap.
// The icon CENTER lands at (tx, ty). Icon-only — no visible label pill; each
// button still carries a descriptive aria-label for screen readers.
export const RADIAL_ITEMS = [
  {
    id: 'log',
    Icon: LuClock,
    tx: 0,
    ty: -100,
    ariaLabel: 'Log a session',
  },
  {
    id: 'review',
    Icon: LuPencilLine,
    tx: -50,
    ty: -87,
    ariaLabel: 'Write a review',
  },
  {
    id: 'list',
    Icon: LuListPlus,
    tx: -87,
    ty: -50,
    ariaLabel: 'Create a list',
  },
  {
    id: 'message',
    Icon: LuMessageCircle,
    tx: -100,
    ty: 0,
    ariaLabel: 'Open messages',
  },
]

// ── Motion variants ────────────────────────────────────────────────────────

// Stagger: 25ms × 3 intervals = 75ms offset for last item.
// Spring stiffness:500, damping:36 settles visually in ~165ms.
// Total perceived open time: 75 + 165 ≈ 240ms — within the 250ms target.
const containerVariants = {
  open: { transition: { staggerChildren: 0.025, delayChildren: 0 } },
  closed: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
}

function makeItemVariants(reduced) {
  return {
    open: (custom) => ({
      x: custom.tx,
      y: custom.ty,
      scale: 1,
      opacity: 1,
      transition: reduced
        ? { duration: 0 }
        : { type: 'spring', stiffness: 500, damping: 36, mass: 0.8 },
    }),
    closed: {
      x: 0,
      y: 0,
      scale: 0.3,
      opacity: 0,
      transition: reduced ? { duration: 0 } : { duration: 0.1, ease: 'easeIn' },
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function HomeFAB() {
  const [isOpen, setIsOpen] = useState(false)
  const fabRef = useRef(null)
  const { reduced } = useMotionPreference()
  const itemVariants = makeItemVariants(reduced)

  const closeRadial = (returnFocus = true) => {
    setIsOpen(false)
    if (returnFocus) {
      setTimeout(() => fabRef.current?.focus(), 60)
    }
  }

  const { runQuickAction, quickAddPortals } = useQuickAddActions({
    onInvoke: () => closeRadial(false),
  })

  // Close radial when Escape pressed
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => { if (e.key === 'Escape') closeRadial() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const openRadial = () => {
    hapticImpact('Light')
    setIsOpen(true)
  }

  const onRadialItem = (id) => {
    runQuickAction(id)
  }

  return createPortal(
    <>
      <div className="home-fab-root">

        <AnimatePresence>
          {isOpen && (
            <motion.div
              className="home-fab-backdrop"
              onClick={() => closeRadial()}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reduced ? { duration: 0 } : { duration: 0.18 }}
              aria-hidden="true"
            />
          )}
        </AnimatePresence>

        <motion.div
          className="home-fab-radial"
          animate={isOpen ? 'open' : 'closed'}
          variants={containerVariants}
          aria-hidden={!isOpen}
        >
          {RADIAL_ITEMS.map(({ id, Icon, tx, ty, ariaLabel }) => (
            <motion.div
              key={id}
              className="home-fab-item"
              variants={itemVariants}
              custom={{ tx, ty }}
            >
              <button
                type="button"
                className={`home-fab-item__btn home-fab-item__btn--${id}`}
                onClick={() => onRadialItem(id)}
                aria-label={ariaLabel}
                tabIndex={isOpen ? 0 : -1}
              >
                <Icon size={20} aria-hidden="true" />
              </button>
            </motion.div>
          ))}
        </motion.div>

        <Pressable
          ref={fabRef}
          className="home-fab"
          aria-label={isOpen ? 'Close quick actions' : 'Quick actions'}
          aria-expanded={isOpen}
          onClick={isOpen ? () => closeRadial() : openRadial}
        >
          <motion.span
            className="home-fab__icon-wrap"
            animate={{ rotate: isOpen ? 45 : 0 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 350, damping: 28 }}
            aria-hidden="true"
          >
            <LuPlus size={24} strokeWidth={2.5} />
          </motion.span>
        </Pressable>
      </div>

      {quickAddPortals}
    </>,
    document.body,
  )
}

export default HomeFAB
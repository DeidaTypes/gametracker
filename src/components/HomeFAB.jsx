import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import {
  LuPlus,
  LuPencilLine,
  LuListPlus,
  LuClock,
  LuMessageCircle,
} from 'react-icons/lu'
import CreateListModal from './CreateListModal'
import GamePickerSheet from './GamePickerSheet'
import HomeLogSessionModal from './home/HomeLogSessionModal'
import Pressable from './Pressable'
import { createList, addGameToList } from '../services/listService'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { showToast } from './Toast'
import './HomeFAB.css'

// ── Radial item positions (from FAB center) ────────────────────────────────
// Quarter-circle arc: 0° (straight up) → 90° (straight left), radius 100px.
// tx = -r·sin(θ),  ty = -r·cos(θ)  where θ=0 is straight up, increasing CCW.
// Items are evenly spaced at 30° so chord ≈ 52px > 44px button — no overlap.
// The icon CENTER lands at (tx, ty). Icon-only — no visible label pill; each
// button still carries a descriptive aria-label for screen readers.
const RADIAL_ITEMS = [
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
  const [logSessionOpen, setLogSessionOpen] = useState(false)
  const [logSessionGame, setLogSessionGame] = useState(null)
  const [logGamePickerOpen, setLogGamePickerOpen] = useState(false)
  const [createListOpen, setCreateListOpen] = useState(false)
  const [gamePickerOpen, setGamePickerOpen] = useState(false)
  const fabRef = useRef(null)
  const navigate = useNavigate()
  const { reduced } = useMotionPreference()
  const itemVariants = makeItemVariants(reduced)

  // Close radial when Escape pressed
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => { if (e.key === 'Escape') closeRadial() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const openRadial = () => setIsOpen(true)

  const closeRadial = (returnFocus = true) => {
    setIsOpen(false)
    if (returnFocus) {
      // Small delay so the closing animation can start before focus shifts
      setTimeout(() => fabRef.current?.focus(), 60)
    }
  }

  // ── Item handlers ────────────────────────────────────────────────────────

  // Global FAB → "Log a session" must NEVER assume a game. The user hasn't
  // indicated one yet, so this always opens the search step (GamePickerSheet)
  // regardless of any active session or "currently playing" state — those are
  // ambient/persisted signals, not an explicit choice, and pre-attaching from
  // them is what caused the FAB to skip search on devices with that state
  // (e.g. a lingering active session or a locally-cached "currently playing"
  // game) while the browser — with no such local state — showed search as
  // expected. Contrast with Home's Now Playing hero and Game Detail's own
  // "Log a session", which pre-attach because the user tapped a control tied
  // to a specific, visible game.
  const handleLog = () => {
    closeRadial(false)
    setLogSessionGame(null)
    setLogGamePickerOpen(true)
  }

  const handleLogGamePicked = (picked) => {
    setLogGamePickerOpen(false)
    setLogSessionGame(picked)
    setLogSessionOpen(true)
  }

  const handleReview = () => {
    closeRadial(false)
    setGamePickerOpen(true)
  }

  const handleList = () => {
    closeRadial(false)
    setCreateListOpen(true)
  }

  const handleMessage = () => {
    closeRadial(false)
    navigate('/messages')
  }

  const ITEM_HANDLERS = { log: handleLog, review: handleReview, list: handleList, message: handleMessage }

  // ── List creation ────────────────────────────────────────────────────────

  const handleCreateList = async (listName, description, initialGames, isPublic = true) => {
    const listId = await createList({ name: listName, description, isPublic })
    for (let i = 0; i < initialGames.length; i++) {
      const g = initialGames[i]
      await addGameToList(listId, g.id, i, { title: g.title, image: g.image })
    }
    showToast(`List "${listName}" created`, 'success')
    navigate(`/list/${listId}`)
  }

  // ── Game picker (for Write Review) ──────────────────────────────────────

  const handleGamePicked = (game) => {
    setGamePickerOpen(false)
    navigate(`/review/new?gameId=${game.id}`, { state: { game } })
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return createPortal(
    <>
      {/* ── Radial root — fixed at FAB position ── */}
      <div className="home-fab-root">

        {/* Backdrop: full-screen tap-to-close */}
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

        {/* Radial items */}
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
              {/* Icon button */}
              <button
                type="button"
                className={`home-fab-item__btn home-fab-item__btn--${id}`}
                onClick={ITEM_HANDLERS[id]}
                aria-label={ariaLabel}
                tabIndex={isOpen ? 0 : -1}
              >
                <Icon size={20} aria-hidden="true" />
              </button>
            </motion.div>
          ))}
        </motion.div>

        {/* Main FAB button */}
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

      {/* ── Sheets & Modals (outside radial root so z-index is independent) ── */}

      <HomeLogSessionModal
        isOpen={logSessionOpen}
        onClose={() => {
          setLogSessionOpen(false)
          setLogSessionGame(null)
          setTimeout(() => fabRef.current?.focus(), 60)
        }}
        game={logSessionGame}
      />

      <GamePickerSheet
        isOpen={logGamePickerOpen}
        onSelect={handleLogGamePicked}
        onCancel={() => {
          setLogGamePickerOpen(false)
          fabRef.current?.focus()
        }}
      />

      <CreateListModal
        isOpen={createListOpen}
        onClose={() => {
          setCreateListOpen(false)
          setTimeout(() => fabRef.current?.focus(), 60)
        }}
        onCreate={handleCreateList}
      />

      <GamePickerSheet
        isOpen={gamePickerOpen}
        onSelect={handleGamePicked}
        onCancel={() => {
          setGamePickerOpen(false)
          fabRef.current?.focus()
        }}
      />
    </>,
    document.body,
  )
}

export default HomeFAB

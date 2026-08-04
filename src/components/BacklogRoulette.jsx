import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { Shuffle, ChevronRight, X } from 'lucide-react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { hapticImpact, hapticSuccess } from '../utils/haptics'
import './BacklogRoulette.css'

/**
 * BacklogRoulette — randomly picks one Want-to-Play game.
 *
 * Slot-pull animation (22-item vertical strip decelerates to land on winner).
 * Reduced-motion: instant reveal, no animation.
 * Haptics: medium on spin start, success on land.
 *
 * Props:
 *   isOpen   boolean
 *   onClose  () => void
 *   games    array of Want-to-Play game objects
 */

const COVER_H = 138   // px — matches shelf-cover-wrap height
const STRIP_LEN = 22  // covers in the animated strip, last = winner
const ITEM_H = COVER_H  // each strip slot is exactly one cover height

function buildStrip(games, winner) {
  const out = []
  for (let i = 0; i < STRIP_LEN - 1; i++) {
    out.push(games[Math.floor(Math.random() * games.length)])
  }
  out.push(winner)
  return out
}

function SlotCover({ game }) {
  return (
    <div className="roulette-slot-item" aria-hidden="true">
      <div className="roulette-slot-cover">
        {game?.image ? (
          <img
            src={game.image}
            alt=""
            className="roulette-slot-img"
            onError={(e) => { e.target.src = COVER_FALLBACK }}
          />
        ) : (
          <div className="roulette-slot-fallback">
            {game?.title?.charAt(0) || '?'}
          </div>
        )}
      </div>
    </div>
  )
}

export default function BacklogRoulette({ isOpen, onClose, games = [] }) {
  const navigate = useNavigate()
  const { reduced } = useMotionPreference()

  // 'idle' | 'spinning' | 'done'
  const [phase, setPhase] = useState('idle')
  const [winner, setWinner] = useState(null)
  const [strip, setStrip] = useState([])
  const [spinKey, setSpinKey] = useState(0)

  // Keep refs to latest values so the auto-spin effect is stable
  const gamesRef = useRef(games)
  const reducedRef = useRef(reduced)
  useEffect(() => { gamesRef.current = games }, [games])
  useEffect(() => { reducedRef.current = reduced }, [reduced])

  // Auto-spin when the sheet opens
  useEffect(() => {
    if (!isOpen || !gamesRef.current.length) return
    runSpin(gamesRef.current, reducedRef.current)
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset state a beat after the sheet closes (lets exit animation finish)
  useEffect(() => {
    if (isOpen) return
    const t = setTimeout(() => {
      setPhase('idle')
      setWinner(null)
      setStrip([])
    }, 340)
    return () => clearTimeout(t)
  }, [isOpen])

  function runSpin(g, r) {
    const picked = g[Math.floor(Math.random() * g.length)]
    setWinner(picked)
    if (r) {
      setPhase('done')
      hapticSuccess()
      return
    }
    setStrip(buildStrip(g, picked))
    setSpinKey((k) => k + 1)
    setPhase('spinning')
    hapticImpact('Medium')
  }

  const handleSpinAgain = useCallback(() => {
    if (!games.length) return
    runSpin(games, reduced)
  }, [games, reduced])

  const handleAnimationComplete = useCallback(() => {
    if (phase === 'spinning') {
      setPhase('done')
      hapticSuccess()
    }
  }, [phase])

  const handleViewGame = () => {
    if (!winner) return
    onClose()
    navigate(`/game/${winner.id}`, { state: { coverImage: winner.image } })
  }

  const finalY = -(STRIP_LEN - 1) * ITEM_H

  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.15 }
  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="roulette-overlay"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Backlog Roulette"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <motion.div
            className="roulette-sheet"
            onClick={(e) => e.stopPropagation()}
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? {} : { y: '100%' }}
            transition={sheetTransition}
          >
            {/* Drag handle */}
            <div className="roulette-handle" aria-hidden="true" />

            {/* Header */}
            <div className="roulette-header">
              <span className="roulette-header-emoji" aria-hidden="true">🎰</span>
              <h2 className="roulette-title">Backlog Roulette</h2>
              <button
                type="button"
                className="roulette-close"
                onClick={onClose}
                aria-label="Close Backlog Roulette"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            {/* Body — slot machine OR result */}
            <div className="roulette-body">
              <AnimatePresence mode="wait">

                {/* Spinning state — animated strip */}
                {phase === 'spinning' && (
                  <motion.div
                    key="spinning"
                    className="roulette-slot-stage"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                  >
                    <div className="roulette-window" aria-hidden="true">
                      <div className="roulette-mask roulette-mask--top" />
                      <div className="roulette-mask roulette-mask--bottom" />
                      <motion.div
                        key={spinKey}
                        className="roulette-strip"
                        initial={{ y: 0 }}
                        animate={{ y: finalY }}
                        transition={{
                          duration: 2.3,
                          ease: [0.08, 0.9, 0.18, 1.0],
                        }}
                        onAnimationComplete={handleAnimationComplete}
                      >
                        {strip.map((game, i) => (
                          <SlotCover key={i} game={game} />
                        ))}
                      </motion.div>
                    </div>
                    <p className="roulette-spinning-label" aria-live="polite">
                      Picking your next game…
                    </p>
                  </motion.div>
                )}

                {/* Done state — winner reveal */}
                {phase === 'done' && winner && (
                  <motion.div
                    key="done"
                    className="roulette-result"
                    initial={reduced ? {} : { opacity: 0, scale: 0.9, y: 12 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={
                      reduced
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 320, damping: 26 }
                    }
                  >
                    <div
                      className="roulette-result-cover"
                      role="img"
                      aria-label={winner.title}
                    >
                      {winner.image ? (
                        <img
                          src={winner.image}
                          alt={winner.title}
                          className="roulette-result-img"
                          onError={(e) => { e.target.src = COVER_FALLBACK }}
                        />
                      ) : (
                        <div className="roulette-result-fallback">
                          {winner.title?.charAt(0) || '?'}
                        </div>
                      )}
                    </div>
                    <div className="roulette-result-info">
                      <p className="roulette-result-eyebrow">Your pick</p>
                      <h3 className="roulette-result-name">{winner.title}</h3>
                      {winner.developer && (
                        <p className="roulette-result-dev">{winner.developer}</p>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* Idle placeholder (brief moment before auto-spin resolves) */}
                {phase === 'idle' && (
                  <motion.div
                    key="idle"
                    className="roulette-idle-placeholder"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  />
                )}

              </AnimatePresence>
            </div>

            {/* Action buttons */}
            <div className="roulette-actions">
              <button
                type="button"
                className="roulette-btn roulette-btn--ghost"
                onClick={handleSpinAgain}
                disabled={phase === 'spinning'}
                aria-label="Spin again"
              >
                <Shuffle size={15} strokeWidth={2.2} aria-hidden="true" />
                Spin Again
              </button>
              <button
                type="button"
                className="roulette-btn roulette-btn--primary"
                onClick={handleViewGame}
                disabled={phase !== 'done' || !winner}
                aria-label={winner ? `View ${winner.title}` : 'View game'}
              >
                View Game
                <ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

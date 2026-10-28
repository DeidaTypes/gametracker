import React, { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { Shuffle, ChevronRight } from 'lucide-react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { contentSwap } from '../motion/xMotion'
import CenteredModal from './CenteredModal'
import { COVER_FALLBACK } from '../utils/coverFallback'
import { getGameNavStub } from '../utils/gameNavStub'
import { hapticImpact, hapticSuccess } from '../utils/haptics'
import './BacklogRoulette.css'

/**
 * BacklogRoulette — randomly picks one backlog game (centered popup).
 *
 * Slot-pull animation (22-item vertical strip decelerates to land on winner).
 * Reduced-motion: instant reveal, no animation.
 *
 * Props:
 *   isOpen   boolean
 *   onClose  () => void
 *   games    array of backlog game objects
 */

const COVER_H = 138
const STRIP_LEN = 22
const ITEM_H = COVER_H

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

  const [phase, setPhase] = useState('idle')
  const [winner, setWinner] = useState(null)
  const [strip, setStrip] = useState([])
  const [spinKey, setSpinKey] = useState(0)

  const gamesRef = useRef(games)
  const reducedRef = useRef(reduced)
  useEffect(() => { gamesRef.current = games }, [games])
  useEffect(() => { reducedRef.current = reduced }, [reduced])

  useEffect(() => {
    if (!isOpen || !gamesRef.current.length) return
    runSpin(gamesRef.current, reducedRef.current)
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isOpen) return
    const t = setTimeout(() => {
      setPhase('idle')
      setWinner(null)
      setStrip([])
    }, 280)
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
    navigate(`/game/${winner.id}`, { state: getGameNavStub(winner) })
  }

  const finalY = -(STRIP_LEN - 1) * ITEM_H

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Backlog Roulette"
      maxWidth={400}
      className="roulette-card"
    >
      <header className="roulette-top">
        <span aria-hidden="true" />
        <h2 className="roulette-top__title text-title">Backlog Roulette</h2>
        <button type="button" className="roulette-top__done" onClick={onClose}>
          Done
        </button>
      </header>

      <div className="roulette-body">
        <AnimatePresence mode="wait">

          {phase === 'spinning' && (
            <motion.div
              key="spinning"
              className="roulette-slot-stage"
              {...contentSwap(reduced)}
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

          {phase === 'idle' && (
            <motion.div
              key="idle"
              className="roulette-idle-placeholder"
              {...contentSwap(reduced)}
            />
          )}

        </AnimatePresence>
      </div>

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
    </CenteredModal>
  )
}

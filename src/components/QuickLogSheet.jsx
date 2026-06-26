import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { LuClock, LuChevronRight } from 'react-icons/lu'
import { logManualSession } from '../services/sessionService'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { showToast } from './Toast'
import GamePickerSheet from './GamePickerSheet'
import './QuickLogSheet.css'

const PRESETS = [
  { minutes: 15, label: '15m' },
  { minutes: 30, label: '30m' },
  { minutes: 60, label: '1h' },
  { minutes: 120, label: '2h' },
]

/**
 * QuickLogSheet — bottom sheet for fast manual session logging.
 *
 * Flow: sheet opens pre-filled with the smart-default game → user taps a
 * duration preset → logManualSession fires → toast + close.  Two taps from
 * the moment the sheet is open.
 *
 * Props:
 *   isOpen       boolean
 *   onClose      () => void
 *   defaultGame  { id, title, image } | null   — pre-filled game (smart default)
 *   returnFocusRef  React ref — element to return focus to on close
 */
function QuickLogSheet({ isOpen, onClose, defaultGame = null, returnFocusRef }) {
  const [game, setGame] = useState(defaultGame)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const sheetRef = useRef(null)
  const { reduced } = useMotionPreference()

  // Sync game when the sheet opens with a new defaultGame
  useEffect(() => {
    if (isOpen) setGame(defaultGame)
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Focus trap: focus first interactive element when sheet opens
  useEffect(() => {
    if (!isOpen) return
    const id = setTimeout(() => sheetRef.current?.focus(), 50)
    return () => clearTimeout(id)
  }, [isOpen])

  // Keyboard: Escape closes
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => {
    onClose()
    // Return focus to the element that opened this sheet
    const id = setTimeout(() => returnFocusRef?.current?.focus(), 60)
    return () => clearTimeout(id)
  }

  const handlePreset = async (minutes) => {
    if (!game || loading) return
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const res = await logManualSession(game.id, minutes, today, {
      gameTitle: game.title,
      gameImage: game.image,
    })
    setLoading(false)
    if (res) {
      const label = minutes < 60 ? `${minutes} min` : `${minutes / 60}h`
      showToast(`Logged ${label} of ${game.title}`, 'success')
      try { window.dispatchEvent(new Event('libraryUpdated')) } catch {}
      onClose()
    } else {
      showToast('Could not log session — try again', 'error')
    }
  }

  const handleGamePicked = (picked) => {
    setGame(picked)
    setPickerOpen(false)
  }

  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.15 }
  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }

  return createPortal(
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="qls-overlay"
            onClick={handleClose}
            aria-modal="true"
            role="dialog"
            aria-label="Log a session"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={backdropTransition}
          >
            <motion.div
              ref={sheetRef}
              className="qls-sheet"
              onClick={(e) => e.stopPropagation()}
              tabIndex={-1}
              initial={reduced ? false : { y: '100%' }}
              animate={{ y: 0 }}
              exit={reduced ? { y: 0 } : { y: '100%' }}
              transition={sheetTransition}
            >
              <div className="qls-handle" aria-hidden="true" />

              <div className="qls-header">
                <LuClock size={16} aria-hidden="true" className="qls-header__icon" />
                <span className="qls-header__text">Just played?</span>
              </div>

              {/* Game selector row — tap to change game */}
              <button
                type="button"
                className="qls-game-row"
                onClick={() => setPickerOpen(true)}
                aria-label={game ? `Change game: ${game.title}` : 'Pick a game'}
              >
                {game?.image ? (
                  <img
                    src={game.image}
                    alt={game.title}
                    className="qls-game-cover"
                    loading="eager"
                  />
                ) : (
                  <div className="qls-game-cover qls-game-cover--placeholder" aria-hidden="true">
                    {game?.title?.[0] ?? '?'}
                  </div>
                )}
                <span className="qls-game-title">
                  {game?.title ?? 'Pick a game…'}
                </span>
                <LuChevronRight size={16} className="qls-game-chevron" aria-hidden="true" />
              </button>

              {/* Duration presets — the second tap */}
              <div className="qls-presets" role="group" aria-label="How long did you play?">
                {PRESETS.map(({ minutes, label }) => (
                  <button
                    key={minutes}
                    type="button"
                    className="qls-preset-btn"
                    onClick={() => handlePreset(minutes)}
                    disabled={!game || loading}
                    aria-label={`Log ${label}`}
                  >
                    {loading ? (
                      <span className="qls-preset-spinner" aria-hidden="true" />
                    ) : (
                      label
                    )}
                  </button>
                ))}
              </div>

              <div className="qls-divider" aria-hidden="true" />

              <button
                type="button"
                className="qls-cancel-btn"
                onClick={handleClose}
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Game picker — separate modal so QuickLogSheet doesn't shift */}
      <GamePickerSheet
        isOpen={pickerOpen}
        onSelect={handleGamePicked}
        onCancel={() => setPickerOpen(false)}
      />
    </>,
    document.body,
  )
}

export default QuickLogSheet

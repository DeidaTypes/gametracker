import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useNavDim } from '../hooks/useNavDim'
import KeyboardAwareView from './KeyboardAwareView'
import './SetGoalSheet.css'

/**
 * SetGoalSheet — bottom sheet for setting / editing the yearly game challenge.
 *
 * Props:
 *   isOpen    {boolean}
 *   onClose   {() => void}
 *   onSave    {(target: number) => void}
 *   year      {number}    — the challenge year
 *   current   {number}    — current target (0 = not set)
 */
export default function SetGoalSheet({ isOpen, onClose, onSave, year, current = 0 }) {
  const { reduced } = useMotionPreference()
  const inputRef = useRef(null)
  const [value, setValue] = useState(String(current || ''))
  const [saving, setSaving] = useState(false)

  // Drop the bottom nav below this sheet while it's open (see BottomNav.css).
  useNavDim(isOpen)

  // Reset input when sheet opens
  useEffect(() => {
    if (isOpen) {
      setValue(String(current || ''))
      setSaving(false)
      // Focus the input after the animation settles
      const t = setTimeout(() => inputRef.current?.focus(), 200)
      return () => clearTimeout(t)
    }
  }, [isOpen, current])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const numVal = parseInt(value, 10)
  const valid  = !isNaN(numVal) && numVal >= 1 && numVal <= 9999

  async function handleSave() {
    if (!valid || saving) return
    setSaving(true)
    await onSave(numVal)
    setSaving(false)
    onClose()
  }

  function handleKey(e) {
    if (e.key === 'Enter') handleSave()
  }

  const springProps = reduced
    ? {}
    : { type: 'spring', stiffness: 380, damping: 34 }

  const content = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="sgs-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.15 }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Sheet */}
          <KeyboardAwareView mode="sheet" className="sgs-anchor">
            <motion.div
              className="sgs-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={`Set ${year} games goal`}
              initial={reduced ? {} : { y: '100%' }}
              animate={reduced ? {} : { y: 0 }}
              exit={reduced ? {} : { y: '100%' }}
              transition={springProps}
            >
              <div className="sgs-handle" aria-hidden="true" />

              <h2 className="sgs-title">Games in {year}</h2>
              <p className="sgs-sub">
                How many games do you want to finish this year?
              </p>

              <div className="sgs-input-row">
                <input
                  ref={inputRef}
                  className="sgs-input"
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={1}
                  max={9999}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="e.g. 24"
                  aria-label="Target number of games"
                />
                <span className="sgs-input-unit">games</span>
              </div>

              {value !== '' && !valid && (
                <p className="sgs-hint" role="alert">Enter a number between 1 and 9999.</p>
              )}

              <button
                type="button"
                className="sgs-save-btn"
                onClick={handleSave}
                disabled={!valid || saving}
                aria-disabled={!valid || saving}
              >
                {saving ? 'Saving…' : current ? 'Update goal' : 'Set goal'}
              </button>

              <button
                type="button"
                className="sgs-cancel-btn"
                onClick={onClose}
              >
                Cancel
              </button>
            </motion.div>
          </KeyboardAwareView>
        </>
      )}
    </AnimatePresence>
  )

  return createPortal(content, document.body)
}

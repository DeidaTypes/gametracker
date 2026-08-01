import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { LuX } from 'react-icons/lu'
import { updateProfile } from '../services/profileService'
import { supabase } from '../services/supabase'
import { useMotionPreference } from '../hooks/useMotionPreference'
import KeyboardAwareView from './KeyboardAwareView'
import './BioEditSheet.css'

const BIO_MAX = 150

/**
 * BioEditSheet — bottom sheet for inline bio editing directly from
 * the Profile hero. Opens over the current screen; does NOT navigate.
 *
 * Props:
 *   isOpen      – boolean
 *   onClose     – () => void
 *   currentBio  – string (pre-fills the textarea)
 *   onSave      – (updatedProfile) => void  called after optimistic save
 */
function BioEditSheet({ isOpen, onClose, currentBio = '', onSave }) {
  const [text, setText] = useState(currentBio)
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef(null)
  const sheetRef = useRef(null)
  const { reduced } = useMotionPreference()

  // Sync textarea text whenever the sheet opens or the current bio changes
  useEffect(() => {
    if (isOpen) setText(currentBio)
  }, [isOpen, currentBio])

  // Auto-focus textarea so the keyboard appears immediately on iOS
  useEffect(() => {
    if (!isOpen) return
    const id = setTimeout(() => textareaRef.current?.focus(), 120)
    return () => clearTimeout(id)
  }, [isOpen])

  // Move focus to the sheet container for keyboard / screen-reader users
  useEffect(() => {
    if (!isOpen) return
    const id = setTimeout(() => sheetRef.current?.focus(), 50)
    return () => clearTimeout(id)
  }, [isOpen])

  // Escape key closes without saving
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const handleSave = async () => {
    if (saving || text.length > BIO_MAX) return
    setSaving(true)

    const trimmed = text.trim()

    // Optimistic update — localStorage is source of truth for the
    // current session; Supabase sync happens in the background.
    const updated = updateProfile({ bio: trimmed })
    onSave(updated)
    onClose()

    // Best-effort sync to Supabase. Soft-fails when offline or
    // when the column doesn't exist — localStorage value applies.
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('users').update({ bio: trimmed }).eq('id', user.id)
      }
    } catch {
      // offline / signed-out — fine, localStorage is canonical
    }

    setSaving(false)
  }

  const overLimit = text.length > BIO_MAX

  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.15 }
  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="bio-edit-overlay"
          onClick={onClose}
          aria-modal="true"
          role="dialog"
          aria-label="Edit bio"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <KeyboardAwareView mode="sheet" className="bio-edit-anchor">
          <motion.div
            ref={sheetRef}
            className="bio-edit-sheet"
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? { y: 0 } : { y: '100%' }}
            transition={sheetTransition}
          >
            <div className="bio-edit-sheet__handle" aria-hidden="true" />

            <div className="bio-edit-sheet__header">
              <button
                type="button"
                className="bio-edit-sheet__dismiss"
                onClick={onClose}
                aria-label="Cancel"
              >
                <LuX size={20} aria-hidden="true" />
              </button>
              <span className="bio-edit-sheet__title">Bio</span>
              <button
                type="button"
                className="bio-edit-sheet__save"
                onClick={handleSave}
                disabled={overLimit || saving}
              >
                Save Changes
              </button>
            </div>

            <textarea
              ref={textareaRef}
              className="bio-edit-sheet__textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Tell people what you play…"
              rows={4}
              aria-label="Bio"
            />

            <p
              className={`bio-edit-sheet__counter${
                overLimit ? ' bio-edit-sheet__counter--over' : ''
              }`}
              aria-live="polite"
            >
              {text.length}/{BIO_MAX}
            </p>
          </motion.div>
          </KeyboardAwareView>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default BioEditSheet

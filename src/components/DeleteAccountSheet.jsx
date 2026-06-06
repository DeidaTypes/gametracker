import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { LuX, LuTriangleAlert } from 'react-icons/lu'
import { useMotionPreference } from '../hooks/useMotionPreference'
import './DeleteAccountSheet.css'

const REASON_OPTIONS = [
  { value: '', label: 'Reason for leaving (optional)' },
  { value: 'not_using', label: 'Not using the app' },
  { value: 'notifications', label: 'Too many notifications' },
  { value: 'privacy', label: 'Privacy concerns' },
  { value: 'other', label: 'Other' },
]

/**
 * DeleteAccountSheet — two-step Apple-compliant account deletion flow.
 *
 * Step 1: Informational — explains what deletion means + 30-day window.
 * Step 2: Intent confirmation — user must type "DELETE" (case-sensitive)
 *         before the destructive button becomes active.
 *
 * Props:
 *   isOpen      – boolean
 *   onClose     – () => void
 *   onConfirm   – (reason: string|null) => Promise<void>
 *                 Called with the selected churn reason (or null).
 *                 Should call the delete-account Edge Function.
 *   isDeleting  – boolean  passed back from parent while the API call
 *                 is in flight; disables buttons & shows loading state.
 */
function DeleteAccountSheet({ isOpen, onClose, onConfirm, isDeleting = false }) {
  const [step, setStep] = useState(1)
  const [confirmText, setConfirmText] = useState('')
  const [reason, setReason] = useState('')
  const inputRef = useRef(null)
  const sheetRef = useRef(null)
  const { reduced } = useMotionPreference()

  // Reset to step 1 whenever the sheet opens fresh.
  useEffect(() => {
    if (isOpen) {
      setStep(1)
      setConfirmText('')
      setReason('')
    }
  }, [isOpen])

  // Auto-focus the text input when step 2 becomes active.
  useEffect(() => {
    if (isOpen && step === 2) {
      const id = setTimeout(() => inputRef.current?.focus(), 120)
      return () => clearTimeout(id)
    }
  }, [isOpen, step])

  // Focus sheet container for keyboard / screen-reader nav.
  useEffect(() => {
    if (!isOpen) return
    const id = setTimeout(() => sheetRef.current?.focus(), 50)
    return () => clearTimeout(id)
  }, [isOpen])

  // Escape key closes.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const canDelete = confirmText === 'DELETE' && !isDeleting

  const handleConfirm = async () => {
    if (!canDelete) return
    await onConfirm(reason || null)
  }

  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.15 }
  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="del-acct-overlay"
          onClick={onClose}
          aria-modal="true"
          role="dialog"
          aria-labelledby="del-acct-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <motion.div
            ref={sheetRef}
            className="del-acct-sheet"
            onClick={(e) => e.stopPropagation()}
            tabIndex={-1}
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? { y: 0 } : { y: '100%' }}
            transition={sheetTransition}
          >
            <div className="del-acct-sheet__handle" aria-hidden="true" />

            {/* ── Header ── */}
            <div className="del-acct-sheet__header">
              <button
                type="button"
                className="del-acct-sheet__close"
                onClick={onClose}
                aria-label="Cancel"
                disabled={isDeleting}
              >
                <LuX size={20} aria-hidden="true" />
              </button>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {step === 1 ? (
                <motion.div
                  key="step1"
                  className="del-acct-sheet__body"
                  initial={reduced ? false : { opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, x: -24 }}
                  transition={reduced ? { duration: 0 } : { duration: 0.18 }}
                >
                  <div className="del-acct-sheet__icon" aria-hidden="true">
                    <LuTriangleAlert size={32} />
                  </div>

                  <h2 id="del-acct-title" className="del-acct-sheet__title">
                    Delete your account?
                  </h2>

                  <p className="del-acct-sheet__body-text">
                    This will permanently remove your profile, reviews, lists, and
                    messages from GameTracker. You have{' '}
                    <strong>30 days to change your mind</strong> by signing in —
                    after that, your data is gone forever.
                  </p>

                  <div className="del-acct-sheet__actions">
                    <button
                      type="button"
                      className="del-acct-btn del-acct-btn--secondary"
                      onClick={onClose}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="del-acct-btn del-acct-btn--danger"
                      onClick={() => setStep(2)}
                    >
                      Continue
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="step2"
                  className="del-acct-sheet__body"
                  initial={reduced ? false : { opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, x: -24 }}
                  transition={reduced ? { duration: 0 } : { duration: 0.18 }}
                >
                  <div className="del-acct-sheet__icon del-acct-sheet__icon--danger" aria-hidden="true">
                    <LuTriangleAlert size={32} />
                  </div>

                  <h2 id="del-acct-title" className="del-acct-sheet__title">
                    Are you sure?
                  </h2>

                  <p className="del-acct-sheet__body-text">
                    Type <strong className="del-acct-sheet__keyword">DELETE</strong> below
                    to confirm.
                  </p>

                  <div className="del-acct-sheet__field">
                    <input
                      ref={inputRef}
                      type="text"
                      className="del-acct-sheet__input"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="DELETE"
                      aria-label="Type DELETE to confirm account deletion"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={isDeleting}
                    />
                    {confirmText.length > 0 && confirmText !== 'DELETE' && (
                      <p className="del-acct-sheet__input-hint" role="alert">
                        Must be exactly DELETE (case-sensitive)
                      </p>
                    )}
                  </div>

                  <div className="del-acct-sheet__field">
                    <select
                      className="del-acct-sheet__select"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      disabled={isDeleting}
                      aria-label="Reason for leaving"
                    >
                      {REASON_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="del-acct-sheet__actions">
                    <button
                      type="button"
                      className="del-acct-btn del-acct-btn--secondary"
                      onClick={onClose}
                      disabled={isDeleting}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={`del-acct-btn del-acct-btn--danger${
                        !canDelete ? ' del-acct-btn--disabled' : ''
                      }`}
                      onClick={handleConfirm}
                      disabled={!canDelete}
                      aria-disabled={!canDelete}
                    >
                      {isDeleting ? 'Deleting…' : 'Delete my account'}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default DeleteAccountSheet

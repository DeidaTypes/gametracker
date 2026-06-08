import React, { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { LuX, LuTriangleAlert } from 'react-icons/lu'
import { useMotionPreference } from '../hooks/useMotionPreference'
import CenteredModal from './CenteredModal'
import './DeleteAccountSheet.css'

const REASON_OPTIONS = [
  { value: '', label: 'Reason for leaving (optional)' },
  { value: 'not_using', label: 'Not using the app' },
  { value: 'notifications', label: 'Too many notifications' },
  { value: 'privacy', label: 'Privacy concerns' },
  { value: 'other', label: 'Other' },
]

/**
 * DeleteAccountSheet — two-step Apple-compliant account deletion flow,
 * presented as a centered popup (CenteredModal).
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
  const { reduced } = useMotionPreference()

  // Reset to step 1 whenever the dialog opens fresh.
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

  const canDelete = confirmText === 'DELETE' && !isDeleting

  const handleConfirm = async () => {
    if (!canDelete) return
    await onConfirm(reason || null)
  }

  return (
    <CenteredModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Delete account"
      maxWidth={400}
      className="del-acct-sheet"
    >
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

      <div className="del-acct-sheet__scroll cm-scroll">
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
      </div>
    </CenteredModal>
  )
}

export default DeleteAccountSheet

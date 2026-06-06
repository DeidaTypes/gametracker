import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { LuHeartHandshake } from 'react-icons/lu'
import { useMotionPreference } from '../hooks/useMotionPreference'
import './AccountRecoverySheet.css'

/**
 * AccountRecoverySheet — shown immediately after sign-in when the user's
 * account is pending deletion (deleted_at IS NOT NULL and within 30 days).
 *
 * Props:
 *   isOpen         – boolean
 *   daysRemaining  – number   days until hard-delete
 *   onRestore      – () => Promise<void>   calls restore_deleted_account RPC
 *   onContinue     – () => void  user wants to keep deleting; sign them out
 *   isRestoring    – boolean   in-flight state for the Restore button
 */
function AccountRecoverySheet({
  isOpen,
  daysRemaining,
  onRestore,
  onContinue,
  isRestoring = false,
}) {
  const sheetRef = useRef(null)
  const { reduced } = useMotionPreference()

  useEffect(() => {
    if (!isOpen) return
    const id = setTimeout(() => sheetRef.current?.focus(), 50)
    return () => clearTimeout(id)
  }, [isOpen])

  const backdropTransition = reduced ? { duration: 0 } : { duration: 0.15 }
  const sheetTransition = reduced
    ? { duration: 0 }
    : { type: 'spring', stiffness: 380, damping: 32 }

  const dayLabel = daysRemaining === 1 ? '1 day' : `${daysRemaining} days`

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="acct-recovery-overlay"
          aria-modal="true"
          role="dialog"
          aria-labelledby="acct-recovery-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
        >
          <motion.div
            ref={sheetRef}
            className="acct-recovery-sheet"
            tabIndex={-1}
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? { y: 0 } : { y: '100%' }}
            transition={sheetTransition}
          >
            <div className="acct-recovery-sheet__handle" aria-hidden="true" />

            <div className="acct-recovery-sheet__body">
              <div className="acct-recovery-sheet__icon" aria-hidden="true">
                <LuHeartHandshake size={32} />
              </div>

              <h2 id="acct-recovery-title" className="acct-recovery-sheet__title">
                Welcome back.
              </h2>

              <p className="acct-recovery-sheet__text">
                Your account is scheduled for deletion in{' '}
                <strong>{dayLabel}</strong>. Restore it to keep your profile,
                reviews, and library.
              </p>

              <div className="acct-recovery-sheet__actions">
                <button
                  type="button"
                  className="acct-recovery-btn acct-recovery-btn--primary"
                  onClick={onRestore}
                  disabled={isRestoring}
                >
                  {isRestoring ? 'Restoring…' : 'Restore my account'}
                </button>
                <button
                  type="button"
                  className="acct-recovery-btn acct-recovery-btn--ghost"
                  onClick={onContinue}
                  disabled={isRestoring}
                >
                  Continue deletion
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default AccountRecoverySheet

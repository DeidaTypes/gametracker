import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import {
  LuX,
  LuChevronRight,
  LuUserPen,
  LuShare2,
  LuSparkles,
  LuSettings,
} from 'react-icons/lu'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useSheetDrag } from '../motion/useSheetDrag'
import './SettingsSheet.css'

function SettingsRow({ icon, label, onClick, disabled = false, chevron = false }) {
  return (
    <button
      type="button"
      className={`settings-sheet__row${disabled ? ' settings-sheet__row--disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="settings-sheet__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="settings-sheet__main">
        <span className="settings-sheet__label">{label}</span>
        {chevron ? (
          <LuChevronRight className="settings-sheet__chevron" size={16} aria-hidden="true" />
        ) : null}
      </span>
    </button>
  )
}

/**
 * SettingsSheet — the signed-in user's own profile "⋯" sheet.
 * Exactly four rows, and the only door into Settings:
 *   Edit profile  — opens EditProfileModal in place
 *   Share profile — existing share handler
 *   Your Wrapped  — existing wrapped handler
 *   Settings      — navigate('/settings'), the hub at the top
 * Settings is the only row with a chevron. The visitor overflow sheet
 * is a separate ActionSheet and is not this component.
 */
function SettingsSheet({
  isOpen,
  onClose,
  onEditProfile,
  onShareProfile,
  onWrapped,
  wrappedLabel = 'Your Wrapped',
  wrappedDisabled = false,
}) {
  const navigate = useNavigate()
  const { reduced } = useMotionPreference()
  const sheetRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    const id = setTimeout(() => sheetRef.current?.focus(), 50)
    return () => clearTimeout(id)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  const go = (fn) => {
    onClose()
    fn?.()
  }

  const { transition, dragProps, startDrag } = useSheetDrag(reduced, onClose)

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="settings-sheet-overlay"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
        >
          <motion.div
            ref={sheetRef}
            className="settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Profile actions"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            initial={reduced ? false : { y: '100%' }}
            animate={{ y: 0 }}
            exit={reduced ? { y: 0 } : { y: '100%' }}
            transition={transition}
            {...dragProps}
          >
            <div className="settings-sheet__handle" aria-hidden="true" onPointerDown={startDrag} />

            <div className="settings-sheet__header">
              <button
                type="button"
                className="settings-sheet__close"
                onClick={onClose}
                aria-label="Close"
              >
                <LuX size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="settings-sheet__body">
              <SettingsRow
                icon={<LuUserPen size={18} />}
                label="Edit profile"
                onClick={() => go(onEditProfile)}
              />
              <SettingsRow
                icon={<LuShare2 size={18} />}
                label="Share profile"
                onClick={() => go(onShareProfile)}
              />
              <SettingsRow
                icon={<LuSparkles size={18} />}
                label={wrappedLabel}
                onClick={() => go(onWrapped)}
                disabled={wrappedDisabled}
              />
              <SettingsRow
                icon={<LuSettings size={18} />}
                label="Settings"
                chevron
                onClick={() => go(() => navigate('/settings'))}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export default SettingsSheet

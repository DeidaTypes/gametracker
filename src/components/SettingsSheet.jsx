import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import {
  LuX,
  LuChevronRight,
  LuUserPen,
  LuShare2,
  LuSparkles,
  LuBell,
  LuLock,
  LuMail,
  LuInfo,
} from 'react-icons/lu'
import { useMotionPreference } from '../hooks/useMotionPreference'
import { useAuth } from '../contexts/AuthContext'
import { showToast } from './Toast'
import ActionSheet from './ActionSheet'
import { buildFeedbackMailto } from '../services/feedbackService'
import { openMailto } from '../utils/mailto'
import './SettingsSheet.css'

const FEEDBACK_EMAIL = 'feedback@gametracker.app'

function SettingsRow({ icon, tone = 'cobalt', label, onClick, disabled = false }) {
  return (
    <button
      type="button"
      className={`settings-sheet__row${disabled ? ' settings-sheet__row--disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className={`settings-sheet__tile settings-sheet__tile--${tone}`} aria-hidden="true">
        {icon}
      </span>
      <span className="settings-sheet__label">{label}</span>
      <LuChevronRight className="settings-sheet__chevron" size={18} aria-hidden="true" />
    </button>
  )
}

function SettingsGroup({ title, children }) {
  return (
    <section className="settings-sheet__group">
      <h2 className="settings-sheet__group-title">{title}</h2>
      <div className="settings-sheet__group-rows">{children}</div>
    </section>
  )
}

/**
 * SettingsSheet — grouped bottom sheet opened from the "⋯" overflow
 * button on the signed-in user's own profile. Replaces the old flat
 * ActionSheet list (Edit profile / Share profile / Wrapped / Settings).
 *
 * Destination reality check (keep this comment in sync with the rows
 * below — it's the map of what's real vs. placeholder):
 *   - Edit profile, Share profile, Your Wrapped — real. Wired to the
 *     exact same handlers the old flat sheet used.
 *   - Privacy, About — real. Neither has its own dedicated screen; they
 *     route to the full /settings page (which already has "Privacy &
 *     Safety" and "About" sections) and deep-link to that section via a
 *     hash anchor so the tap actually lands somewhere useful instead of
 *     a generic page top.
 *   - Send feedback — real. Opens a mailto to the support address with
 *     a diagnostic block (app version/build, iOS version, device model,
 *     user id — never email or other personal data) pre-filled in the
 *     body. If no mail client picks up the mailto: link (e.g. Mail was
 *     deleted from the device), falls back to an action sheet with the
 *     address so the user can copy it instead of tapping into nothing.
 *   - Notifications — PLACEHOLDER. There is no notification-preferences
 *     screen anywhere in the app (the /notifications route is the
 *     activity inbox, a different feature). Tapping it shows a
 *     "coming soon" toast — the same pattern already used elsewhere in
 *     the app (ListDetail sort) — instead of shipping a dead row that
 *     silently does nothing.
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
  const { user, logOut } = useAuth()
  const { reduced } = useMotionPreference()
  const sheetRef = useRef(null)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [feedbackFallbackOpen, setFeedbackFallbackOpen] = useState(false)

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

  const handleNotifications = () => {
    showToast('Notification settings coming soon', 'info')
  }

  const handleSendFeedback = async () => {
    onClose()
    const mailtoUrl = await buildFeedbackMailto(FEEDBACK_EMAIL, user?.id)
    const opened = await openMailto(mailtoUrl)
    if (!opened) setFeedbackFallbackOpen(true)
  }

  const handleCopyFeedbackEmail = async () => {
    try {
      await navigator.clipboard.writeText(FEEDBACK_EMAIL)
      showToast('Email address copied', 'success')
    } catch {
      showToast(FEEDBACK_EMAIL, 'info', 4000)
    }
  }

  const handlePrivacy = () => {
    onClose()
    navigate('/settings#settings-section-privacy')
  }

  const handleAbout = () => {
    onClose()
    navigate('/settings#settings-section-about')
  }

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logOut()
      setLogoutConfirmOpen(false)
      onClose()
      navigate('/login', { replace: true })
    } catch (err) {
      console.error('[settings-sheet] log out failed:', err)
      showToast(err?.message || 'Could not log out. Try again.', 'error')
      setLoggingOut(false)
    }
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
            className="settings-sheet-overlay"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={backdropTransition}
          >
            <motion.div
              ref={sheetRef}
              className="settings-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Settings"
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
              initial={reduced ? false : { y: '100%' }}
              animate={{ y: 0 }}
              exit={reduced ? { y: 0 } : { y: '100%' }}
              transition={sheetTransition}
            >
              <div className="settings-sheet__handle" aria-hidden="true" />

              <header className="settings-sheet__header">
                <h1 className="settings-sheet__title">Settings</h1>
                <button
                  type="button"
                  className="settings-sheet__close"
                  onClick={onClose}
                  aria-label="Close settings"
                >
                  <LuX size={20} aria-hidden="true" />
                </button>
              </header>

              <div className="settings-sheet__body">
                <SettingsGroup title="Account">
                  <SettingsRow
                    icon={<LuUserPen size={18} />}
                    tone="cobalt"
                    label="Edit profile"
                    onClick={() => go(onEditProfile)}
                  />
                  <SettingsRow
                    icon={<LuShare2 size={18} />}
                    tone="purple"
                    label="Share profile"
                    onClick={() => go(onShareProfile)}
                  />
                  <SettingsRow
                    icon={<LuSparkles size={18} />}
                    tone="green"
                    label={wrappedLabel}
                    onClick={() => go(onWrapped)}
                    disabled={wrappedDisabled}
                  />
                </SettingsGroup>

                <SettingsGroup title="Preferences">
                  <SettingsRow
                    icon={<LuBell size={18} />}
                    tone="cobalt"
                    label="Notifications"
                    onClick={handleNotifications}
                  />
                  <SettingsRow
                    icon={<LuLock size={18} />}
                    tone="cobalt"
                    label="Privacy"
                    onClick={handlePrivacy}
                  />
                </SettingsGroup>

                <SettingsGroup title="Support">
                  <SettingsRow
                    icon={<LuMail size={18} />}
                    tone="neutral"
                    label="Send feedback"
                    onClick={handleSendFeedback}
                  />
                  <SettingsRow
                    icon={<LuInfo size={18} />}
                    tone="neutral"
                    label="About"
                    onClick={handleAbout}
                  />
                </SettingsGroup>

                <button
                  type="button"
                  className="settings-sheet__logout"
                  onClick={() => setLogoutConfirmOpen(true)}
                >
                  Log out
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ActionSheet
        isOpen={logoutConfirmOpen}
        onClose={() => !loggingOut && setLogoutConfirmOpen(false)}
        title="Log out of Checkpoint?"
        items={[
          {
            label: loggingOut ? 'Logging out…' : 'Log out',
            onClick: handleLogout,
            destructive: true,
            disabled: loggingOut,
          },
        ]}
      />

      <ActionSheet
        isOpen={feedbackFallbackOpen}
        onClose={() => setFeedbackFallbackOpen(false)}
        title="No mail app found"
        items={[
          {
            label: `Copy ${FEEDBACK_EMAIL}`,
            onClick: handleCopyFeedbackEmail,
          },
        ]}
      />
    </>,
    document.body
  )
}

export default SettingsSheet

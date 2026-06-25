import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LuChevronLeft,
  LuChevronRight,
  LuLock,
  LuLogOut,
  LuPalette,
  LuShare2,
  LuStar,
} from 'react-icons/lu'
import { useAuth } from '../contexts/AuthContext'
import { showToast } from '../components/Toast'
import ActionSheet from '../components/ActionSheet'
import IOSSwitch from '../components/IOSSwitch'
import SettingsPickerSheet from '../components/SettingsPickerSheet'
import DeleteAccountSheet from '../components/DeleteAccountSheet'
import { deleteAccount } from '../services/deleteAccountService'
import {
  getSettings,
  setColorBlindMode,
  setReduceMotion,
  setLargerText,
  setMessagePrivacy,
  setActivityPrivacy,
  setAccentColor,
  COLOR_BLIND_OPTIONS,
  MESSAGE_PRIVACY_OPTIONS,
  ACTIVITY_PRIVACY_OPTIONS,
  ACCENT_COLOR_OPTIONS,
  applySettingsToDom,
  SETTINGS_CHANGED_EVENT,
} from '../services/userSettingsService'
import { buildInviteUrl } from '../services/inviteService'
import { useUserStats } from '../hooks/useUserStats'
import { shareContent } from '../utils/share'
import packageJson from '../../package.json'
import './Settings.css'

const APP_VERSION = packageJson.version || '0.7.5'
const APP_BUILD = import.meta.env.VITE_BUILD_NUMBER || '1'
const PRIVACY_URL = 'https://gametracker.app/privacy'
const TERMS_URL = 'https://gametracker.app/terms'
const FEEDBACK_EMAIL = 'feedback@gametracker.app'
// Sprint 8 will replace this with the real App Store ID once the
// app ships. Keeping the deep link wired so the row is functional
// the moment that constant flips.
const APP_STORE_ID = '0000000000'
const SHARE_URL = 'https://gametracker.app'

function maskEmail(email) {
  if (!email || typeof email !== 'string') return ''
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  if (local.length <= 1) return `${local}***@${domain}`
  return `${local[0]}***@${domain}`
}

function pickerLabel(options, value) {
  return options.find((o) => o.value === value)?.label || ''
}

/* ============================================================
   Color-blind mode preview swatches
   Renders three core tokens (accent, status-success,
   status-danger) in a tiny strip so the user sees what the
   selected mode does before tapping Done.
   ============================================================ */
function ColorBlindPreview({ mode }) {
  // We map each mode to the same hex values the global CSS uses so
  // the preview accurately reflects the runtime swap.
  const palettes = {
    off: { accent: '#3b82f6', success: '#34d399', danger: '#f87171' },
    deutan: { accent: '#2563eb', success: '#06b6d4', danger: '#f97316' },
    protan: { accent: '#3b82f6', success: '#06b6d4', danger: '#f97316' },
    tritan: { accent: '#3b82f6', success: '#16a34a', danger: '#dc2626' },
  }
  const p = palettes[mode] || palettes.off
  return (
    <div className="cbm-preview">
      <div className="cbm-preview__group">
        <div className="cbm-preview__swatches">
          <span
            className="cbm-preview__swatch"
            style={{ background: p.accent }}
            aria-label="Accent"
          />
          <span
            className="cbm-preview__swatch"
            style={{ background: p.success }}
            aria-label="Success"
          />
          <span
            className="cbm-preview__swatch"
            style={{ background: p.danger }}
            aria-label="Danger"
          />
        </div>
        <span className="cbm-preview__label">Live preview</span>
      </div>
    </div>
  )
}

/* ============================================================
   Reusable row primitives
   ============================================================ */
function SettingsGroup({ title, children, footer = null }) {
  return (
    <section className="settings-group">
      {title && <h2 className="settings-group__title">{title}</h2>}
      <div className="settings-group__rows">{children}</div>
      {footer && <p className="settings-group__footer">{footer}</p>}
    </section>
  )
}

function SettingsRow({
  label,
  value,
  onClick,
  trailing,
  destructive = false,
  centered = false,
  disabled = false,
}) {
  const Element = onClick ? 'button' : 'div'
  const className = [
    'settings-row',
    onClick ? 'settings-row--tappable' : '',
    destructive ? 'settings-row--destructive' : '',
    centered ? 'settings-row--centered' : '',
    disabled ? 'settings-row--disabled' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Element
      type={onClick ? 'button' : undefined}
      className={className}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="settings-row__label">{label}</span>
      {value !== undefined && value !== null && (
        <span className="settings-row__value">{value}</span>
      )}
      {trailing && <span className="settings-row__trailing">{trailing}</span>}
      {onClick && !trailing && !destructive && !centered && (
        <span className="settings-row__chevron" aria-hidden="true">
          <LuChevronRight size={18} />
        </span>
      )}
    </Element>
  )
}

/* ============================================================
   Settings page
   ============================================================ */

function Settings() {
  const navigate = useNavigate()
  const { user, logOut } = useAuth()

  const [settings, setSettings] = useState(getSettings)
  const [cbmSheetOpen, setCbmSheetOpen] = useState(false)
  const [msgSheetOpen, setMsgSheetOpen] = useState(false)
  const [actSheetOpen, setActSheetOpen] = useState(false)
  const [accentSheetOpen, setAccentSheetOpen] = useState(false)
  const [signOutSheetOpen, setSignOutSheetOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Live-preview state for the color-blind sub-sheet. We mirror it
  // onto <body> in real time and snap back to `settings.colorBlindMode`
  // if the user cancels.
  const [cbmPreview, setCbmPreview] = useState(settings.colorBlindMode)

  // Invite stats — used to gate the Ambassador accent unlock in the UI.
  const inviteStats = useUserStats(user?.id)
  const hasInviteReward = (inviteStats.invitesCount || 0) >= 1

  useEffect(() => {
    const onChange = () => setSettings(getSettings())
    window.addEventListener(SETTINGS_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onChange)
  }, [])

  useEffect(() => {
    if (cbmSheetOpen) setCbmPreview(settings.colorBlindMode)
  }, [cbmSheetOpen, settings.colorBlindMode])

  const email = user?.email || ''
  const maskedEmail = useMemo(() => maskEmail(email), [email])

  /* ============================================================
     Handlers
     ============================================================ */

  const handleColorBlindPreview = (mode) => {
    setCbmPreview(mode)
    applySettingsToDom({ ...settings, colorBlindMode: mode })
  }

  const handleColorBlindApply = (mode) => {
    setColorBlindMode(mode)
  }

  const handleColorBlindCancel = () => {
    applySettingsToDom(settings)
  }

  const handleReduceMotionToggle = (next) => {
    setReduceMotion(next)
  }

  const handleLargerTextToggle = (next) => {
    setLargerText(next)
  }

  const handleMsgApply = (value) => {
    setMessagePrivacy(value)
    showToast('Updated', 'success', 1800)
  }

  const handleActApply = (value) => {
    setActivityPrivacy(value)
    showToast('Updated', 'success', 1800)
  }

  const handleInviteFriends = async () => {
    const inviteUrl = buildInviteUrl(user?.id) || SHARE_URL
    const result = await shareContent({
      title: 'GameTracker',
      text: 'Track what you play. Find what to play next.',
      url: inviteUrl,
      dialogTitle: 'Invite friends',
    })
    if (result?.method === 'clipboard') {
      showToast('Link copied', 'success')
    }
  }

  const handleAccentApply = (color) => {
    if (color === 'copper' && !hasInviteReward) return
    setAccentColor(color)
    showToast(
      color === 'copper' ? 'Ambassador accent applied' : 'Accent reset',
      'success',
      1800
    )
  }

  const openExternal = (url) => {
    // Capacitor Browser plugin isn't installed in this build (Sprint 8
    // will add it). window.open in a Capacitor WKWebView opens Safari
    // automatically, which is exactly what we want for legal/marketing
    // links so the user keeps the app's session intact.
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      window.location.href = url
    }
  }

  const handlePrivacyPolicy = () => openExternal(PRIVACY_URL)
  const handleTerms = () => openExternal(TERMS_URL)
  const handleFeedback = () => {
    window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('GameTracker Feedback')}`
  }
  const handleRateApp = () => {
    window.location.href = `itms-apps://itunes.apple.com/app/id${APP_STORE_ID}`
  }

  const handleDeleteAccount = async (reason) => {
    if (isDeleting) return
    setIsDeleting(true)
    try {
      await deleteAccount(reason)
      // Edge Function revoked the session; clear local state and redirect.
      await logOut().catch(() => {})
      setDeleteSheetOpen(false)
      navigate('/login', { replace: true, state: { accountDeleted: true } })
    } catch (err) {
      console.error('[settings] delete-account failed:', err)
      showToast(err?.message || 'Could not delete account. Try again.', 'error')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await logOut()
      navigate('/login', { replace: true })
    } catch (err) {
      console.error('[settings] sign-out failed:', err)
      showToast(err?.message || 'Could not sign out. Try again.', 'error')
      setSigningOut(false)
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <button
          type="button"
          className="settings-header__back"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <LuChevronLeft size={22} aria-hidden="true" />
        </button>
        <h1 className="settings-header__title">Settings</h1>
        <span className="settings-header__spacer" aria-hidden="true" />
      </header>

      <div className="settings-page__body">
        {/* ─── ACCOUNT ────────────────────────────────────── */}
        <SettingsGroup title="Account">
          <SettingsRow
            label="Edit Profile"
            onClick={() => navigate('/edit-profile')}
          />
          <SettingsRow
            label="Email"
            value={maskedEmail || 'Not set'}
            onClick={() => navigate('/settings/email')}
          />
          <SettingsRow
            label="Password"
            onClick={() => navigate('/settings/password')}
          />
          <SettingsRow
            label="Delete account"
            onClick={() => setDeleteSheetOpen(true)}
            destructive
          />
        </SettingsGroup>

        {/* ─── APPEARANCE ────────────────────────────────── */}
        <SettingsGroup
          title="Appearance"
          footer={!hasInviteReward ? 'Invite a friend to unlock the Ambassador accent.' : null}
        >
          <SettingsRow
            label="Accent color"
            value={
              settings.accentColor === 'copper' ? 'Ambassador' : 'Default'
            }
            onClick={hasInviteReward ? () => setAccentSheetOpen(true) : undefined}
            trailing={
              !hasInviteReward ? (
                <span className="settings-row__icon settings-row__icon--locked" aria-label="Locked">
                  <LuLock size={15} />
                </span>
              ) : (
                <span className="settings-row__icon" aria-label="Accent color">
                  <LuPalette size={18} />
                </span>
              )
            }
            disabled={!hasInviteReward}
          />
        </SettingsGroup>

        {/* ─── ACCESSIBILITY ─────────────────────────────── */}
        <SettingsGroup title="Accessibility">
          <SettingsRow
            label="Color-blind mode"
            value={pickerLabel(COLOR_BLIND_OPTIONS, settings.colorBlindMode)}
            onClick={() => setCbmSheetOpen(true)}
          />
          <div className="settings-row settings-row--toggle">
            <span className="settings-row__label">Reduce motion</span>
            <span className="settings-row__trailing">
              <IOSSwitch
                checked={settings.reduceMotion}
                onChange={handleReduceMotionToggle}
                label="Reduce motion"
              />
            </span>
          </div>
          <div className="settings-row settings-row--toggle">
            <span className="settings-row__label">Larger text</span>
            <span className="settings-row__trailing">
              <IOSSwitch
                checked={settings.largerText}
                onChange={handleLargerTextToggle}
                label="Larger text"
              />
            </span>
          </div>
        </SettingsGroup>

        {/* ─── PRIVACY & SAFETY ──────────────────────────── */}
        <SettingsGroup title="Privacy & Safety">
          <SettingsRow
            label="Blocked users"
            onClick={() => navigate('/settings/blocked')}
          />
          <SettingsRow
            label="Who can message me"
            value={pickerLabel(MESSAGE_PRIVACY_OPTIONS, settings.messagePrivacy)}
            onClick={() => setMsgSheetOpen(true)}
          />
          <SettingsRow
            label="Who can see my activity"
            value={pickerLabel(ACTIVITY_PRIVACY_OPTIONS, settings.activityPrivacy)}
            onClick={() => setActSheetOpen(true)}
          />
        </SettingsGroup>

        {/* ─── INVITE FRIENDS ────────────────────────────── */}
        <SettingsGroup title="Invite Friends">
          <SettingsRow
            label="Invite friends"
            onClick={handleInviteFriends}
            trailing={
              <span className="settings-row__icon" aria-hidden="true">
                <LuShare2 size={18} />
              </span>
            }
          />
        </SettingsGroup>

        {/* ─── ABOUT ─────────────────────────────────────── */}
        <SettingsGroup title="About">
          <SettingsRow
            label="Version"
            value={`v${APP_VERSION} (build ${APP_BUILD})`}
          />
          <SettingsRow label="Privacy Policy" onClick={handlePrivacyPolicy} />
          <SettingsRow label="Terms of Service" onClick={handleTerms} />
          <SettingsRow label="Send feedback" onClick={handleFeedback} />
          <SettingsRow
            label="Rate the App"
            onClick={handleRateApp}
            trailing={
              <span className="settings-row__icon" aria-hidden="true">
                <LuStar size={18} />
              </span>
            }
          />
        </SettingsGroup>

        {/* ─── SIGN OUT ──────────────────────────────────── */}
        <SettingsGroup>
          <SettingsRow
            label={
              <span className="settings-row__signout-label">
                <LuLogOut size={16} aria-hidden="true" />
                Sign out
              </span>
            }
            onClick={() => setSignOutSheetOpen(true)}
            destructive
            centered
          />
        </SettingsGroup>

        <p className="settings-footnote">
          Signed in as <span>{email || 'guest'}</span>
        </p>
      </div>

      {/* ───────── Sub-sheets ───────── */}

      <SettingsPickerSheet
        isOpen={cbmSheetOpen}
        onClose={() => {
          handleColorBlindCancel()
          setCbmSheetOpen(false)
        }}
        title="Color-blind mode"
        description="Adjusts the accent and status colors so they remain distinguishable for the most common forms of color blindness."
        value={settings.colorBlindMode}
        options={COLOR_BLIND_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label.split(' (')[0],
          description: o.label.includes(' (')
            ? o.label.slice(o.label.indexOf('(') + 1, -1)
            : null,
        }))}
        onPreview={handleColorBlindPreview}
        onApply={handleColorBlindApply}
        previewSlot={<ColorBlindPreview mode={cbmPreview} />}
      />

      <SettingsPickerSheet
        isOpen={msgSheetOpen}
        onClose={() => setMsgSheetOpen(false)}
        title="Who can message me"
        value={settings.messagePrivacy}
        options={MESSAGE_PRIVACY_OPTIONS}
        onApply={handleMsgApply}
      />

      <SettingsPickerSheet
        isOpen={actSheetOpen}
        onClose={() => setActSheetOpen(false)}
        title="Who can see my activity"
        value={settings.activityPrivacy}
        options={ACTIVITY_PRIVACY_OPTIONS}
        onApply={handleActApply}
      />

      <ActionSheet
        isOpen={signOutSheetOpen}
        onClose={() => setSignOutSheetOpen(false)}
        title="Sign out of GameTracker?"
        items={[
          {
            label: signingOut ? 'Signing out…' : 'Sign out',
            onClick: handleSignOut,
            destructive: true,
            disabled: signingOut,
          },
        ]}
      />

      <DeleteAccountSheet
        isOpen={deleteSheetOpen}
        onClose={() => !isDeleting && setDeleteSheetOpen(false)}
        onConfirm={handleDeleteAccount}
        isDeleting={isDeleting}
      />

      <SettingsPickerSheet
        isOpen={accentSheetOpen}
        onClose={() => setAccentSheetOpen(false)}
        title="Accent color"
        description="Personalize your app accent. The Ambassador copper palette is unlocked by inviting friends."
        value={settings.accentColor || 'default'}
        options={ACCENT_COLOR_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
          description: o.description,
        }))}
        onApply={handleAccentApply}
      />
    </div>
  )
}

export default Settings

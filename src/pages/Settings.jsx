import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  LuAccessibility,
  LuChevronRight,
  LuCircleHelp,
  LuContrast,
  LuSearch,
  LuShield,
  LuUser,
  LuUserPlus,
} from 'react-icons/lu'
import { useAuth } from '../contexts/AuthContext'
import { showToast } from '../components/Toast'
import ActionSheet from '../components/ActionSheet'
import EditProfileModal from '../components/EditProfileModal'
import SettingsHeader from '../components/SettingsHeader'
import { SettingsGroup, SettingsRow } from '../components/SettingsRows'
import Avatar from '../components/Avatar'
import { getProfile, initializeProfile } from '../services/profileService'
import { getThemeSettings } from '../services/themeService'
import { getTheme } from '../styles/themePreview'
import { buildInviteUrl } from '../services/inviteService'
import { shareContent } from '../utils/share'
import packageJson from '../../package.json'
import './Settings.css'

const APP_VERSION = packageJson.version || '0.7.5'
const SHARE_URL = 'https://gametracker.app'

function maskEmail(email) {
  if (!email || typeof email !== 'string') return ''
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  if (local.length <= 1) return `${local}***@${domain}`
  return `${local[0]}***@${domain}`
}

function profileAvatarUrl(profile) {
  const avatar = profile?.avatar
  if (avatar && (avatar.type === 'url' || avatar.type === 'data') && avatar.data) {
    return avatar.data
  }
  return profile?.avatarUrl || null
}

function Settings() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logOut } = useAuth()

  const [profile, setProfile] = useState(() => getProfile() || initializeProfile())
  const [editOpen, setEditOpen] = useState(false)
  const [signOutSheetOpen, setSignOutSheetOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    const refresh = () => setProfile(getProfile() || initializeProfile())
    window.addEventListener('profileUpdated', refresh)
    return () => window.removeEventListener('profileUpdated', refresh)
  }, [])

  // Profile ⋯ still deep-links the old section hashes. Send them to the
  // sub-screen that now owns that content. replace so backing out of the
  // sub-screen doesn't land on the hash and bounce forward again.
  useEffect(() => {
    if (location.hash === '#settings-section-privacy') {
      navigate('/settings/privacy', { replace: true })
    } else if (location.hash === '#settings-section-about') {
      navigate('/settings/help', { replace: true })
    }
  }, [location.hash, navigate])

  const email = user?.email || ''
  const maskedEmail = useMemo(() => maskEmail(email), [email])
  const themeSettings = getThemeSettings()
  const appearanceValue = themeSettings.matchSystem
    ? 'Match iPhone'
    : getTheme(themeSettings.theme).name

  const displayName = profile?.displayName || profile?.username || ''
  const versionLabel = `Version ${APP_VERSION}`
  const footerText = maskedEmail ? `${maskedEmail} · ${versionLabel}` : versionLabel

  const handleInviteFriends = async () => {
    const inviteUrl = buildInviteUrl(user?.id) || SHARE_URL
    const result = await shareContent({
      title: 'Checkpoint',
      text: 'Track what you play. Find what to play next.',
      url: inviteUrl,
      dialogTitle: 'Invite friends',
    })
    if (result?.method === 'clipboard') {
      showToast('Link copied', 'success')
    }
  }

  const handleProfileUpdate = (updatedProfile) => {
    setProfile(updatedProfile)
    window.dispatchEvent(new Event('profileUpdated'))
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
    <div className="settings-page settings-page--hub">
      <SettingsHeader title="Settings" variant="large" />

      <div className="settings-page__body">
        <div className="settings-search" aria-hidden="true">
          <LuSearch className="settings-search__icon" size={15} strokeWidth={1.6} />
          <span>Search</span>
        </div>

        <SettingsGroup>
          <button type="button" className="settings-me" onClick={() => setEditOpen(true)}>
            <Avatar
              avatarUrl={profileAvatarUrl(profile)}
              name={displayName}
              seed={user?.id || displayName}
              size="md"
            />
            <span className="settings-me__text">
              {displayName ? (
                <span className="settings-me__name text-body">{displayName}</span>
              ) : null}
              <span className="settings-me__hint text-caption">Edit profile</span>
            </span>
            <LuChevronRight className="settings-me__chevron" size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </SettingsGroup>

        <SettingsGroup icons>
          <SettingsRow
            icon={<LuContrast size={18} strokeWidth={1.6} />}
            label="Appearance"
            value={appearanceValue}
            onClick={() => navigate('/settings/appearance')}
          />
          <SettingsRow
            icon={<LuAccessibility size={18} strokeWidth={1.6} />}
            label="Accessibility"
            onClick={() => navigate('/settings/accessibility')}
          />
          <SettingsRow
            icon={<LuUser size={18} strokeWidth={1.6} />}
            label="Account"
            onClick={() => navigate('/settings/account')}
          />
          <SettingsRow
            icon={<LuShield size={18} strokeWidth={1.6} />}
            label="Privacy & safety"
            onClick={() => navigate('/settings/privacy')}
          />
        </SettingsGroup>

        <SettingsGroup icons>
          <SettingsRow
            icon={<LuUserPlus size={18} strokeWidth={1.6} />}
            label="Invite friends"
            onClick={handleInviteFriends}
          />
          <SettingsRow
            icon={<LuCircleHelp size={18} strokeWidth={1.6} />}
            label="Help & about"
            onClick={() => navigate('/settings/help')}
          />
        </SettingsGroup>

        <SettingsGroup>
          <SettingsRow
            label="Sign out"
            onClick={() => setSignOutSheetOpen(true)}
            destructive
          />
        </SettingsGroup>

        <p className="settings-footnote text-caption">{footerText}</p>
      </div>

      <EditProfileModal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        profile={profile}
        onUpdate={handleProfileUpdate}
      />

      <ActionSheet
        isOpen={signOutSheetOpen}
        onClose={() => setSignOutSheetOpen(false)}
        title="Sign out of Checkpoint?"
        items={[
          {
            label: signingOut ? 'Signing out…' : 'Sign out',
            onClick: handleSignOut,
            destructive: true,
            disabled: signingOut,
          },
        ]}
      />
    </div>
  )
}

export default Settings

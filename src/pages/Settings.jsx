import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  LuAccessibility,
  LuChevronRight,
  LuCircleHelp,
  LuContrast,
  LuLogOut,
  LuPencil,
  LuSearch,
  LuShield,
  LuUser,
  LuUserPlus,
  LuX,
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
import { labelMatchRange, searchSettings } from '../config/settingsIndex'
import { setSettingsSearchBackHandler } from '../config/settingsSearchBack'
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

const SECTION_ICONS = {
  Appearance: LuContrast,
  Accessibility: LuAccessibility,
  Account: LuUser,
  'Privacy & safety': LuShield,
  'Help & about': LuCircleHelp,
}

const HUB_ICONS = {
  'edit-profile': LuPencil,
  appearance: LuContrast,
  accessibility: LuAccessibility,
  account: LuUser,
  privacy: LuShield,
  invite: LuUserPlus,
  help: LuCircleHelp,
  'sign-out': LuLogOut,
}

function iconFor(entry) {
  return SECTION_ICONS[entry.section] || HUB_ICONS[entry.id] || LuCircleHelp
}

function HighlightedLabel({ label, query }) {
  const range = labelMatchRange(label, query)
  if (!range) return label
  const [start, end] = range
  return (
    <>
      {label.slice(0, start)}
      <span className="settings-result__match">{label.slice(start, end)}</span>
      {label.slice(end)}
    </>
  )
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
  const [query, setQuery] = useState('')
  const [searchActive, setSearchActive] = useState(false)
  const searchInputRef = useRef(null)
  const cancelSearchRef = useRef(() => {})

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

  const trimmedQuery = query.trim()
  const results = useMemo(
    () => (trimmedQuery ? searchSettings(trimmedQuery) : []),
    [trimmedQuery],
  )
  const showingResults = trimmedQuery.length > 0

  const cancelSearch = () => {
    setSettingsSearchBackHandler(null)
    setQuery('')
    setSearchActive(false)
    searchInputRef.current?.blur()
  }
  cancelSearchRef.current = cancelSearch

  useEffect(() => {
    if (!searchActive) {
      setSettingsSearchBackHandler(null)
      return undefined
    }
    setSettingsSearchBackHandler(() => {
      cancelSearchRef.current()
      return true
    })
    return () => setSettingsSearchBackHandler(null)
  }, [searchActive])

  const openResult = (entry) => {
    if (entry.section === 'Settings') {
      if (entry.id === 'edit-profile') {
        setEditOpen(true)
        return
      }
      if (entry.id === 'invite') {
        handleInviteFriends()
        return
      }
      if (entry.id === 'sign-out') {
        setSignOutSheetOpen(true)
        return
      }
      if (entry.route) navigate(entry.route)
      return
    }
    if (entry.route) {
      navigate(entry.route, { state: { highlight: entry.id } })
    }
  }

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
      <div className="settings-hub-chrome">
        <SettingsHeader
          title="Settings"
          variant="large"
          titleCollapsed={searchActive}
          inChrome
        />

        <div className="settings-search-row" role="search">
          <label className="settings-search">
            <LuSearch className="settings-search__icon" size={15} strokeWidth={1.6} aria-hidden="true" />
            <input
              ref={searchInputRef}
              className="settings-search__input"
              type="text"
              value={query}
              placeholder="Search"
              aria-label="Search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              enterKeyHint="search"
              onFocus={() => setSearchActive(true)}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query.length > 0 && (
              <button
                type="button"
                className="settings-search__clear"
                aria-label="Clear search"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQuery('')
                  searchInputRef.current?.focus()
                }}
              >
                <span className="settings-search__clear-dot" aria-hidden="true">
                  <LuX size={8} strokeWidth={2.5} />
                </span>
              </button>
            )}
          </label>
          {searchActive && (
            <button
              type="button"
              className="settings-search__cancel text-body"
              onClick={cancelSearch}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="settings-page__body">
        {showingResults ? (
          results.length > 0 ? (
            <SettingsGroup icons>
              {results.map((entry) => {
                const Icon = iconFor(entry)
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className="settings-row settings-row--tappable settings-row--icon settings-result"
                    onClick={() => openResult(entry)}
                  >
                    <span className="settings-row__icon" aria-hidden="true">
                      <Icon size={18} strokeWidth={1.6} />
                    </span>
                    <span className="settings-result__copy">
                      <span className="settings-result__label text-body">
                        <HighlightedLabel label={entry.label} query={trimmedQuery} />
                      </span>
                      <span className="settings-result__section text-caption">{entry.section}</span>
                    </span>
                    <span className="settings-row__chevron" aria-hidden="true">
                      <LuChevronRight size={16} strokeWidth={1.75} />
                    </span>
                  </button>
                )
              })}
            </SettingsGroup>
          ) : (
            <p className="settings-search-empty text-caption" role="status">
              {`No settings match "${trimmedQuery}"`}
            </p>
          )
        ) : (
          <>
            <SettingsGroup>
              <button
                type="button"
                className="settings-me"
                data-setting-id="edit-profile"
                onClick={() => setEditOpen(true)}
              >
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
                settingId="appearance"
                icon={<LuContrast size={18} strokeWidth={1.6} />}
                label="Appearance"
                value={appearanceValue}
                onClick={() => navigate('/settings/appearance')}
              />
              <SettingsRow
                settingId="accessibility"
                icon={<LuAccessibility size={18} strokeWidth={1.6} />}
                label="Accessibility"
                onClick={() => navigate('/settings/accessibility')}
              />
              <SettingsRow
                settingId="account"
                icon={<LuUser size={18} strokeWidth={1.6} />}
                label="Account"
                onClick={() => navigate('/settings/account')}
              />
              <SettingsRow
                settingId="privacy"
                icon={<LuShield size={18} strokeWidth={1.6} />}
                label="Privacy & safety"
                onClick={() => navigate('/settings/privacy')}
              />
            </SettingsGroup>

            <SettingsGroup icons>
              <SettingsRow
                settingId="invite"
                icon={<LuUserPlus size={18} strokeWidth={1.6} />}
                label="Invite friends"
                onClick={handleInviteFriends}
              />
              <SettingsRow
                settingId="help"
                icon={<LuCircleHelp size={18} strokeWidth={1.6} />}
                label="Help & about"
                onClick={() => navigate('/settings/help')}
              />
            </SettingsGroup>

            <SettingsGroup>
              <SettingsRow
                settingId="sign-out"
                label="Sign out"
                onClick={() => setSignOutSheetOpen(true)}
                destructive
              />
            </SettingsGroup>

            <p className="settings-footnote text-caption">{footerText}</p>
          </>
        )}
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

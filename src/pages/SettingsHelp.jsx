import React from 'react'
import SettingsHeader from '../components/SettingsHeader'
import { SettingsGroup, SettingsRow } from '../components/SettingsRows'
import packageJson from '../../package.json'
import './Settings.css'

const APP_VERSION = packageJson.version || '0.7.5'
const APP_BUILD = import.meta.env.VITE_BUILD_NUMBER || '1'
const PRIVACY_URL = 'https://gametracker.app/privacy'
const TERMS_URL = 'https://gametracker.app/terms'
const FEEDBACK_EMAIL = 'feedback@gametracker.app'
const APP_STORE_ID = '0000000000'

function openExternal(url) {
  try {
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    window.location.href = url
  }
}

function SettingsHelp() {
  const handlePrivacyPolicy = () => openExternal(PRIVACY_URL)
  const handleTerms = () => openExternal(TERMS_URL)
  const handleFeedback = () => {
    window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Checkpoint Feedback')}`
  }
  const handleRateApp = () => {
    window.location.href = `itms-apps://itunes.apple.com/app/id${APP_STORE_ID}`
  }

  return (
    <div className="settings-page">
      <SettingsHeader title="Help & about" />

      <div className="settings-page__body">
        <SettingsGroup>
          <SettingsRow label="Send feedback" onClick={handleFeedback} />
          <SettingsRow label="Rate the app" onClick={handleRateApp} />
          <SettingsRow label="Privacy Policy" onClick={handlePrivacyPolicy} />
          <SettingsRow label="Terms of Service" onClick={handleTerms} />
          <SettingsRow label="Version" value={`v${APP_VERSION} (build ${APP_BUILD})`} />
        </SettingsGroup>
      </div>
    </div>
  )
}

export default SettingsHelp

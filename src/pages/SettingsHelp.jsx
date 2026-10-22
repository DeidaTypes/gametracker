import React from 'react'
import SettingsHeader from '../components/SettingsHeader'
import { SettingsGroup, SettingsRow } from '../components/SettingsRows'
import {
  APP_VERSION,
  BUILD_NUMBER,
  PRIVACY_URL,
  RATE_APP_URL,
  TERMS_URL,
  supportMailto,
} from '../config/site'
import './Settings.css'

// Every value comes from src/config/site.js. A row whose value is not
// configured is not rendered — there are no placeholder links.
const FEEDBACK_URL = supportMailto('Checkpoint Feedback')

function openExternal(url) {
  try {
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    window.location.href = url
  }
}

function versionLabel() {
  if (!APP_VERSION) return null
  return BUILD_NUMBER ? `v${APP_VERSION} (build ${BUILD_NUMBER})` : `v${APP_VERSION}`
}

function SettingsHelp() {
  const version = versionLabel()

  return (
    <div className="settings-page">
      <SettingsHeader title="Help & about" />

      <div className="settings-page__body">
        <SettingsGroup>
          {FEEDBACK_URL && (
            <SettingsRow
              settingId="feedback"
              label="Send feedback"
              onClick={() => {
                window.location.href = FEEDBACK_URL
              }}
            />
          )}
          {RATE_APP_URL && (
            <SettingsRow
              settingId="rate"
              label="Rate the app"
              onClick={() => {
                window.location.href = RATE_APP_URL
              }}
            />
          )}
          {PRIVACY_URL && (
            <SettingsRow
              settingId="privacy-policy"
              label="Privacy Policy"
              onClick={() => openExternal(PRIVACY_URL)}
            />
          )}
          {TERMS_URL && (
            <SettingsRow
              settingId="terms"
              label="Terms of Service"
              onClick={() => openExternal(TERMS_URL)}
            />
          )}
          {version && <SettingsRow settingId="version" label="Version" value={version} />}
        </SettingsGroup>
      </div>
    </div>
  )
}

export default SettingsHelp

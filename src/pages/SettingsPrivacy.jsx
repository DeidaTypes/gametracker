import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { showToast } from '../components/Toast'
import SettingsPickerSheet from '../components/SettingsPickerSheet'
import SettingsHeader from '../components/SettingsHeader'
import { SettingsGroup, SettingsRow } from '../components/SettingsRows'
import {
  getSettings,
  setMessagePrivacy,
  setActivityPrivacy,
  MESSAGE_PRIVACY_OPTIONS,
  ACTIVITY_PRIVACY_OPTIONS,
  SETTINGS_CHANGED_EVENT,
} from '../services/userSettingsService'
import { BLOCK_CHANGED_EVENT, getSelfBlockedCountSync } from '../services/blockService'
import './Settings.css'

function pickerLabel(options, value) {
  return options.find((o) => o.value === value)?.label || ''
}

function SettingsPrivacy() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState(getSettings)
  const [msgSheetOpen, setMsgSheetOpen] = useState(false)
  const [actSheetOpen, setActSheetOpen] = useState(false)
  const [blockedCount, setBlockedCount] = useState(getSelfBlockedCountSync)

  useEffect(() => {
    const onChange = () => setSettings(getSettings())
    window.addEventListener(SETTINGS_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onChange)
  }, [])

  useEffect(() => {
    const sync = () => setBlockedCount(getSelfBlockedCountSync())
    window.addEventListener(BLOCK_CHANGED_EVENT, sync)
    return () => window.removeEventListener(BLOCK_CHANGED_EVENT, sync)
  }, [])

  const handleMsgApply = async (value) => {
    const result = await setMessagePrivacy(value)
    if (result?.ok) showToast('Updated', 'success', 1800)
    else showToast("Couldn't update. Try again.", 'error')
  }

  const handleActApply = async (value) => {
    const result = await setActivityPrivacy(value)
    if (result?.ok) showToast('Updated', 'success', 1800)
    else showToast("Couldn't update. Try again.", 'error')
  }

  return (
    <div className="settings-page">
      <SettingsHeader title="Privacy & safety" />

      <div className="settings-page__body">
        <SettingsGroup title="Who can">
          <SettingsRow
            settingId="message-me"
            label="Message me"
            value={pickerLabel(MESSAGE_PRIVACY_OPTIONS, settings.messagePrivacy)}
            onClick={() => setMsgSheetOpen(true)}
          />
          <SettingsRow
            settingId="see-activity"
            label="See my activity"
            value={pickerLabel(ACTIVITY_PRIVACY_OPTIONS, settings.activityPrivacy)}
            onClick={() => setActSheetOpen(true)}
          />
        </SettingsGroup>

        <SettingsGroup footer="Blocked people can't see your profile, message you, or find you in search.">
          <SettingsRow
            settingId="blocked"
            label="Blocked users"
            value={blockedCount == null ? undefined : String(blockedCount)}
            onClick={() => navigate('/settings/blocked')}
          />
        </SettingsGroup>
      </div>

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
    </div>
  )
}

export default SettingsPrivacy

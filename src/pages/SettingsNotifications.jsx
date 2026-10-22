import React, { useCallback, useEffect, useRef, useState } from 'react'
import SettingsHeader from '../components/SettingsHeader'
import { SettingsGroup, SettingsRow, SettingsSwitchRow } from '../components/SettingsRows'
import { showToast } from '../components/Toast'
import { useFlagEnabled } from '../hooks/useFlagEnabled'
import { APP_RESUMED_EVENT } from '../hooks/useAppResume'
import { getPushPrefs, setPushPref } from '../services/notificationService'
import {
  getMessagePushPrefs,
  getPushPermission,
  isPushSupported,
  openIosSettings,
  requestPushPermission,
  setMessagePushPref,
} from '../services/pushService'
import './Settings.css'

const PEOPLE_ROWS = [
  { key: 'follows', settingId: 'notif-follows', label: 'Follows' },
  { key: 'likes', settingId: 'notif-likes', label: 'Likes' },
  { key: 'commentsMentions', settingId: 'notif-comments', label: 'Comments and mentions' },
  { key: 'qa', settingId: 'notif-qa', label: 'Q&A' },
  { key: 'friendsActivity', settingId: 'notif-friends', label: "Friends' activity" },
]

const MESSAGE_KEYS = new Set(['messages', 'messagePreviews'])

const PERMISSION_COPY = {
  granted: { value: 'On', footer: null },
  denied: {
    value: 'Off',
    footer: 'Notifications are turned off for Checkpoint in iOS Settings.',
  },
  prompt: { value: 'Not set up', footer: null },
}

function PermissionGroup({ permission, onTurnOn }) {
  const copy = PERMISSION_COPY[permission]
  if (!copy) return null
  return (
    <SettingsGroup footer={copy.footer}>
      <SettingsRow settingId="notif-ios" label="Notifications on this iPhone" value={copy.value} />
      {permission === 'denied' && (
        <SettingsRow settingId="notif-ios-settings" label="Open iOS Settings" onClick={openIosSettings} />
      )}
      {permission === 'prompt' && (
        <SettingsRow settingId="notif-ios-turn-on" label="Turn on notifications" onClick={onTurnOn} />
      )}
    </SettingsGroup>
  )
}

function SettingsNotifications() {
  const isAdmin = useFlagEnabled('admin')
  const [prefs, setPrefs] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [permission, setPermission] = useState(null)
  const writeChain = useRef(Promise.resolve())

  useEffect(() => {
    let alive = true
    Promise.all([getPushPrefs(), getMessagePushPrefs()]).then(([people, messages]) => {
      if (!alive) return
      if (people && messages) setPrefs({ ...people, ...messages })
      else setLoadFailed(true)
    })
    return () => {
      alive = false
    }
  }, [])

  // Re-read on resume: the user may have just come back from iOS Settings.
  useEffect(() => {
    if (!isPushSupported()) return undefined
    let alive = true
    const read = () =>
      getPushPermission().then((value) => {
        if (alive) setPermission(value)
      })
    read()
    window.addEventListener(APP_RESUMED_EVENT, read)
    return () => {
      alive = false
      window.removeEventListener(APP_RESUMED_EVENT, read)
    }
  }, [])

  const handleTurnOn = useCallback(async () => {
    setPermission(await requestPushPermission())
  }, [])

  const handleToggle = (key, next) => {
    setPrefs((prev) => ({ ...prev, [key]: next }))
    const write = MESSAGE_KEYS.has(key) ? setMessagePushPref : setPushPref
    // Serialised so fast taps land in order.
    writeChain.current = writeChain.current
      .then(() => write(key, next))
      .catch(() => {
        setPrefs((prev) => ({ ...prev, [key]: !next }))
        showToast("Couldn't update. Try again.", 'error')
      })
  }

  return (
    <div className="settings-page">
      <SettingsHeader title="Notifications" />

      <div className="settings-page__body">
        {permission && <PermissionGroup permission={permission} onTurnOn={handleTurnOn} />}

        {loadFailed ? (
          <p className="settings-search-empty text-caption" role="status">
            Couldn&apos;t load your notification settings.
          </p>
        ) : prefs ? (
          <>
            <SettingsGroup
              title="Push notifications"
              footer="These switches control push notifications only. Everything still shows up in your Notifications inbox."
            >
              {PEOPLE_ROWS.map((row) => (
                <SettingsSwitchRow
                  key={row.key}
                  settingId={row.settingId}
                  label={row.label}
                  checked={prefs[row.key]}
                  onChange={(next) => handleToggle(row.key, next)}
                />
              ))}
            </SettingsGroup>

            <SettingsGroup
              title="Messages"
              footer={
                prefs.messages
                  ? 'With previews off, a push says who wrote but not what they said.'
                  : null
              }
            >
              <SettingsSwitchRow
                settingId="notif-messages"
                label="Messages"
                checked={prefs.messages}
                onChange={(next) => handleToggle('messages', next)}
              />
              {prefs.messages && (
                <SettingsSwitchRow
                  settingId="notif-message-previews"
                  label="Show message previews"
                  checked={prefs.messagePreviews}
                  onChange={(next) => handleToggle('messagePreviews', next)}
                />
              )}
            </SettingsGroup>

            {isAdmin && (
              <SettingsGroup footer="New reports waiting in Moderation.">
                <SettingsSwitchRow
                  settingId="notif-admin"
                  label="Admin"
                  checked={prefs.admin}
                  onChange={(next) => handleToggle('admin', next)}
                />
              </SettingsGroup>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}

export default SettingsNotifications

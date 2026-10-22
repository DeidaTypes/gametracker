import React, { useEffect, useRef, useState } from 'react'
import SettingsHeader from '../components/SettingsHeader'
import { SettingsGroup, SettingsSwitchRow } from '../components/SettingsRows'
import { showToast } from '../components/Toast'
import { useFlagEnabled } from '../hooks/useFlagEnabled'
import { getPushPrefs, setPushPref } from '../services/notificationService'
import './Settings.css'

const PEOPLE_ROWS = [
  { key: 'follows', settingId: 'notif-follows', label: 'Follows' },
  { key: 'likes', settingId: 'notif-likes', label: 'Likes' },
  { key: 'commentsMentions', settingId: 'notif-comments', label: 'Comments and mentions' },
  { key: 'qa', settingId: 'notif-qa', label: 'Q&A' },
  { key: 'friendsActivity', settingId: 'notif-friends', label: "Friends' activity" },
]

function SettingsNotifications() {
  const isAdmin = useFlagEnabled('admin')
  const [prefs, setPrefs] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const writeChain = useRef(Promise.resolve())

  useEffect(() => {
    let alive = true
    getPushPrefs().then((value) => {
      if (!alive) return
      if (value) setPrefs(value)
      else setLoadFailed(true)
    })
    return () => {
      alive = false
    }
  }, [])

  const handleToggle = (key, next) => {
    setPrefs((prev) => ({ ...prev, [key]: next }))
    // Serialised so fast taps land in order.
    writeChain.current = writeChain.current
      .then(() => setPushPref(key, next))
      .catch(() => {
        setPrefs((prev) => ({ ...prev, [key]: !next }))
        showToast("Couldn't update. Try again.", 'error')
      })
  }

  return (
    <div className="settings-page">
      <SettingsHeader title="Notifications" />

      <div className="settings-page__body">
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

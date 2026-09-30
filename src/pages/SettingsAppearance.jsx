import React, { useEffect, useState } from 'react'
import { LuCheck } from 'react-icons/lu'
import SettingsHeader from '../components/SettingsHeader'
import IOSSwitch from '../components/IOSSwitch'
import {
  getThemeSettings,
  resolveThemeId,
  setMatchSystem,
  setTheme,
} from '../services/themeService'
import { THEME_ORDER, THEMES } from '../styles/themePreview'
import { hapticImpact } from '../utils/haptics'
import './Settings.css'
import './SettingsAppearance.css'

function systemPrefersDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

const DARK_THEMES = THEME_ORDER.filter((id) => THEMES[id].mode === 'dark').map((id) => THEMES[id])
const LIGHT_THEMES = THEME_ORDER.filter((id) => THEMES[id].mode === 'light').map((id) => THEMES[id])

function ThemeTile({ theme, selected, showNow, onSelect }) {
  return (
    <button
      type="button"
      className={`appearance-tile${selected ? ' appearance-tile--selected' : ''}`}
      aria-label={`${theme.name} theme`}
      aria-pressed={selected}
      onClick={() => onSelect(theme.id)}
    >
      <span
        className="appearance-tile__preview"
        style={{ background: theme.base }}
        aria-hidden="true"
      >
        <span
          className="appearance-tile__bar"
          style={{ background: theme.surface, width: '80%' }}
        />
        <span
          className="appearance-tile__bar"
          style={{ background: theme.surface, width: '55%' }}
        />
        <span className="appearance-tile__dots">
          <span style={{ background: theme.primary }} />
          <span style={{ background: theme.review }} />
          <span style={{ background: theme.journal }} />
        </span>
      </span>
      <span className="appearance-tile__meta">
        <span className="appearance-tile__name">{theme.name}</span>
        {showNow && <span className="appearance-tile__now">Now</span>}
        {selected && (
          <span className="appearance-tile__check" aria-hidden="true">
            <LuCheck size={10} strokeWidth={3} />
          </span>
        )}
      </span>
    </button>
  )
}

function ThemeSection({ label, themes, settings, showingId, onSelect }) {
  return (
    <section className="appearance-section">
      <h2 className="appearance-section__label">{label}</h2>
      <div className="appearance-grid">
        {themes.map((theme) => {
          const selected = settings.matchSystem
            ? theme.id === (theme.mode === 'dark' ? settings.lastDark : settings.lastLight)
            : theme.id === settings.theme
          return (
            <ThemeTile
              key={theme.id}
              theme={theme}
              selected={selected}
              showNow={settings.matchSystem && theme.id === showingId}
              onSelect={onSelect}
            />
          )
        })}
      </div>
    </section>
  )
}

function SettingsAppearance() {
  const [settings, setSettings] = useState(getThemeSettings)
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)

  useEffect(() => {
    let query
    try {
      query = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return undefined
    }
    const onChange = (event) => setPrefersDark(event.matches)
    if (query.addEventListener) query.addEventListener('change', onChange)
    else if (query.addListener) query.addListener(onChange)
    return () => {
      if (query.removeEventListener) query.removeEventListener('change', onChange)
      else if (query.removeListener) query.removeListener(onChange)
    }
  }, [])

  const showingId = resolveThemeId(settings, prefersDark)

  const refresh = () => setSettings(getThemeSettings())

  const handleSelect = (id) => {
    hapticImpact('Light')
    setTheme(id)
    refresh()
  }

  // Match on keeps the theme on screen as that section's pick.
  // Match off keeps whichever theme is on screen. setTheme writes that
  // pick first; setMatchSystem then resolves against the saved choice.
  const handleMatch = (on) => {
    const showing = resolveThemeId(getThemeSettings(), systemPrefersDark())
    setTheme(showing)
    setMatchSystem(on)
    refresh()
  }

  return (
    <div className="settings-page">
      <SettingsHeader title="Appearance" />

      <div className="settings-page__body">
        <ThemeSection
          label="Dark"
          themes={DARK_THEMES}
          settings={settings}
          showingId={showingId}
          onSelect={handleSelect}
        />
        <ThemeSection
          label="Light"
          themes={LIGHT_THEMES}
          settings={settings}
          showingId={showingId}
          onSelect={handleSelect}
        />

        <section className="appearance-match">
          <div className="settings-group__rows">
            <div className="settings-row settings-row--toggle" data-setting-id="match-iphone">
              <span className="settings-row__label">Match iPhone light and dark</span>
              <span className="settings-row__trailing">
                <IOSSwitch
                  checked={settings.matchSystem}
                  onChange={handleMatch}
                  label="Match iPhone light and dark"
                />
              </span>
            </div>
          </div>
          <p className="appearance-match__note">
            Uses your Dark pick at night and your Light pick during the day,
            following your iPhone setting.
          </p>
        </section>
      </div>
    </div>
  )
}

export default SettingsAppearance

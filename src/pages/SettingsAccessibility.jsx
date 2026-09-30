import React, { useEffect, useState } from 'react'
import SettingsHeader from '../components/SettingsHeader'
import { SettingsGroup, SettingsRow, SettingsSwitchRow } from '../components/SettingsRows'
import SettingsPickerSheet from '../components/SettingsPickerSheet'
import {
  getSettings,
  setColorBlindMode,
  setReduceMotion,
  setLargerText,
  COLOR_BLIND_OPTIONS,
  applySettingsToDom,
  SETTINGS_CHANGED_EVENT,
} from '../services/userSettingsService'
import { hapticImpact } from '../utils/haptics'
import './Settings.css'

function pickerLabel(options, value) {
  return options.find((o) => o.value === value)?.label || ''
}

/* Color-blind mode preview swatches. Same palette the global CSS
   swaps in, so Done/Cancel preview matches the live theme. */
function ColorBlindPreview({ mode }) {
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

function SettingsAccessibility() {
  const [settings, setSettings] = useState(getSettings)
  const [cbmSheetOpen, setCbmSheetOpen] = useState(false)
  const [cbmPreview, setCbmPreview] = useState(settings.colorBlindMode)

  useEffect(() => {
    const onChange = () => setSettings(getSettings())
    window.addEventListener(SETTINGS_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onChange)
  }, [])

  useEffect(() => {
    if (cbmSheetOpen) setCbmPreview(settings.colorBlindMode)
  }, [cbmSheetOpen, settings.colorBlindMode])

  const handleColorBlindPreview = (mode) => {
    setCbmPreview(mode)
    applySettingsToDom({ ...settings, colorBlindMode: mode })
  }

  const handleColorBlindApply = (mode) => {
    setColorBlindMode(mode)
  }

  const handleColorBlindCancel = () => {
    setCbmPreview(settings.colorBlindMode)
    applySettingsToDom(settings)
  }

  const handleReduceMotionToggle = (next) => {
    hapticImpact('Light')
    setReduceMotion(next)
  }

  const handleLargerTextToggle = (next) => {
    hapticImpact('Light')
    setLargerText(next)
  }

  return (
    <div className="settings-page">
      <SettingsHeader title="Accessibility" />

      <div className="settings-page__body">
        <SettingsGroup>
          <SettingsRow
            settingId="color-blind"
            label="Color-blind mode"
            value={pickerLabel(COLOR_BLIND_OPTIONS, settings.colorBlindMode)}
            onClick={() => setCbmSheetOpen(true)}
          />
          <SettingsSwitchRow
            settingId="reduce-motion"
            label="Reduce motion"
            checked={settings.reduceMotion}
            onChange={handleReduceMotionToggle}
          />
          <SettingsSwitchRow
            settingId="larger-text"
            label="Larger text"
            checked={settings.largerText}
            onChange={handleLargerTextToggle}
          />
        </SettingsGroup>
      </div>

      <SettingsPickerSheet
        isOpen={cbmSheetOpen}
        onClose={() => setCbmSheetOpen(false)}
        onCancel={handleColorBlindCancel}
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
    </div>
  )
}

export default SettingsAccessibility

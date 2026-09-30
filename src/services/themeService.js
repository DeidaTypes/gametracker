/**
 * Appearance theme.
 *
 * Saved on this device only. There is no settings column to sync yet
 * (see the TH-01 report). Storage failures fall back to the defaults
 * and never throw.
 *
 * Defaults: Navy, Match iPhone off, last dark Navy, last light Light.
 *
 * index.html reads the same storage key before the bundle loads so the
 * first frame is already the saved theme. Keep that script in step
 * with STORAGE_KEY and resolveThemeId().
 */

import { Capacitor } from '@capacitor/core'
import { THEMES, getTheme } from '../styles/themePreview'

export const THEME_STORAGE_KEY = 'gametracker.theme.v1'

const DEFAULTS = Object.freeze({
  theme: 'navy',
  matchSystem: false,
  lastDark: 'navy',
  lastLight: 'light',
})

let schemeQuery = null
let onSchemeChange = null

function systemIsDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

function readRaw() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function writeRaw(settings) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({
      theme: settings.theme,
      matchSystem: settings.matchSystem,
      lastDark: settings.lastDark,
      lastLight: settings.lastLight,
    }))
  } catch {
    // Private mode or a full disk. The in-memory choice still applies.
  }
}

function knownId(id, mode) {
  const theme = THEMES[id]
  if (!theme) return null
  if (mode && theme.mode !== mode) return null
  return theme.id
}

export function getThemeSettings() {
  const stored = readRaw()
  if (!stored) return { ...DEFAULTS }
  return {
    theme: knownId(stored.theme) || DEFAULTS.theme,
    matchSystem: stored.matchSystem === true,
    lastDark: knownId(stored.lastDark, 'dark') || DEFAULTS.lastDark,
    lastLight: knownId(stored.lastLight, 'light') || DEFAULTS.lastLight,
  }
}

/**
 * Which theme to paint. Match iPhone off → the chosen theme.
 * Match iPhone on → last dark pick in Dark Mode, last light pick in
 * Light Mode. Anything unknown is Navy.
 */
export function resolveThemeId(settings, prefersDark) {
  const current = settings || getThemeSettings()
  if (current.matchSystem) {
    const pick = prefersDark ? current.lastDark : current.lastLight
    return knownId(pick) || DEFAULTS.theme
  }
  return knownId(current.theme) || DEFAULTS.theme
}

function stopSystemListener() {
  if (schemeQuery && onSchemeChange) {
    if (schemeQuery.removeEventListener) {
      schemeQuery.removeEventListener('change', onSchemeChange)
    } else if (schemeQuery.removeListener) {
      schemeQuery.removeListener(onSchemeChange)
    }
  }
  schemeQuery = null
  onSchemeChange = null
}

function startSystemListener() {
  stopSystemListener()
  try {
    schemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
  } catch {
    return
  }
  onSchemeChange = (event) => {
    const latest = getThemeSettings()
    if (!latest.matchSystem) {
      stopSystemListener()
      return
    }
    applyTheme(resolveThemeId(latest, event.matches))
  }
  if (schemeQuery.addEventListener) {
    schemeQuery.addEventListener('change', onSchemeChange)
  } else if (schemeQuery.addListener) {
    schemeQuery.addListener(onSchemeChange)
  }
}

function syncSystemListener(settings) {
  if (settings.matchSystem) startSystemListener()
  else stopSystemListener()
}

async function applyStatusBar(mode) {
  try {
    if (!Capacitor.isNativePlatform()) return
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    // Capacitor names these by the background they suit.
    // Style.Dark = light status-bar text, for the four dark themes.
    // Style.Light = dark status-bar text, for the four light themes.
    await StatusBar.setStyle({
      style: mode === 'light' ? Style.Light : Style.Dark,
    })
  } catch {
    // Web, or the plugin is unavailable. Never surface this.
  }
}

export function applyTheme(id) {
  if (typeof document === 'undefined') return DEFAULTS.theme
  const theme = getTheme(id)
  const root = document.documentElement
  root.setAttribute('data-app-theme', theme.id)
  root.style.removeProperty('--boot-bg')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme.base)
  applyStatusBar(theme.mode)
  return theme.id
}

export function setTheme(id) {
  const theme = getTheme(id)
  const current = getThemeSettings()
  const next = {
    ...current,
    theme: theme.id,
    lastDark: theme.mode === 'dark' ? theme.id : current.lastDark,
    lastLight: theme.mode === 'light' ? theme.id : current.lastLight,
  }
  writeRaw(next)
  syncSystemListener(next)
  return applyTheme(resolveThemeId(next, systemIsDark()))
}

export function setMatchSystem(on) {
  const current = getThemeSettings()
  const next = { ...current, matchSystem: on === true }
  writeRaw(next)
  syncSystemListener(next)
  return applyTheme(resolveThemeId(next, systemIsDark()))
}

/** Call once after CSS has loaded so the status bar and theme-color match. */
export function initTheme() {
  const settings = getThemeSettings()
  syncSystemListener(settings)
  return applyTheme(resolveThemeId(settings, systemIsDark()))
}

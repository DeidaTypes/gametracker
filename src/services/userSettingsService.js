import { supabase } from './supabase'

/**
 * User Settings Service — accessibility + privacy preferences.
 *
 * Source of truth is localStorage so the chosen values apply
 * instantly on every screen and survive offline use. Where it makes
 * sense (privacy + color-blind mode) we ALSO best-effort sync to the
 * `users` row so the same account on another device picks the prefs
 * up after sign-in.
 *
 * The Supabase write soft-fails: if the column doesn't exist yet
 * (sync SQL migration not applied) we swallow the error rather than
 * spam the console — the local value still applies and the next
 * boot's hydrate is a clean no-op.
 *
 * SQL migration that adds the matching columns to the `users` table
 * lives at `supabase/user_settings_columns.sql`. Run it once to
 * enable cross-device sync.
 */

const STORAGE_KEY = 'gametracker.settings.v1'

const COLOR_BLIND_MODES = Object.freeze(['off', 'deutan', 'protan', 'tritan'])
const MESSAGE_PRIVACY = Object.freeze(['everyone', 'follows', 'nobody'])
const ACTIVITY_PRIVACY = Object.freeze(['everyone', 'followers', 'me'])

const DEFAULT_SETTINGS = Object.freeze({
  colorBlindMode: 'off',
  reduceMotion: false,
  largerText: false,
  messagePrivacy: 'everyone',
  activityPrivacy: 'everyone',
  // Pulse — realtime presence ("playing now") is opt-in and defaults
  // off. The presence channel is only joined when this is true, and the
  // usePresence() hook is a no-op otherwise. The Supabase column is
  // `users.presence_opt_in` (see supabase/activity_events.sql).
  presenceOptIn: false,
  // Presence pings — grouped "X and N others just hopped into <game>"
  // banners. Only fires when presenceOptIn is also true. Local-only
  // (no DB sync needed since it controls what YOU see, not what you
  // broadcast). Defaults true so opted-in users get pings out of the box.
  presencePingsOptIn: true,
  // Invite reward: users who earn the Ambassador badge unlock the
  // 'copper' accent. Stored locally; no Supabase sync needed.
  accentColor: 'default',
})

/* ============================================================
   Storage helpers
   ============================================================ */

function readRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeRaw(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // localStorage full / private mode — best effort.
  }
}

export function getSettings() {
  const stored = readRaw()
  if (!stored) return { ...DEFAULT_SETTINGS }
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
  }
}

/* ============================================================
   Legacy key migration: spec asked us to honor a localStorage key
   "gametracker.colorBlindMode" too. Read it once on first load and
   fold it into the unified settings blob so any code that wrote the
   raw key earlier still picks up.
   ============================================================ */

const LEGACY_CB_KEY = 'gametracker.colorBlindMode'

function migrateLegacy() {
  try {
    const legacy = localStorage.getItem(LEGACY_CB_KEY)
    if (!legacy) return
    if (!COLOR_BLIND_MODES.includes(legacy)) return
    const current = readRaw() || {}
    if (current.colorBlindMode && current.colorBlindMode !== 'off') return
    writeRaw({ ...DEFAULT_SETTINGS, ...current, colorBlindMode: legacy })
  } catch {
    /* noop */
  }
}

/* ============================================================
   Apply to <body> data-attributes so CSS picks the prefs up.
   Called both at boot (initSettings) and on every change.
   ============================================================ */

export function applySettingsToDom(settings) {
  if (typeof document === 'undefined') return
  const body = document.body
  if (!body) return

  if (settings.colorBlindMode && settings.colorBlindMode !== 'off') {
    body.setAttribute('data-cbm', settings.colorBlindMode)
  } else {
    body.removeAttribute('data-cbm')
  }

  if (settings.reduceMotion) {
    body.setAttribute('data-reduce-motion', 'true')
  } else {
    body.removeAttribute('data-reduce-motion')
  }

  if (settings.largerText) {
    body.setAttribute('data-larger-text', 'true')
  } else {
    body.removeAttribute('data-larger-text')
  }

  if (settings.accentColor && settings.accentColor !== 'default') {
    body.setAttribute('data-accent', settings.accentColor)
  } else {
    body.removeAttribute('data-accent')
  }
}

/**
 * Boot-time hydration. Reads localStorage, migrates the legacy key,
 * applies <body> data-attributes, and (best effort) refreshes the
 * blob from the Supabase users row when an authenticated user is
 * present. Safe to call before auth resolves — the Supabase fetch
 * is a no-op without a session.
 */
export async function initSettings() {
  migrateLegacy()
  const local = getSettings()
  applySettingsToDom(local)

  // Soft-fetch from Supabase so cross-device sync wins on next boot.
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return local

    const { data, error } = await supabase
      .from('users')
      .select('color_blind_mode, message_privacy, activity_privacy, presence_opt_in')
      .eq('id', user.id)
      .maybeSingle()
    if (error || !data) return local

    const merged = { ...local }
    if (COLOR_BLIND_MODES.includes(data.color_blind_mode)) {
      merged.colorBlindMode = data.color_blind_mode
    }
    if (MESSAGE_PRIVACY.includes(data.message_privacy)) {
      merged.messagePrivacy = data.message_privacy
    }
    if (ACTIVITY_PRIVACY.includes(data.activity_privacy)) {
      merged.activityPrivacy = data.activity_privacy
    }
    if (typeof data.presence_opt_in === 'boolean') {
      merged.presenceOptIn = data.presence_opt_in
    }
    writeRaw(merged)
    applySettingsToDom(merged)
    return merged
  } catch {
    return local
  }
}

/* ============================================================
   Mutations
   ============================================================ */

export const SETTINGS_CHANGED_EVENT = 'gtSettingsChanged'

function emitChange(next) {
  try {
    window.dispatchEvent(
      new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: next })
    )
  } catch {
    /* noop */
  }
}

async function softSyncToSupabase(supabasePatch) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase
      .from('users')
      .update(supabasePatch)
      .eq('id', user.id)
    if (error) {
      // Column likely missing — log once at debug level only.
      console.debug(
        '[settings] supabase sync skipped:',
        error.message
      )
    }
  } catch {
    /* offline / signed out — fine, localStorage is canonical. */
  }
}

export function setColorBlindMode(mode) {
  if (!COLOR_BLIND_MODES.includes(mode)) return
  const current = getSettings()
  const next = { ...current, colorBlindMode: mode }
  writeRaw(next)
  applySettingsToDom(next)
  // Mirror to legacy key so any code reading the old key keeps working.
  try {
    localStorage.setItem(LEGACY_CB_KEY, mode)
  } catch {
    /* noop */
  }
  softSyncToSupabase({ color_blind_mode: mode })
  emitChange(next)
  return next
}

export function setReduceMotion(value) {
  const current = getSettings()
  const next = { ...current, reduceMotion: !!value }
  writeRaw(next)
  applySettingsToDom(next)
  emitChange(next)
  return next
}

export function setLargerText(value) {
  const current = getSettings()
  const next = { ...current, largerText: !!value }
  writeRaw(next)
  applySettingsToDom(next)
  emitChange(next)
  return next
}

export function setMessagePrivacy(value) {
  if (!MESSAGE_PRIVACY.includes(value)) return
  const current = getSettings()
  const next = { ...current, messagePrivacy: value }
  writeRaw(next)
  softSyncToSupabase({ message_privacy: value })
  emitChange(next)
  return next
}

export function setActivityPrivacy(value) {
  if (!ACTIVITY_PRIVACY.includes(value)) return
  const current = getSettings()
  const next = { ...current, activityPrivacy: value }
  writeRaw(next)
  softSyncToSupabase({ activity_privacy: value })
  emitChange(next)
  return next
}

/**
 * Toggle realtime presence ("playing now") opt-in. When false, the
 * usePresence() hook never joins a Realtime presence channel for this
 * user — guaranteeing that not opting in literally cannot leak presence
 * data. Mirrored to `users.presence_opt_in` so the same account on a
 * different device honors the choice immediately on next initSettings().
 */
export function setPresenceOptIn(value) {
  const current = getSettings()
  const next = { ...current, presenceOptIn: !!value }
  writeRaw(next)
  softSyncToSupabase({ presence_opt_in: !!value })
  emitChange(next)
  return next
}

/**
 * Toggle grouped presence-ping banners. Independent of presenceOptIn so
 * a user can share their own presence without receiving banner nudges.
 * Stored locally only — controls display on this device, not broadcast.
 */
export function setPresencePingsOptIn(value) {
  const current = getSettings()
  const next = { ...current, presencePingsOptIn: !!value }
  writeRaw(next)
  emitChange(next)
  return next
}

const ACCENT_COLORS = Object.freeze(['default', 'copper'])

/**
 * Set the accent color unlock earned via the Ambassador invite badge.
 * Stored in localStorage only — no cross-device sync required since it's
 * a cosmetic preference tied to a local badge state.
 */
export function setAccentColor(color) {
  if (!ACCENT_COLORS.includes(color)) return
  const current = getSettings()
  const next = { ...current, accentColor: color }
  writeRaw(next)
  applySettingsToDom(next)
  emitChange(next)
  return next
}

/* ============================================================
   Public option lists for UI sub-sheets
   ============================================================ */

export const COLOR_BLIND_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'deutan', label: 'Deuteranopia (red/green deficiency — most common)' },
  { value: 'protan', label: 'Protanopia (red deficiency)' },
  { value: 'tritan', label: 'Tritanopia (blue/yellow deficiency — rare)' },
]

export const MESSAGE_PRIVACY_OPTIONS = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'follows', label: 'People I follow' },
  { value: 'nobody', label: 'Nobody' },
]

export const ACTIVITY_PRIVACY_OPTIONS = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'followers', label: 'Followers only' },
  { value: 'me', label: 'Only me' },
]

/** Accent color options — 'copper' is gated behind the Ambassador invite badge. */
export const ACCENT_COLOR_OPTIONS = [
  { value: 'default', label: 'Default', description: 'Cobalt blue — the classic look' },
  { value: 'copper', label: 'Ambassador', description: 'Warm copper — unlocked by inviting friends', locked: true },
]

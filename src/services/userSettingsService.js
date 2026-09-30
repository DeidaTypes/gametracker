import { supabase } from './supabase'

/**
 * User Settings Service — accessibility + privacy preferences.
 *
 * Accessibility prefs (color-blind mode, reduce motion, larger text)
 * live in localStorage and apply on this device. Message privacy and
 * activity privacy are server-authoritative: the UI keeps an optimistic
 * copy, but localStorage is only kept after `users` accepts the write,
 * and initSettings() hydrates both from get_my_settings().
 *
 * Color-blind mode and presence still best-effort sync. A failed sync
 * leaves the local value in place.
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
})

/* ============================================================
   Storage helpers
   ============================================================ */

function readRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // The Ambassador 'copper' accent-color feature was retired; strip any
    // stale accentColor key left over from before so it doesn't linger in
    // storage. Nothing reads this key anymore, so this is a no-op for
    // anyone who never had it set.
    if (parsed && 'accentColor' in parsed) delete parsed.accentColor
    return parsed
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

/**
 * Reset the settings that belong to an *account* back to their defaults,
 * leaving the ones that belong to this *device* alone.
 *
 * Privacy and presence are stored on the `users` row and re-hydrate from
 * get_my_settings() after sign-in, so carrying one account's choices into
 * another's session is both wrong and briefly misleading (a new account
 * appearing to have "nobody can message me" set). Accessibility prefs
 * (colorBlindMode, reduceMotion, largerText) are deliberately preserved:
 * they describe the person holding the phone, not the account, and wiping
 * them on every sign-out would be a genuine accessibility regression.
 */
export function clearAccountScopedSettings() {
  const stored = readRaw()
  if (!stored) return
  writeRaw({
    ...stored,
    messagePrivacy: DEFAULT_SETTINGS.messagePrivacy,
    activityPrivacy: DEFAULT_SETTINGS.activityPrivacy,
    presenceOptIn: DEFAULT_SETTINGS.presenceOptIn,
  })
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
}

/**
 * Boot-time hydration. Reads localStorage, migrates the legacy key,
 * applies <body> data-attributes, and refreshes account-scoped prefs
 * from get_my_settings() when a session exists. Safe to call before
 * auth resolves — the Supabase fetch is a no-op without a session.
 *
 * A privacy key with a server write still in flight is left alone.
 * When a server value differs from localStorage, the local copy is
 * replaced and gtSettingsChanged is emitted.
 */
export async function initSettings() {
  migrateLegacy()
  const local = getSettings()
  applySettingsToDom(local)

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return local

    const epochAtFetch = {
      messagePrivacy: privacyEpoch.messagePrivacy,
      activityPrivacy: privacyEpoch.activityPrivacy,
    }

    const { data, error } = await supabase.rpc('get_my_settings').maybeSingle()
    if (error || !data) return getSettings()

    if (canApplyServerPrivacy('messagePrivacy', epochAtFetch) && MESSAGE_PRIVACY.includes(data.message_privacy)) {
      await hydrateMessagePrivacy(data.message_privacy, epochAtFetch)
    }

    const latest = getSettings()
    const next = { ...latest }
    let changed = false

    if (
      canApplyServerPrivacy('activityPrivacy', epochAtFetch) &&
      ACTIVITY_PRIVACY.includes(data.activity_privacy) &&
      latest.activityPrivacy !== data.activity_privacy
    ) {
      next.activityPrivacy = data.activity_privacy
      changed = true
    }

    if (
      canApplyServerPrivacy('messagePrivacy', epochAtFetch) &&
      MESSAGE_PRIVACY.includes(data.message_privacy) &&
      latest.messagePrivacy !== data.message_privacy
    ) {
      next.messagePrivacy = data.message_privacy
      changed = true
    }

    if (typeof data.presence_opt_in === 'boolean' && latest.presenceOptIn !== data.presence_opt_in) {
      next.presenceOptIn = data.presence_opt_in
      changed = true
    }

    if (!changed) return latest

    writeRaw(next)
    applySettingsToDom(next)
    emitChange(next)
    return next
  } catch {
    return getSettings()
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

const MSG_PRIVACY_UPLOADED_KEY = 'cp:msgPrivacyUploaded'

// Privacy writes in flight. initSettings skips these keys so a hydrate
// that started against the old server value cannot clobber the optimistic
// row. The epoch catches a write that finishes during the hydrate.
const privacyInflight = new Set()
const privacyEpoch = { messagePrivacy: 0, activityPrivacy: 0 }

function canApplyServerPrivacy(key, epochAtFetch) {
  return !privacyInflight.has(key) && privacyEpoch[key] === epochAtFetch[key]
}

function hasUploadedMessagePrivacy() {
  try {
    return localStorage.getItem(MSG_PRIVACY_UPLOADED_KEY) === '1'
  } catch {
    return false
  }
}

function markMessagePrivacyUploaded() {
  try {
    localStorage.setItem(MSG_PRIVACY_UPLOADED_KEY, '1')
  } catch {
    // Storage unavailable. The next hydrate retries the one-time upload.
  }
}

/**
 * First hydrate after message_privacy shipped: a tester's non-default
 * local choice would otherwise be replaced by the column default
 * ('everyone'). Push that local value up once, and only while the
 * server still holds the default. After the flag is set, the server wins.
 */
async function hydrateMessagePrivacy(serverValue, epochAtFetch) {
  if (!canApplyServerPrivacy('messagePrivacy', epochAtFetch)) return
  if (hasUploadedMessagePrivacy()) return

  const localValue = getSettings().messagePrivacy
  if (localValue !== 'everyone' && serverValue === 'everyone' && MESSAGE_PRIVACY.includes(localValue)) {
    privacyEpoch.messagePrivacy += 1
    const epoch = privacyEpoch.messagePrivacy
    privacyInflight.add('messagePrivacy')
    try {
      const result = await writeUsersPatch(
        { message_privacy: localValue },
        { message_privacy: 'everyone' }
      )
      if (result.ok && privacyEpoch.messagePrivacy === epoch) {
        markMessagePrivacyUploaded()
      }
    } finally {
      if (privacyEpoch.messagePrivacy === epoch) privacyInflight.delete('messagePrivacy')
    }
    return
  }

  markMessagePrivacyUploaded()
}

async function writeUsersPatch(patch, match) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: new Error('Not signed in') }
    let query = supabase.from('users').update(patch).eq('id', user.id)
    if (match) {
      for (const [column, value] of Object.entries(match)) {
        query = query.eq(column, value)
      }
    }
    const { error } = await query
    if (error) return { ok: false, error }
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
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
      console.debug(
        '[settings] supabase sync skipped:',
        error.message
      )
    }
  } catch {
    // Offline or signed out. The local value still applies.
  }
}

async function commitPrivacy(key, column, value, allowed) {
  if (!allowed.includes(value)) {
    return { ok: false, error: new Error('Invalid privacy value') }
  }
  const previous = getSettings()[key]
  const next = { ...getSettings(), [key]: value }
  privacyEpoch[key] += 1
  const epoch = privacyEpoch[key]
  privacyInflight.add(key)
  writeRaw(next)
  emitChange(next)
  try {
    const result = await writeUsersPatch({ [column]: value })
    if (!result.ok && privacyEpoch[key] === epoch) {
      const rolled = { ...getSettings(), [key]: previous }
      writeRaw(rolled)
      emitChange(rolled)
    }
    return result
  } finally {
    if (privacyEpoch[key] === epoch) privacyInflight.delete(key)
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
  return commitPrivacy('messagePrivacy', 'message_privacy', value, MESSAGE_PRIVACY)
}

export function setActivityPrivacy(value) {
  return commitPrivacy('activityPrivacy', 'activity_privacy', value, ACTIVITY_PRIVACY)
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

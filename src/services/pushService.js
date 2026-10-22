import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

/**
 * APNs push on iOS.
 *
 * Registration only happens once iOS permission is granted: on launch when it
 * already is, or right after the user says yes to the explainer. iOS hands
 * back the device token on every register(); it is saved against the signed-in
 * user with register_device_token and removed on sign-out.
 *
 * Sends are server-side only (supabase/functions/push-send, called from
 * database triggers). Each push carries `path` (and optionally `state`) for
 * the screen it opens; a tap is broadcast as 'app:pushopen' and App.jsx
 * navigates as a normal push. A cold-start tap is held until App takes it.
 *
 * The permission explainer is offered after a follow, a question or a sent
 * message, never at launch. "Not now" waits 7 days.
 */

export const PUSH_OPEN_EVENT = 'app:pushopen'
export const PUSH_EXPLAINER_EVENT = 'push:explainer'

const EXPLAINER_KEY = 'gt:push:explainer:v1'
const EXPLAINER_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000
// Lets the screen that triggered it (a closing composer, a follow tap)
// settle before the popup slides in.
const EXPLAINER_DELAY_MS = 700
const UNREGISTER_TIMEOUT_MS = 3000

let pluginPromise = null
let deviceToken = null
let explainerOfferedThisSession = false
let pendingOpen = null
let openConsumerReady = false

export function isPushSupported() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'
}

function loadPlugin() {
  if (!isPushSupported()) return Promise.resolve(null)
  if (!pluginPromise) {
    pluginPromise = import('@capacitor/push-notifications')
      .then((m) => m.PushNotifications)
      .catch((err) => {
        console.warn('[push] plugin unavailable:', err?.message)
        return null
      })
  }
  return pluginPromise
}

/**
 * iOS permission state: 'granted' | 'denied' | 'prompt' | 'unavailable'.
 * 'unavailable' on web and whenever the plugin cannot be reached.
 */
export async function getPushPermission() {
  const plugin = await loadPlugin()
  if (!plugin) return 'unavailable'
  try {
    const { receive } = await plugin.checkPermissions()
    if (receive === 'granted' || receive === 'denied') return receive
    return 'prompt'
  } catch {
    return 'unavailable'
  }
}

/** Shows the iOS prompt (only does anything the first time). Returns the new state. */
export async function requestPushPermission() {
  const plugin = await loadPlugin()
  if (!plugin) return 'unavailable'
  try {
    const { receive } = await plugin.requestPermissions()
    if (receive === 'granted') {
      await plugin.register()
      return 'granted'
    }
    return receive === 'denied' ? 'denied' : 'prompt'
  } catch (err) {
    console.warn('[push] requestPermissions failed:', err?.message)
    return getPushPermission()
  }
}

/** iOS Settings → Checkpoint. Capacitor hands non-app URLs to the system. */
export function openIosSettings() {
  try {
    window.open('app-settings:', '_blank')
  } catch {
    // Nothing else can open Settings from the web layer.
  }
}

async function saveToken() {
  if (!deviceToken) return
  const { data } = await supabase.auth.getSession()
  if (!data?.session) return
  const { error } = await supabase.rpc('register_device_token', {
    p_token: deviceToken,
    p_platform: 'ios',
  })
  if (error) console.warn('[push] register_device_token failed:', error.message)
}

/**
 * Remove this device's token for the signed-in user. Called before the
 * session is dropped; bounded so a slow network never holds up sign-out.
 */
export async function unregisterThisDevice() {
  if (!deviceToken) return
  const call = supabase
    .rpc('unregister_device_token', { p_token: deviceToken })
    .then(({ error }) => {
      if (error) console.warn('[push] unregister_device_token failed:', error.message)
    })
  const timeout = new Promise((resolve) => setTimeout(resolve, UNREGISTER_TIMEOUT_MS))
  await Promise.race([call, timeout])
}

function emitPushOpen(detail) {
  if (!openConsumerReady) pendingOpen = detail
  window.dispatchEvent(new CustomEvent(PUSH_OPEN_EVENT, { detail }))
}

/**
 * Called by App.jsx once its PUSH_OPEN_EVENT listener is attached. Returns a
 * tap that arrived before that (cold start), if any.
 */
export function takePendingPushOpen() {
  openConsumerReady = true
  const detail = pendingOpen
  pendingOpen = null
  return detail
}

function handleAction(action) {
  if (action?.actionId && action.actionId !== 'tap') return
  const data = action?.notification?.data || {}
  const path = typeof data.path === 'string' && data.path.startsWith('/') ? data.path : null
  if (!path) return
  const state = data.state && typeof data.state === 'object' ? data.state : undefined
  emitPushOpen({ path, state })
}

/** Once at startup (from appLifecycle). No-op off iOS. */
export async function initPush() {
  const plugin = await loadPlugin()
  if (!plugin) return

  try {
    await plugin.addListener('registration', ({ value }) => {
      deviceToken = value || null
      void saveToken()
    })
    await plugin.addListener('registrationError', (err) => {
      console.warn('[push] registration failed:', err?.error)
    })
    // Retained by the plugin until this listener exists, so a tap that
    // launched the app still arrives here.
    await plugin.addListener('pushNotificationActionPerformed', handleAction)
  } catch (err) {
    console.warn('[push] listeners failed:', err?.message)
    return
  }

  // The token can arrive before the stored session is restored at launch.
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') void saveToken()
  })

  if ((await getPushPermission()) === 'granted') {
    try {
      await plugin.register()
    } catch (err) {
      console.warn('[push] register failed:', err?.message)
    }
  }
}

/* ============================================================
   Explainer
   ============================================================ */

function readSnooze() {
  try {
    const raw = window.localStorage.getItem(EXPLAINER_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return Number(parsed?.snoozedUntil) || 0
  } catch {
    return 0
  }
}

export function snoozePushExplainer() {
  try {
    window.localStorage.setItem(
      EXPLAINER_KEY,
      JSON.stringify({ snoozedUntil: Date.now() + EXPLAINER_SNOOZE_MS })
    )
  } catch {
    // Private mode / storage full — the session flag still holds it off.
  }
}

/**
 * After a follow, a question or a sent message. Shows the explainer only when
 * iOS has never been asked, it was not snoozed in the last 7 days, and it has
 * not already been offered this session.
 *
 * @param {'follow'|'ask'|'message'} reason
 */
export async function offerPushExplainer(reason) {
  if (!isPushSupported() || explainerOfferedThisSession) return
  if (readSnooze() > Date.now()) return
  if ((await getPushPermission()) !== 'prompt') return
  explainerOfferedThisSession = true
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent(PUSH_EXPLAINER_EVENT, { detail: { reason } }))
  }, EXPLAINER_DELAY_MS)
}

/* ============================================================
   Message push prefs (user_notification_prefs)
   ============================================================ */

const MESSAGE_PREF_COLUMNS = {
  messages: 'push_messages',
  messagePreviews: 'push_message_previews',
}

/** { messages, messagePreviews }, both true when no row exists. null on failure. */
export async function getMessagePushPrefs() {
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth?.user?.id
  if (!userId) return null
  const { data, error } = await supabase
    .from('user_notification_prefs')
    .select(Object.values(MESSAGE_PREF_COLUMNS).join(', '))
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('[push] getMessagePushPrefs failed:', error.message)
    return null
  }
  return {
    messages: data?.push_messages ?? true,
    messagePreviews: data?.push_message_previews ?? true,
  }
}

/** Same update-then-insert shape as notificationService.setPushPref. */
export async function setMessagePushPref(key, value) {
  const column = MESSAGE_PREF_COLUMNS[key]
  if (!column) throw new Error(`Unknown message push preference: ${key}`)
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth?.user?.id
  if (!userId) throw new Error('You must be signed in to change notifications.')

  const { data, error } = await supabase
    .from('user_notification_prefs')
    .update({ [column]: value })
    .eq('user_id', userId)
    .select('user_id')
  if (error) throw new Error(error.message)
  if (data && data.length > 0) return

  const { error: insertErr } = await supabase
    .from('user_notification_prefs')
    .insert({ user_id: userId, [column]: value })
  if (insertErr) {
    if (insertErr.code === '23505') return setMessagePushPref(key, value)
    throw new Error(insertErr.message)
  }
}

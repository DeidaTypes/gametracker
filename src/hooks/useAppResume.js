import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../services/supabase'

/**
 * Global window event fired whenever the native app returns to the
 * foreground (Capacitor `appStateChange` → isActive === true). Screens and
 * data hooks listen for it to reload their data, and realtime providers
 * listen for it to re-establish dropped subscriptions.
 *
 * Using a window event (rather than threading a callback through React
 * context) keeps the recovery decoupled: any hook anywhere can opt into
 * resume-refresh by adding a single listener.
 */
export const APP_RESUMED_EVENT = 'app:resumed'

/**
 * Why this hook exists
 * --------------------
 * On iOS the WKWebView is suspended when the app is backgrounded. While
 * suspended:
 *   - The Supabase realtime WebSocket is torn down by the OS and never
 *     auto-reconnects, because the heartbeat/reconnect timers are frozen.
 *   - The auth auto-refresh timer is frozen, so the access token can lapse
 *     past its expiry without ever refreshing.
 *   - Any socket the WebView was holding open goes stale.
 *
 * React components are NOT remounted on resume (the WebView is preserved),
 * so every screen's mount-time `useEffect` fetch never re-runs. The net
 * effect: after a background/resume the UI keeps showing its stale
 * mount-time state, the realtime socket is dead, and the only thing that
 * recovers it is a full force-quit + relaunch that remounts everything.
 *
 * NATIVE path: handled by src/services/appLifecycle.js (imported once from
 * main.jsx). That module owns appStateChange, auth refresh, realtime
 * reconnect, and APP_RESUMED_EVENT dispatch for iOS/Android.
 *
 * WEB / PWA path (this hook): `visibilitychange` drives the same recovery so
 * the browser build and TestFlight web previews also recover gracefully.
 */
export function useAppResume() {
  useEffect(() => {
    // Native path is fully handled by appLifecycle.js; a second listener here
    // would cause double session-refreshes and double realtime reconnects.
    if (Capacitor.isNativePlatform()) return

    // Web fallback: visibilitychange is reliable in desktop/PWA browsers.
    async function handleResume() {
      // Validate/refresh the session.
      try {
        const { data } = await supabase.auth.getSession()
        const session = data?.session
        if (session) {
          const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0
          const aboutToExpire = expiresAtMs > 0 && expiresAtMs - Date.now() < 60_000
          if (aboutToExpire) {
            await supabase.auth.refreshSession()
          }
        }
      } catch (err) {
        console.warn('[app-resume] session refresh failed:', err)
      }

      // Drop the stale realtime socket so subscribers reconnect cleanly.
      try {
        supabase.realtime?.disconnect()
      } catch (err) {
        console.warn('[app-resume] realtime disconnect failed:', err)
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(APP_RESUMED_EVENT))
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') handleResume()
    }

    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
}

export default useAppResume

import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { runResumeSequence } from '../services/resumeSequence'

/**
 * Global window event fired whenever the app returns to the foreground
 * (Capacitor `appStateChange` → isActive === true on native, or
 * `visibilitychange` on web). Screens and data hooks listen for it to reload
 * their data, and realtime providers listen for it to re-establish dropped
 * subscriptions.
 *
 * Using a window event (rather than threading a callback through React
 * context) keeps the recovery decoupled: any hook anywhere can opt into
 * resume-refresh by adding a single listener.
 *
 * Defined in services/resumeSequence.js (which dispatches it) and re-exported
 * here because this is where the app has always imported it from.
 */
export { APP_RESUMED_EVENT } from '../services/resumeSequence'

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
 * NATIVE path: `appStateChange`, wired in src/services/appLifecycle.js
 * (imported once from main.jsx).
 *
 * WEB / PWA path (this hook): `visibilitychange`, so the browser build and
 * TestFlight web previews recover gracefully too.
 *
 * Both paths call the same runResumeSequence(). They used to hold separate
 * copies of the recovery logic, and the copy here had drifted: it dropped the
 * realtime socket with `disconnect()` and never called `connect()`, so every
 * web resume permanently killed realtime instead of restoring it.
 */
export function useAppResume() {
  useEffect(() => {
    // Native path is fully handled by appLifecycle.js; a second listener here
    // would cause double session-refreshes and double realtime reconnects.
    if (Capacitor.isNativePlatform()) return

    const onVisible = () => {
      if (document.visibilityState === 'visible') runResumeSequence('visibilitychange')
    }

    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
}

export default useAppResume

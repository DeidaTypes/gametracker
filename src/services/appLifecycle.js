import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'
import { capturePendingReferral } from './inviteService'

/**
 * Module-level Capacitor app-lifecycle wiring.
 *
 * WHY THIS EXISTS
 * ---------------
 * iOS suspends the WKWebView when the app is backgrounded. While suspended:
 *   - Supabase's auto-refresh timer is frozen, so the access token can lapse
 *     past its expiry without ever refreshing.
 *   - The Supabase realtime WebSocket is torn down by the OS; its reconnect
 *     timer is also frozen, so it never recovers on its own.
 *   - `visibilitychange` is unreliable on WKWebView, so a web listener alone
 *     cannot be trusted.
 *
 * On foreground this module:
 *   1. Restarts the auth auto-refresh timer (it was frozen/stopped).
 *   2. Validates the session and refreshes the token if it is near expiry or
 *      already stale so the very first query after resume is authenticated.
 *   3. Drops the dead realtime socket and opens a new one so channels
 *      immediately re-subscribe instead of waiting on a zombie connection.
 *   4. Dispatches `app:resumed` so data hooks and realtime providers across
 *      the app know to refetch / re-subscribe.
 *
 * On background this module stops the auto-refresh timer so it doesn't fire
 * while the WebView is suspended (the timer would expire instantly on resume
 * and trigger a spurious network hit before we've validated the session).
 *
 * Guarded entirely behind `Capacitor.isNativePlatform()` — the web build is
 * completely untouched.  Web resume is handled by the `visibilitychange`
 * fallback in src/hooks/useAppResume.js.
 *
 * IMPORTED ONCE from src/main.jsx — do not call initAppLifecycle() elsewhere.
 */

const NEAR_EXPIRY_MS = 60_000 // treat token as stale if < 60 s remain

async function handleForeground() {
  // 1. Restart the frozen auto-refresh timer immediately.
  supabase.auth.startAutoRefresh()

  // 2. Validate session — getSession() reads localStorage (cheap, never
  //    hangs); refreshSession() goes through the timeout-wrapped global fetch
  //    so it can't spin.
  try {
    const { data } = await supabase.auth.getSession()
    const session = data?.session
    if (session) {
      const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0
      const nearExpiry = expiresAtMs > 0 && expiresAtMs - Date.now() < NEAR_EXPIRY_MS
      if (nearExpiry) {
        await supabase.auth.refreshSession()
      }
    }
  } catch (err) {
    // Non-fatal: an anon-key read still works; next authenticated request
    // will retry via the refreshed auto-refresh timer.
    console.warn('[appLifecycle] session refresh failed:', err)
  }

  // 3. Realtime: the WebSocket is dead after suspension.  Drop it explicitly
  //    so channels reconnect to a fresh socket instead of a half-open zombie.
  //    Re-subscribing channels is then handled by their own APP_RESUMED_EVENT
  //    listeners (see TimelineFeed, MessagesThread, etc.).
  try {
    supabase.realtime.disconnect()
    supabase.realtime.connect()
    // Explicitly re-subscribe any channels that were open before suspension.
    supabase.realtime.channels?.forEach((channel) => {
      try {
        channel.subscribe()
      } catch {
        // channel may already be in a subscribing state — ignore
      }
    })
  } catch (err) {
    console.warn('[appLifecycle] realtime reconnect failed:', err)
  }

  // 4. Signal data hooks / realtime providers to refetch / re-subscribe.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('app:resumed'))
  }
}

function handleBackground() {
  // Stop the timer so it doesn't fire while the WebView is suspended and
  // trigger a network hit the moment the CPU wakes.
  supabase.auth.stopAutoRefresh()
}

/**
 * Parse an incoming URL for a ?ref= invite param and a navigable path,
 * then broadcast both to the React layer via custom events.
 *
 * Called by both the cold-start getLaunchUrl() check and the warm-start
 * appUrlOpen listener so the same logic handles both entry points.
 */
function handleAppUrl(url) {
  if (!url) return
  try {
    const parsed = new URL(url)

    // Capture invite referral before the user navigates anywhere.
    const ref = parsed.searchParams.get('ref')
    if (ref) capturePendingReferral(ref)

    // Broadcast deep-link path so App.jsx can navigate the SPA router.
    const path = parsed.pathname + parsed.search + parsed.hash
    if (path && path !== '/' && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('app:deeplink', { detail: { path } })
      )
    }
  } catch {
    // Malformed URL — ignore.
  }
}

/**
 * Call once at app startup (from main.jsx).
 * No-op on web — native only.
 */
export function initAppLifecycle() {
  if (!Capacitor.isNativePlatform()) return

  // Ensure the auto-refresh timer is running on cold start.
  supabase.auth.startAutoRefresh()

  ;(async () => {
    try {
      const { App } = await import('@capacitor/app')

      // 1. App state (foreground/background) — auth + realtime recovery.
      await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          handleForeground()
        } else {
          handleBackground()
        }
      })

      // 2. Cold-start URL — app was launched by tapping a link while not running.
      try {
        const launchUrl = await App.getLaunchUrl()
        if (launchUrl?.url) handleAppUrl(launchUrl.url)
      } catch {
        // getLaunchUrl() may not be available in all plugin versions — ignore.
      }

      // 3. Warm-start URL — app was already running and a link was opened.
      await App.addListener('appUrlOpen', ({ url }) => handleAppUrl(url))
    } catch (err) {
      console.warn('[appLifecycle] @capacitor/app listener failed:', err)
    }
  })()
}

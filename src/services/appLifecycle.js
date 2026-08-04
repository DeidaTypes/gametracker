import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'
import { capturePendingReferral } from './inviteService'
import { runResumeSequence, cancelResumeSequence } from './resumeSequence'

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
 * On foreground this module restarts the auth auto-refresh timer (it was
 * frozen/stopped) and then hands off to runResumeSequence() in
 * services/resumeSequence.js, which owns session revalidation, realtime
 * reconnect, and the `app:resumed` broadcast — shared with the web path so the
 * two can't drift apart.
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

function handleForeground() {
  // Restart the frozen auto-refresh timer before anything else, so that even
  // if the resume sequence's own refresh fails outright, auth-js is ticking
  // again and will retry on its own schedule.
  supabase.auth.startAutoRefresh()

  runResumeSequence('native')
}

function handleBackground() {
  // Stop the timer so it doesn't fire while the WebView is suspended and
  // trigger a network hit the moment the CPU wakes.
  supabase.auth.stopAutoRefresh()

  // Same reasoning for any resume retry still pending.
  cancelResumeSequence()
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

    // Password recovery arrives as checkpoint://reset-password#access_token=…
    // (see services/passwordReset.js). detectSessionInUrl can't help here: the
    // WebView's own location is capacitor://localhost and this URL is handed to
    // us by appUrlOpen long after the Supabase client initialised, so the
    // session has to be established explicitly before we route.
    //
    // Note the pathname of a custom-scheme URL is often empty — the host
    // carries what looks like the path — so both are checked.
    const target = `${parsed.host || ''}${parsed.pathname || ''}`
    if (/reset-password/.test(target)) {
      handleRecoveryUrl(url, parsed)
      return
    }

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
 * Establish the recovery session from a reset-link URL, then route to the
 * set-password screen.
 *
 * Routed either way. If the token is bad, ResetPassword.jsx finds no session
 * and renders its own "link no longer valid" state with a path to request a
 * fresh one — which is a better outcome than silently dropping the tap.
 */
async function handleRecoveryUrl(rawUrl, parsedUrl) {
  try {
    const { parseRecoveryParams, establishRecoverySession } = await import(
      './passwordReset'
    )
    const params = parseRecoveryParams(rawUrl)
    if (params) await establishRecoverySession(params)
  } catch (err) {
    console.warn('[appLifecycle] recovery deep link failed:', err?.message)
  }

  if (typeof window !== 'undefined') {
    // Route without the fragment — the tokens are spent, and the screen reads
    // the session rather than the URL from here on.
    const query = parsedUrl?.search || ''
    window.dispatchEvent(
      new CustomEvent('app:deeplink', { detail: { path: `/reset-password${query}` } })
    )
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

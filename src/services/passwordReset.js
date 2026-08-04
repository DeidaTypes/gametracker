import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

/**
 * Password reset — request an email, and complete the reset once the link has
 * established a recovery session.
 *
 * ACCOUNT ENUMERATION
 * -------------------
 * requestPasswordReset() resolves the same way whether or not the address has
 * an account. It never rejects on "user not found", never returns a flag the
 * caller could branch on, and the UI shows one fixed message. An attacker who
 * can tell "this email is registered" from "this one isn't" gets a validated
 * user list for credential stuffing, so this is deliberate even though it makes
 * the flow slightly less helpful to a user who mistyped their address.
 *
 * Supabase's own resetPasswordForEmail() already does not distinguish the two
 * cases, but it DOES surface rate-limit errors. Those are swallowed here too:
 * a 429 is itself a signal (it means the address was accepted for sending), and
 * more importantly a user who taps twice should not see a scary error.
 *
 * THE REDIRECT (the part that has to work on device)
 * --------------------------------------------------
 * The email link has to land somewhere that can read the recovery token and
 * show a set-password form. On the web that is just a route. Inside the
 * Capacitor app it is not, because the WebView's origin is capacitor://localhost
 * and Supabase will not redirect to it.
 *
 * The approach here is the hybrid one:
 *   1. resetPasswordForEmail() always redirects to the PUBLIC WEB origin —
 *      `${APP_ORIGIN}/reset-password`. That URL is a real, working page, so the
 *      link is never dead: tapping it on a desktop, or on a phone without the
 *      app installed, sets the password in the browser.
 *   2. That page, when opened on iOS with the app installed, offers to hand off
 *      to `checkpoint://reset-password#<tokens>` (custom scheme registered in
 *      ios/App/App/Info.plist). appLifecycle.js picks that up via appUrlOpen
 *      and restores the recovery session in the app.
 *
 * Universal Links would remove the hand-off tap, but they need an
 * apple-app-site-association file hosted on the domain plus an Associated
 * Domains entitlement, neither of which exists in this repo yet. The custom
 * scheme works today with no server-side deployment.
 */

/**
 * Public web origin for links that have to survive leaving the app.
 *
 * Configured, not hardcoded: the repo still has `https://gametracker.app`
 * baked into inviteService.js and api/og.js from before the app was renamed to
 * Checkpoint, and guessing wrong here produces a reset link that 404s. Falls
 * back to the current origin on web, which is correct for local dev and for
 * any preview deployment.
 */
export function getAppOrigin() {
  const configured = import.meta.env.VITE_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/+$/, '')
  if (!Capacitor.isNativePlatform() && typeof window !== 'undefined') {
    return window.location.origin
  }
  return 'https://gametracker.app'
}

/** Custom URL scheme registered in ios/App/App/Info.plist. */
export const APP_URL_SCHEME = 'checkpoint'

export const RESET_PATH = '/reset-password'

export function getPasswordResetRedirectUrl() {
  return `${getAppOrigin()}${RESET_PATH}`
}

/**
 * The single message shown for every outcome of a reset request.
 * Exported so the screen and any future caller can't drift from each other.
 */
export const RESET_REQUEST_MESSAGE =
  'If an account exists for that email, we’ve sent a link to reset your password.'

/**
 * Send a password-reset email.
 *
 * Always resolves. Never tells the caller whether the address exists — see the
 * module header. Genuine faults are logged for us and swallowed for the user;
 * the one thing that is NOT swallowed is a malformed email, which is caught by
 * the form before we get here.
 *
 * @param {string} email
 * @returns {Promise<void>}
 */
export async function requestPasswordReset(email) {
  const address = (email || '').trim()
  if (!address) return

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: getPasswordResetRedirectUrl(),
    })
    if (error) {
      // Logged, never surfaced. Distinguishing "no such user" from "sent" in
      // the UI is precisely the leak this flow is designed to avoid, and
      // rate-limit errors leak the same fact by implication.
      console.warn('[passwordReset] request failed (suppressed):', error.message)
    }
  } catch (err) {
    console.warn('[passwordReset] request threw (suppressed):', err?.message)
  }
}

/**
 * Extract recovery credentials from a URL produced by the reset email.
 *
 * Supabase puts them in the hash fragment (implicit flow: access_token +
 * refresh_token + type=recovery) or the query string (PKCE flow: ?code=). Both
 * are handled because the flow type is a project-level Supabase setting we do
 * not control from here, and because the native hand-off re-serialises the URL.
 *
 * @param {string} [href] defaults to the current location
 * @returns {{ kind: 'tokens', accessToken: string, refreshToken: string }
 *          | { kind: 'code', code: string }
 *          | { kind: 'error', message: string }
 *          | null}
 */
export function parseRecoveryParams(href) {
  const url = href || (typeof window !== 'undefined' ? window.location.href : '')
  if (!url) return null

  let hash = ''
  let search = ''
  try {
    const parsed = new URL(url)
    hash = parsed.hash.replace(/^#/, '')
    search = parsed.search.replace(/^\?/, '')
  } catch {
    return null
  }

  const hashParams = new URLSearchParams(hash)
  const queryParams = new URLSearchParams(search)
  const pick = (key) => hashParams.get(key) || queryParams.get(key)

  // Supabase reports an expired or already-used link this way rather than by
  // omitting the tokens, so check it before looking for credentials.
  const errorDescription = pick('error_description') || pick('error')
  if (errorDescription) {
    return { kind: 'error', message: decodeURIComponent(errorDescription.replace(/\+/g, ' ')) }
  }

  const accessToken = pick('access_token')
  const refreshToken = pick('refresh_token')
  if (accessToken && refreshToken) {
    return { kind: 'tokens', accessToken, refreshToken }
  }

  const code = pick('code')
  if (code) return { kind: 'code', code }

  return null
}

/**
 * Turn the credentials from a reset link into a live session, so
 * completePasswordReset() can call updateUser().
 *
 * supabase-js with detectSessionInUrl:true does this on its own when the page
 * loads at the redirect URL on web. It cannot on native, where the app is
 * handed the URL by appUrlOpen long after the client initialised — hence the
 * explicit path.
 *
 * @param {ReturnType<typeof parseRecoveryParams>} params
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function establishRecoverySession(params) {
  if (!params) return { ok: false, message: 'This reset link is missing its token.' }
  if (params.kind === 'error') return { ok: false, message: params.message }

  try {
    if (params.kind === 'tokens') {
      const { error } = await supabase.auth.setSession({
        access_token: params.accessToken,
        refresh_token: params.refreshToken,
      })
      if (error) return { ok: false, message: error.message }
      return { ok: true }
    }

    const { error } = await supabase.auth.exchangeCodeForSession(params.code)
    if (error) return { ok: false, message: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err?.message || 'Could not verify this reset link.' }
  }
}

/**
 * Set the new password on the recovery session.
 *
 * Assumes the caller has already run the same policy checks sign-up runs
 * (composition + HaveIBeenPwned) — ResetPassword.jsx imports them from
 * services/passwordPolicy.js rather than re-deriving them, so the two screens
 * cannot enforce different rules.
 *
 * @param {string} password
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function completePasswordReset(password) {
  try {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      // Reusing the current password is the common, recoverable case; say so
      // instead of echoing Supabase's wording.
      if (/should be different|same as the old/i.test(error.message || '')) {
        return {
          ok: false,
          message: 'That’s already your password. Please choose a new one.',
        }
      }
      return { ok: false, message: error.message }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, message: err?.message || 'Could not update your password.' }
  }
}

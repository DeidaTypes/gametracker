import { supabase } from './supabase'
import { showToast } from '../components/Toast'

/**
 * The one implementation of "the app just came back to the foreground".
 *
 * Shared by both entry points so the two paths can't drift apart again:
 *   - NATIVE: src/services/appLifecycle.js (Capacitor `appStateChange`)
 *   - WEB / PWA: src/hooks/useAppResume.js (`visibilitychange`)
 * The web path previously had its own copy that dropped the realtime socket
 * without ever reopening it, so a browser resume left realtime dead forever.
 *
 * ORDERING IS THE WHOLE POINT
 * ---------------------------
 * Both paths used to `await` the auth session check before reconnecting
 * realtime and broadcasting APP_RESUMED_EVENT. Auth is the single flakiest
 * step in the sequence — it is the only one that touches the network and the
 * only one that can stall on the auth lock — and everything else was queued
 * behind it. When it hung or threw, realtime never reconnected and the 15+
 * listeners on APP_RESUMED_EVENT (Home feed, Explore, presence, notifications,
 * unread counts, every screen added in this change) never ran, so the app sat
 * on stale mount-time data until a force-quit.
 *
 * So the auth step is now started first but never awaited: realtime reconnect
 * and the resume broadcast run immediately, and the auth step is bounded by
 * its own timeout and retried on failure. Not gating the broadcast on a fresh
 * token is safe because supabase-js resolves the access token per request and
 * refreshes it itself when it finds one expired — the refresh here is an
 * optimisation that keeps the first post-resume request from paying for it,
 * not a correctness requirement.
 */

/**
 * Fired on every resume. Screens and data hooks listen for it to reload, and
 * realtime providers listen for it to re-subscribe.
 *
 * Re-exported from src/hooks/useAppResume.js, which is where the rest of the
 * app imports it from.
 */
export const APP_RESUMED_EVENT = 'app:resumed'

/**
 * Fired when session revalidation has failed every automatic retry, with
 * `{ source, message }`. Carries no recovery of its own — it exists so the UI
 * can offer the user a retry rather than sit on a screen that won't load.
 */
export const RESUME_AUTH_FAILED_EVENT = 'app:resume-auth-failed'

/** Treat a token with less than this left on it as already stale. */
const NEAR_EXPIRY_MS = 60_000

/**
 * Ceiling for one auth call in the resume sequence. Deliberately far tighter
 * than the AUTH_CALL_TIMEOUT_MS backstop in services/supabase.js (30 s+):
 * that one exists to stop a stall from being permanent, this one exists to
 * decide quickly that this attempt isn't going to land so we can retry. It is
 * only ever a retry trigger — nothing waits on this promise.
 */
const AUTH_STEP_TIMEOUT_MS = 10_000

/**
 * Backoff between revalidation attempts. Long tail on purpose: the usual
 * reason a resume-time refresh fails is that the radio hasn't reassociated
 * yet, which resolves on its own within a few seconds.
 */
const AUTH_RETRY_DELAYS_MS = [2_000, 8_000, 20_000]

/**
 * Bumped by every resume. A retry chain from an older resume is abandoned
 * rather than allowed to fight the current one — otherwise a background /
 * foreground / background flurry leaves several chains refreshing at once.
 */
let resumeGeneration = 0
let retryTimer = null

function cancelPendingRetry() {
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

function dispatch(name, detail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    detail === undefined ? new Event(name) : new CustomEvent(name, { detail })
  )
}

/**
 * Settle `promise` as a rejection after `ms` even if it never settles itself.
 * Racing our own timer (rather than trusting the callee to time out) is the
 * same defence fetchWithTimeout documents: in WKWebView a stalled promise can
 * stay pending forever, and `.catch()` on a pending promise never runs.
 */
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} did not settle within ${ms}ms`))
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Reopen the realtime socket.
 *
 * iOS tears the WebSocket down while the WebView is suspended and freezes the
 * reconnect timer with it, so what's left is a half-open zombie that never
 * recovers on its own. Dropping it explicitly forces a fresh socket.
 */
function reconnectRealtime() {
  try {
    supabase.realtime.disconnect()
    supabase.realtime.connect()
    // Channels open before suspension are closed by the disconnect above and
    // won't rejoin by themselves.
    supabase.realtime.channels?.forEach((channel) => {
      try {
        channel.subscribe()
      } catch {
        // Already subscribing — nothing to do.
      }
    })
  } catch (err) {
    console.warn('[resume] realtime reconnect failed:', err)
  }
}

/**
 * Read the stored session and refresh the token if it is at or near expiry.
 *
 * Throws on failure — including when getSession() reports an `error`, which
 * both callers used to destructure past and discard. A getSession() error is
 * not cosmetic: it means we don't know whether we still have a usable token,
 * which is exactly the case that needs a retry.
 *
 * On a successful refresh, pushing the new token to the realtime socket is
 * supabase-js's job: it listens for its own TOKEN_REFRESHED and calls
 * realtime.setAuth(), so the socket opened by reconnectRealtime() picks the
 * new token up whether it was opened before or after this lands.
 */
async function revalidateSession() {
  const { data, error } = await withTimeout(
    supabase.auth.getSession(),
    AUTH_STEP_TIMEOUT_MS,
    'auth.getSession()'
  )
  if (error) throw error

  const session = data?.session
  if (!session) return // signed out — nothing to refresh, and not a failure

  const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0
  const nearExpiry = expiresAtMs > 0 && expiresAtMs - Date.now() < NEAR_EXPIRY_MS
  if (!nearExpiry) return

  const { error: refreshError } = await withTimeout(
    supabase.auth.refreshSession(),
    AUTH_STEP_TIMEOUT_MS,
    'auth.refreshSession()'
  )
  if (refreshError) throw refreshError
}

/**
 * Run the auth step, retrying with backoff. Never rejects — it is intentionally
 * launched un-awaited, so a rejection here would surface as an unhandled
 * promise rejection rather than reaching anyone who could act on it.
 */
async function revalidateWithRetry(generation, source, attempt = 0) {
  try {
    await revalidateSession()
    if (generation !== resumeGeneration) return

    if (attempt > 0) {
      // The broadcast that already went out was served by a token we couldn't
      // vouch for, so anything it triggered may have failed to authenticate.
      // Now that the session is good, redo the parts that depend on it.
      reconnectRealtime()
      dispatch(APP_RESUMED_EVENT)
    }
  } catch (err) {
    if (generation !== resumeGeneration) return

    const totalAttempts = AUTH_RETRY_DELAYS_MS.length + 1
    console.warn(
      `[resume] session revalidation failed (${source}, attempt ` +
        `${attempt + 1}/${totalAttempts}):`,
      err
    )

    const delay = AUTH_RETRY_DELAYS_MS[attempt]
    if (delay === undefined) {
      offerManualRetry(source, err)
      return
    }

    retryTimer = setTimeout(() => {
      retryTimer = null
      revalidateWithRetry(generation, source, attempt + 1)
    }, delay)
  }
}

/**
 * Last resort after the automatic retries are exhausted: hand the user the
 * retry instead of leaving them on a screen that quietly won't load. Kept as a
 * toast action rather than a blocking dialog because the app is still usable —
 * anon-readable content renders fine, it's the authenticated queries that fail.
 */
function offerManualRetry(source, err) {
  // Emitted alongside the toast so a screen can render its own inline retry
  // affordance if it wants one; the toast is dropped if ToastHost isn't
  // mounted yet, whereas this always fires.
  dispatch(RESUME_AUTH_FAILED_EVENT, { source, message: err?.message })

  showToast("Couldn't refresh your session", 'error', 8000, {
    label: 'Retry',
    onClick: () => runResumeSequence(`${source}:manual-retry`),
  })
}

/**
 * Recover from a resume. Safe to call repeatedly; each call supersedes any
 * retry chain still pending from an earlier one.
 *
 * @param {string} source Label for logs, e.g. 'native' or 'visibilitychange'.
 */
export function runResumeSequence(source = 'unknown') {
  const generation = ++resumeGeneration
  cancelPendingRetry()

  // Started first so its network round trip overlaps the work below, but
  // deliberately NOT awaited — see ORDERING above.
  revalidateWithRetry(generation, source)

  reconnectRealtime()
  dispatch(APP_RESUMED_EVENT)
}

/**
 * Abandon any in-flight retry chain when the app goes back to the background.
 * The timer would be frozen by the OS anyway and fire the instant the CPU
 * wakes, racing the fresh sequence that the next foreground starts.
 */
export function cancelResumeSequence() {
  resumeGeneration += 1
  cancelPendingRetry()
}

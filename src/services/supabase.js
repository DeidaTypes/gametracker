import { createClient } from '@supabase/supabase-js'
import { fetchWithTimeout, DEFAULT_FETCH_TIMEOUT_MS } from '../utils/fetchWithTimeout'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Hard fail loudly in dev. Without these, every auth call would silently
  // 401 and the empty-state debugging spiral is brutal. Better to crash
  // here with an actionable message.
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Add them to your .env file at the project root and restart `npm run dev`.'
  )
}

/**
 * App-wide Supabase client.
 *
 * persistSession + autoRefreshToken keep the user logged in across page
 * reloads (session is stored in localStorage by default). detectSessionInUrl
 * lets future flows (magic link, OAuth) automatically pick up the session
 * fragment after a redirect back to the app.
 *
 * The `lock` override disables Supabase's Web Locks-based auth coordination.
 * That coordination is meant to prevent two tabs from refreshing the same
 * token simultaneously, but in practice (especially with React Strict Mode
 * in dev) it throws AbortError: "Lock broken by another request" whenever
 * two requests race the auth subsystem. For a single-user mobile-first app
 * the cross-tab coordination is unnecessary, so we pass through directly.
 *
 * The `global.fetch` override wraps every REST/auth request in a timeout so a
 * connection the device can't reach (or a server that never responds) becomes
 * a normal rejection instead of an indefinitely-pending promise. Without this,
 * a single hung request pins a loading spinner forever even though callers
 * resolve their loading flag in `finally` — because `finally` never runs on a
 * promise that never settles.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    lock: async (name, acquireTimeout, fn) => fn(),
  },
  global: {
    fetch: (input, init) => fetchWithTimeout(input, init),
  },
})

/* ============================================================
   Defensive timeout guard on the session-reading auth methods
   ============================================================ */

/**
 * Ceiling for a single auth call, chosen so it can only ever fire on a
 * genuine stall and never preempt work supabase-js still considers live:
 * auth-js gives its own token-refresh retry loop a 30 s window
 * (AUTO_REFRESH_TICK_DURATION_MS), inside which it may launch one more
 * request that our fetch wrapper bounds at DEFAULT_FETCH_TIMEOUT_MS.
 */
export const AUTH_CALL_TIMEOUT_MS = 30_000 + DEFAULT_FETCH_TIMEOUT_MS

/**
 * `global.fetch` above cannot protect the auth subsystem on its own, because
 * an auth call can hang *before* it ever reaches the network — waiting on the
 * internal auth lock. That is exactly what a subscriber awaiting a Supabase
 * call from inside onAuthStateChange used to cause (see the DEADLOCK HAZARD
 * note in services/auth.js): getSession() never settled, and since
 * SupabaseClient resolves the access token for every PostgREST request via
 * `this.auth.getSession()`, every data query hung behind it too, for the rest
 * of the process.
 *
 * services/auth.js fixes the cause. This is the backstop that keeps any
 * future lock stall from being unrecoverable: the call settles as a normal
 * error, so the `if (error)` / `finally` paths callers already have will run
 * and the app degrades to "signed out / failed to load" instead of a
 * permanent hang that only a force-quit clears.
 *
 * Timing out resolves an auth-js-shaped `{ data, error }` rather than
 * rejecting, both because that is the contract every call site here is
 * written against and because SupabaseClient's own token lookup destructures
 * `data.session` without a null check.
 */
const GUARDED_AUTH_METHODS = {
  getSession: () => ({ session: null }),
  getUser: () => ({ user: null }),
  refreshSession: () => ({ user: null, session: null }),
}

for (const [method, emptyData] of Object.entries(GUARDED_AUTH_METHODS)) {
  const original = supabase.auth[method].bind(supabase.auth)
  supabase.auth[method] = (...args) => {
    let timer
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.error(
          `[supabase] auth.${method}() did not settle within ` +
            `${AUTH_CALL_TIMEOUT_MS}ms — treating it as failed. This should ` +
            'not happen; it points at an auth-lock stall.'
        )
        const error = new Error(`auth.${method}() timed out`)
        error.name = 'AuthTimeoutError'
        resolve({ data: emptyData(), error })
      }, AUTH_CALL_TIMEOUT_MS)
    })
    return Promise.race([original(...args), timeout]).finally(() => {
      clearTimeout(timer)
    })
  }
}

/* ============================================================
   Shared-result memo on auth.getUser()
   ============================================================ */

/**
 * `auth.getUser()` is a network call to /auth/v1/user, and roughly sixty
 * service functions call it independently to learn "who am I?" before
 * running their real query. Entering a screen therefore fires it many
 * times over — and because every one of those requests targets the exact
 * same URL, the browser will not run them concurrently: it serializes
 * them behind whichever is already in flight. Measured on the Home feed,
 * that turned 17 redundant identity checks into a 2.4-second serial chain
 * during which no useful data was fetched at all.
 *
 * The identity being fetched is the same for all of them, so we resolve
 * it once and share the answer:
 *
 *   - Calls arriving while a request is in flight get that same promise
 *     rather than issuing another request.
 *   - A successful result is reused for MEMO_TTL_MS, long enough to cover
 *     one screen's burst of callers without holding a stale identity.
 *   - Failures are never cached, so a transient error doesn't stick.
 *
 * Correctness comes from invalidation rather than a short TTL: any auth
 * state change (sign-in, sign-out, token refresh, user update) drops the
 * memo immediately, so callers can never observe a user the client has
 * already moved on from. Calls that pass an explicit JWT bypass the memo
 * entirely — they're asking about a *different* identity than the
 * session's.
 */
const MEMO_TTL_MS = 30_000

let userMemo = null

/** Drop the memoized identity so the next `getUser()` is a real request. */
export function invalidateUserMemo() {
  userMemo = null
}

const guardedGetUser = supabase.auth.getUser.bind(supabase.auth)

supabase.auth.getUser = (jwt) => {
  if (jwt !== undefined) return guardedGetUser(jwt)

  if (userMemo) {
    const isInFlight = userMemo.settledAt === null
    if (isInFlight || Date.now() - userMemo.settledAt < MEMO_TTL_MS) {
      return userMemo.promise
    }
  }

  const entry = { settledAt: null, promise: null }
  entry.promise = guardedGetUser().then(
    (result) => {
      // Only a successful lookup is worth sharing; caching an error would
      // pin every caller in the window to the same transient failure.
      if (result?.error) userMemo = null
      else if (userMemo === entry) entry.settledAt = Date.now()
      return result
    },
    (err) => {
      if (userMemo === entry) userMemo = null
      throw err
    }
  )
  userMemo = entry
  return entry.promise
}

supabase.auth.onAuthStateChange(() => {
  // Synchronous by design: supabase-js runs subscribers inside its auth
  // lock and awaits whatever they return, so this must never be async.
  invalidateUserMemo()
})

export default supabase
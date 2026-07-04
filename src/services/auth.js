import { supabase } from './supabase'

/**
 * Auth service — wraps Supabase auth + profile-row bootstrap.
 *
 * The `users` table is keyed by the same UUID as the auth user, so
 * `auth.users.id === public.users.id`. Profile fields beyond display_name
 * (username, bio, avatar_url, genre_badge, platform_badge) start null and
 * are filled in via Edit Profile.
 *
 * Schema (matches BACKEND_SCHEMA.md):
 *   users (
 *     id              uuid PRIMARY KEY REFERENCES auth.users(id),
 *     display_name    text NOT NULL,
 *     username        text UNIQUE,
 *     bio             text,
 *     avatar_url      text,
 *     genre_badge     text,
 *     platform_badge  text,
 *     created_at      timestamptz NOT NULL DEFAULT now()
 *   )
 */

/* ============================================================
   Error classification
   ============================================================ */

export const AUTH_ERRORS = Object.freeze({
  INVALID_CREDENTIALS: 'invalid_credentials',
  EMAIL_TAKEN: 'email_taken',
  WEAK_PASSWORD: 'weak_password',
  USERNAME_TAKEN: 'username_taken',
  USERNAME_INVALID: 'username_invalid',
  NETWORK: 'network',
  PROFILE_BOOTSTRAP_FAILED: 'profile_bootstrap_failed',
  UNKNOWN: 'unknown',
})

// Handle format mirrored from EditProfileModal / profileService so the
// signup-time rule and the edit-profile rule never drift apart.
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/

/** Lowercase + strip a leading @ and any disallowed characters. */
export function normalizeUsername(input) {
  return (input || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_]/g, '')
}

function isNetworkError(err) {
  if (!err) return false
  // Supabase wraps fetch errors as TypeError("Failed to fetch") in browsers
  // and AuthRetryableFetchError when retries are exhausted.
  if (err.name === 'AuthRetryableFetchError') return true
  if (err.name === 'TypeError' && /fetch/i.test(err.message || '')) return true
  if (/network|failed to fetch|load failed|offline/i.test(err.message || '')) {
    return true
  }
  return false
}

function classifySignInError(err) {
  if (!err) return null
  if (isNetworkError(err)) return AUTH_ERRORS.NETWORK
  const msg = err.message || ''
  // Supabase returns 400 + "Invalid login credentials" for both wrong email
  // and wrong password (intentional, to avoid leaking which is wrong).
  if (/invalid login credentials/i.test(msg)) {
    return AUTH_ERRORS.INVALID_CREDENTIALS
  }
  if (err.status === 400) return AUTH_ERRORS.INVALID_CREDENTIALS
  return AUTH_ERRORS.UNKNOWN
}

function classifySignUpError(err) {
  if (!err) return null
  if (isNetworkError(err)) return AUTH_ERRORS.NETWORK
  const msg = err.message || ''
  // Supabase newer SDKs use code "user_already_exists"; older ones return
  // "User already registered" via message.
  if (
    err.code === 'user_already_exists' ||
    /already registered|already exists/i.test(msg)
  ) {
    return AUTH_ERRORS.EMAIL_TAKEN
  }
  if (err.code === 'weak_password' || /password/i.test(msg)) {
    return AUTH_ERRORS.WEAK_PASSWORD
  }
  return AUTH_ERRORS.UNKNOWN
}

class AuthError extends Error {
  constructor(code, message, cause) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.cause = cause
  }
}

/**
 * Wipe any session already sitting in the Supabase client/local storage
 * before starting a brand-new signUp()/logIn() attempt.
 *
 * Without this, if the device/browser already has a live session (a
 * previous test account, or the user tapping "sign up" without signing out
 * first), that old session's tokens stay live in the *same* client instance
 * throughout the new attempt: its autoRefreshToken timer can still fire, and
 * a manual getSession()/onAuthStateChange listener elsewhere in the app can
 * still read it. Any of those can emit an auth event for the OLD account
 * that lands after the new signUp/logIn's own SIGNED_IN event, which is
 * exactly what produced "signs up as a new email, lands on the SAME cached
 * account every time."
 *
 * `scope: 'local'` clears local storage + stops the client's internal
 * refresh timer for that session WITHOUT a network round trip to revoke it
 * server-side — there's no need to revoke an old session just because the
 * user is starting a new one, and a network call here would slow down (and
 * could fail/hang) every signup/login attempt for no benefit.
 */
async function clearLocalSession() {
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // Best-effort — if this fails for some reason, proceeding with the
    // signUp/logIn call below is still correct; worst case we're back to
    // needing AuthContext's explicit-op guard to win the race.
  }
}

/* ============================================================
   Profile-row bootstrap (signup hot path)
   ============================================================ */

// True when a Postgres unique-violation is on the username index rather
// than the primary key (id). A pkey clash means "row already exists from a
// retry" (recoverable); a username clash means the handle is taken.
function isUsernameConflict(error) {
  const haystack = `${error?.message || ''} ${error?.details || ''}`
  return /users_username_key|\busername\b/i.test(haystack)
}

async function insertProfileRowWithRetry({ id, displayName, username }, attempts = 3) {
  // Supabase doesn't expose multi-statement transactions to the JS client,
  // so we approximate atomicity via retry-on-failure. If all retries fail
  // we still surface the error so the caller can decide what to do (we
  // currently keep the auth user but flag the broken state to the UI).
  let lastErr = null
  for (let i = 0; i < attempts; i++) {
    const { error } = await supabase.from('users').insert({
      id,
      display_name: displayName,
      // username is UNIQUE and nullable — only write it when supplied so
      // the unique index isn't tripped by multiple NULLs (Postgres allows
      // many NULLs in a unique column, but being explicit keeps intent
      // clear).
      ...(username ? { username } : {}),
      // created_at is also DB-defaulted, but stamp it client-side too so
      // the row sorts correctly in any read-after-write before the DB
      // round-trips.
      created_at: new Date().toISOString(),
    })
    if (!error) return
    lastErr = error
    // 23505 = unique_violation. A username clash must surface to the user
    // (the handle is taken); a primary-key clash means the row already
    // exists from a prior attempt whose response was lost — treat as success.
    if (error.code === '23505') {
      if (isUsernameConflict(error)) {
        throw new AuthError(
          AUTH_ERRORS.USERNAME_TAKEN,
          'That username is already taken. Please choose another.',
          error
        )
      }
      return
    }
    // Don't bother retrying validation errors (4xx-ish on PostgREST).
    if (error.code && /^[24]/.test(error.code)) break
    // Backoff: 200ms, 600ms, 1200ms.
    await new Promise((r) => setTimeout(r, 200 * (i + 1) * (i + 1)))
  }
  throw lastErr || new Error('Failed to insert profile row')
}

/**
 * Best-effort check that a username isn't already taken. Relies on the
 * `users_select_all` RLS policy (readable by anon) so it can run *before*
 * the auth user is created — avoiding an orphaned auth account when the
 * handle is unavailable. The DB unique index is still the source of truth;
 * this is just for a clean pre-flight error.
 *
 * @returns {Promise<boolean>} true when the handle appears available
 */
export async function isUsernameAvailableRemote(username) {
  const handle = normalizeUsername(username)
  if (!handle) return true
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .ilike('username', handle)
    .maybeSingle()
  if (error) {
    // Soft-fail open: if the check itself errors we let the unique index
    // be the backstop rather than blocking a legitimate signup.
    console.warn('[auth] username availability check failed:', error.message)
    return true
  }
  return !data
}

/* ============================================================
   Public API
   ============================================================ */

/**
 * Create an auth user and a matching `users` row.
 *
 * Two-step process:
 *   1. supabase.auth.signUp({ email, password })
 *   2. insert into public.users with the same id + display_name
 *
 * If step 2 fails after retries, the auth user IS already created. We can't
 * delete it from the client (admin API only), so we throw with a specific
 * code and the caller should surface "your account was partially created,
 * please contact support" rather than silently leaving a half-baked user.
 *
 * @param {{ email: string, password: string, displayName: string, username?: string }} args
 * @returns {Promise<{ user: object, session: object|null, profile: object }>}
 */
export async function signUp({ email, password, displayName, username }) {
  // Must happen before anything else — see clearLocalSession() for why.
  await clearLocalSession()

  const trimmedDisplayName = (displayName || '').trim()
  if (!trimmedDisplayName) {
    throw new AuthError(
      AUTH_ERRORS.UNKNOWN,
      'Display name is required to create an account.'
    )
  }

  // Normalize + validate the optional username up front so we never create
  // an auth user for an obviously-invalid handle.
  const normalizedUsername = normalizeUsername(username)
  if (normalizedUsername && !USERNAME_PATTERN.test(normalizedUsername)) {
    throw new AuthError(
      AUTH_ERRORS.USERNAME_INVALID,
      'Username must be 3–20 characters (letters, numbers, underscores).'
    )
  }

  // Pre-flight availability check (before the auth user exists) so a taken
  // handle doesn't leave an orphaned auth account behind.
  if (normalizedUsername) {
    const available = await isUsernameAvailableRemote(normalizedUsername)
    if (!available) {
      throw new AuthError(
        AUTH_ERRORS.USERNAME_TAKEN,
        'That username is already taken. Please choose another.'
      )
    }
  }

  let authData
  try {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) {
      throw new AuthError(classifySignUpError(error), error.message, error)
    }
    authData = data
  } catch (err) {
    if (err instanceof AuthError) throw err
    if (isNetworkError(err)) {
      throw new AuthError(
        AUTH_ERRORS.NETWORK,
        'Could not reach the server.',
        err
      )
    }
    throw new AuthError(AUTH_ERRORS.UNKNOWN, err.message || 'Sign up failed', err)
  }

  const { user, session } = authData
  if (!user) {
    // Confirm-email mode: no user object until they click the link. We
    // disable confirm-email for alpha (per spec), so this is a safety net.
    throw new AuthError(
      AUTH_ERRORS.UNKNOWN,
      'Account created but not yet active. Please verify your email and try again.'
    )
  }

  // Profile-row bootstrap. If this throws we surface a specific error so
  // the UI can warn the user — the auth user exists but the profile row
  // does not, which leaves them in a broken state.
  let profile
  try {
    await insertProfileRowWithRetry({
      id: user.id,
      displayName: trimmedDisplayName,
      username: normalizedUsername || null,
    })
    const { data: profileRow, error: fetchErr } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()
    if (fetchErr) throw fetchErr
    profile = profileRow
  } catch (err) {
    // A taken username is a normal, user-correctable condition — surface
    // it as-is rather than collapsing it into the generic bootstrap error.
    if (err instanceof AuthError && err.code === AUTH_ERRORS.USERNAME_TAKEN) {
      throw err
    }
    throw new AuthError(
      AUTH_ERRORS.PROFILE_BOOTSTRAP_FAILED,
      'Your account was created, but we could not finish setting up your profile. Please log in and try again, or contact support.',
      err
    )
  }

  return { user, session, profile }
}

/**
 * @param {{ email: string, password: string }} args
 * @returns {Promise<{ user: object, session: object, profile: object|null }>}
 */
export async function logIn({ email, password }) {
  // Same reasoning as signUp() — see clearLocalSession().
  await clearLocalSession()

  let data
  try {
    const res = await supabase.auth.signInWithPassword({ email, password })
    if (res.error) {
      throw new AuthError(classifySignInError(res.error), res.error.message, res.error)
    }
    data = res.data
  } catch (err) {
    if (err instanceof AuthError) throw err
    if (isNetworkError(err)) {
      throw new AuthError(
        AUTH_ERRORS.NETWORK,
        'Could not reach the server.',
        err
      )
    }
    throw new AuthError(AUTH_ERRORS.UNKNOWN, err.message || 'Login failed', err)
  }

  const profile = await fetchProfile(data.user.id)
  return { user: data.user, session: data.session, profile }
}

export async function logOut() {
  const { error } = await supabase.auth.signOut()
  if (error) {
    if (isNetworkError(error)) {
      throw new AuthError(AUTH_ERRORS.NETWORK, error.message, error)
    }
    throw new AuthError(AUTH_ERRORS.UNKNOWN, error.message, error)
  }
}

/**
 * Returns the currently-authenticated Supabase user joined with their row
 * from the `users` table. Returns null if there's no active session.
 *
 * @returns {Promise<{ user: object, profile: object|null } | null>}
 */
export async function getCurrentUser() {
  // getSession() reads from local storage and is synchronous on the wire
  // (no network round-trip), which makes it the right call for boot-time
  // session restore. getUser() would force a network call every load.
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession()
  if (sessionErr) return null
  const session = sessionData?.session
  if (!session?.user) return null

  const profile = await fetchProfile(session.user.id)
  return { user: session.user, profile }
}

/**
 * Subscribe to auth state changes (sign in, sign out, token refresh).
 *
 * The callback receives ({ event, session, user, profile }). We resolve the
 * profile row before invoking the callback so consumers don't have to.
 *
 * Each firing does its own async profile-fetch round trip, so multiple
 * events (or an event racing a signUp/logIn/getSession call elsewhere) can
 * resolve out of order. `onEventStart`, when provided, is invoked
 * synchronously the moment the raw event arrives (before the profile fetch)
 * so the caller can stamp an ordering token at *receipt* time rather than at
 * *resolution* time, and use it to discard stale/out-of-order deliveries.
 *
 * @param {(payload: { event: string, session: object|null, user: object|null, profile: object|null }, token: any) => void} callback
 * @param {() => any} [onEventStart] optional hook called synchronously per event; its return value is threaded through to `callback` as `token`.
 * @returns {() => void} unsubscribe
 */
export function onAuthStateChange(callback, onEventStart) {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(async (event, session) => {
    const token = typeof onEventStart === 'function' ? onEventStart() : undefined
    const user = session?.user || null
    let profile = null
    if (user) {
      try {
        profile = await fetchProfile(user.id)
      } catch {
        profile = null
      }
    }
    callback({ event, session, user, profile }, token)
  })
  return () => {
    subscription?.unsubscribe?.()
  }
}

/* ============================================================
   Internal helpers
   ============================================================ */

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    // We don't throw here — a missing profile row is recoverable (the user
    // can still log in; AuthContext will expose user without profile).
    // eslint-disable-next-line no-console
    console.warn('[auth] Failed to load profile row:', error.message)
    return null
  }
  return data
}

export { AuthError }

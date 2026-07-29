import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  signUp as authSignUp,
  logIn as authLogIn,
  logOut as authLogOut,
  getCurrentUser,
  onAuthStateChange,
} from '../services/auth'
import {
  loadCurrentUserReviewsCache,
  clearReviewCache,
  migrateLocalReviewsIfNeeded,
} from '../services/reviewService'
import { migrateLocalListsIfNeeded } from '../services/listService'
import { migrateLocalLikesIfNeeded } from '../services/likeService'
import { syncProfileFromSupabase } from '../services/profileService'
import { loadBlockedIds, clearBlockCache } from '../services/blockService'

const AuthContext = createContext(null)

/**
 * Wraps the app and exposes:
 *   { user, profile, loading, signUp, logIn, logOut }
 *
 * `loading` is true only while the *initial* session restore is in flight.
 * After the first resolution it stays false even during subsequent sign-in
 * / sign-out transitions, so route guards don't flicker.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Track mounted state so async effects don't setState after unmount —
  // mostly a footgun in dev with React 18 StrictMode double-mount.
  const mountedRef = useRef(true)

  // ── Auth request-sequence guard ─────────────────────────────────────────
  //
  // `user`/`profile` state has FOUR independent writers: the initial session
  // restore, the onAuthStateChange listener (which itself can fire multiple
  // times: INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT...),
  // signUp(), and logIn(). Each does its own async round trip (profile
  // fetch, or the signUp/login network call itself), so — especially with
  // the Supabase `lock` override disabled (required for Capacitor; see
  // supabase.js) — nothing serializes them relative to each other.
  //
  // A first attempt at fixing this gave every writer a monotonically
  // increasing token and only let the *most-recently-issued* token apply.
  // That was insufficient: signUp()/logIn() ARE the operations that cause
  // supabase-js to emit an auth event (SIGNED_IN) as an internal side
  // effect, part-way through their own call. Under "most recent token
  // wins," that ambient echo of our own call — or, worse, an unrelated
  // stale/ambient event from a session that already existed before signUp()
  // ran (boot-time restore, or the client's autoRefreshToken timer for that
  // old session) — always grabs a *newer* token than the one signUp()
  // captured at its own start, so signUp()'s own state write was silently
  // discarded every single time in favor of whatever the listener produced.
  // The listener's echo of a brand-new signup often raced its own
  // fetchProfile against the not-yet-inserted profile row (fetchProfile ran
  // before insertProfileRowWithRetry finished) and, worse, an old session
  // left in storage from previous testing was never cleared, so its
  // autoRefreshToken timer could fire — deterministically, for whichever
  // account happened to already be cached — and overwrite state with that
  // unrelated account. That's why the symptom changed from "random account"
  // to "same account every time": it stopped being a resolution-order race
  // and became a deterministic "ambient events always beat explicit calls"
  // bug feeding off a session that was never explicitly cleared.
  //
  // Fix: split writers into two classes.
  //   - EXPLICIT ops (signUp/logIn/logOut) are user-initiated. While one is
  //     in flight (`explicitInFlightRef`), NO ambient writer may touch
  //     state at all — the explicit op is authoritative. When it commits,
  //     it stamps a fresh "commit watermark" token (`lastExplicitCommitRef`).
  //   - AMBIENT writers (boot restore, onAuthStateChange) may only apply
  //     their result if (a) no explicit op is currently in flight, (b) their
  //     token was issued *after* the last explicit commit watermark — so a
  //     stale event received *during* an explicit op's flight can never
  //     apply even if it resolves after the flag clears — and (c) no newer
  //     ambient/explicit token has been issued since (ordinary "latest
  //     wins" for legitimate ambient-vs-ambient races, e.g. two auth events
  //     firing close together).
  const authSeqRef = useRef(0)
  const beginAuthOp = useCallback(() => {
    authSeqRef.current += 1
    return authSeqRef.current
  }, [])
  // Token of the currently in-flight explicit op, or null when none is
  // running. Set at the start of signUp/logIn/logOut, cleared once that
  // same op has committed (or failed) — see runExplicitAuthOp below.
  const explicitInFlightRef = useRef(null)
  // Token watermark stamped the instant the most recent explicit op
  // committed its state. Ambient writers must be newer than this to apply.
  const lastExplicitCommitRef = useRef(0)
  const canApplyAmbientWrite = useCallback((token) => {
    if (explicitInFlightRef.current !== null) return false
    if (token <= lastExplicitCommitRef.current) return false
    return authSeqRef.current === token
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Initial session restore. Runs once on mount.
  useEffect(() => {
    let cancelled = false
    const token = beginAuthOp()
    ;(async () => {
      try {
        const result = await getCurrentUser()
        if (cancelled || !canApplyAmbientWrite(token)) return
        if (result) {
          setUser(result.user)
          setProfile(result.profile)
        } else {
          setUser(null)
          setProfile(null)
        }
      } catch {
        if (!cancelled && canApplyAmbientWrite(token)) {
          setUser(null)
          setProfile(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [beginAuthOp, canApplyAmbientWrite])

  // Keep the localStorage profile mirror (read synchronously by the
  // own-profile UI) in step with the authoritative Supabase row. This is
  // what makes the name + username captured at signup show up everywhere
  // and survive a reinstall / different device — without it the local
  // store would fall back to its empty default.
  useEffect(() => {
    if (profile) syncProfileFromSupabase(profile)
  }, [profile])

  // Subscribe to auth state changes (sign in / out / token refresh).
  //
  // `onEventStart` stamps the ordering token synchronously the instant the
  // raw event is *received* (before onAuthStateChange's internal profile
  // fetch runs), so two events firing close together are ordered by receipt
  // order rather than by however long their individual profile fetches take.
  //
  // That indirection is load-bearing: onAuthStateChange deliberately defers
  // the profile fetch AND this callback into a later macrotask, because
  // awaiting a Supabase call inside the raw listener deadlocks the client
  // (see the DEADLOCK HAZARD note in services/auth.js). Delivery can
  // therefore land arbitrarily late relative to its event — which the guard
  // below already handles, since every decision it makes is a function of the
  // receipt-time token and never of when the payload happens to arrive.
  useEffect(() => {
    const unsubscribe = onAuthStateChange(
      ({ user: nextUser, profile: nextProfile }, token) => {
        if (!mountedRef.current) return
        if (!canApplyAmbientWrite(token)) return
        setUser(nextUser)
        setProfile(nextProfile)
      },
      beginAuthOp
    )
    return unsubscribe
  }, [beginAuthOp, canApplyAmbientWrite])

  // When user resolves, run the one-time localStorage→Supabase review
  // migration (idempotent per-user, no-ops after the first success) and
  // hydrate the in-memory current-user review cache that downstream
  // sync helpers (profile stats, smart lists, mock community) read from.
  // When the user logs out, clear the cache so a subsequent login by a
  // different account doesn't see the previous user's reviews.
  //
  // Also pre-warm the block cache here so community feed queries (Explore,
  // Home timeline) never pay the auth.getUser() + blocked_users round-trip
  // at page-render time — they will find the cache already populated.
  useEffect(() => {
    if (!user) {
      clearReviewCache()
      clearBlockCache()
      return
    }
    // Fire-and-forget: warm the block cache so Explore queries are instant.
    loadBlockedIds().catch(() => {})
    let cancelled = false
    ;(async () => {
      try {
        await migrateLocalReviewsIfNeeded(user.id)
        await migrateLocalListsIfNeeded(user.id)
        // Sprint 6 P0 — fold the legacy `gt:likes:v1` localStorage
        // blob into the new `likes` table. Idempotent per-user and
        // soft-fails so it never blocks login.
        await migrateLocalLikesIfNeeded(user.id)
        await loadCurrentUserReviewsCache(user.id)
        if (!cancelled) {
          // Tell any mounted screens (Profile reviews tab, etc.) to refresh.
          window.dispatchEvent(new Event('reviewAdded'))
        }
      } catch (err) {
        // Cache hydration failures are non-fatal — the app still works,
        // sync legacy helpers just return empty until next reload.
        // eslint-disable-next-line no-console
        console.warn('[auth] review cache hydrate failed:', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  // Shared runner for signUp/logIn/logOut. `run` performs the actual
  // Supabase call and returns the { user, profile } to commit (or null to
  // commit a signed-out state). Marks this op as the authoritative
  // "in-flight explicit op" for its entire duration so no ambient writer
  // (onAuthStateChange's echo of this very call included) can sneak state
  // in ahead of, or instead of, our own result — see the guard comment
  // above for the full "why" this exists.
  const runExplicitAuthOp = useCallback(async (run) => {
    const startToken = beginAuthOp()
    explicitInFlightRef.current = startToken
    try {
      const result = await run()
      // Bail if a *newer* explicit op has since taken over (e.g. the user
      // triggered logOut while this one was still resolving) — never
      // downgrade state to a stale explicit result either.
      if (explicitInFlightRef.current !== startToken) return result
      // Re-stamp a fresh token at commit time and record it as the
      // watermark ambient writers must clear. Any auth event received
      // *during* this call's network round trip (our own SIGNED_IN echo,
      // or a stale event from whatever session existed before this call
      // cleared it) already grabbed a token at or below this watermark, so
      // it can never be applied afterward — regardless of when its own
      // async work (e.g. its profile fetch) happens to resolve.
      lastExplicitCommitRef.current = beginAuthOp()
      if (result) {
        setUser(result.user)
        setProfile(result.profile)
      } else {
        setUser(null)
        setProfile(null)
      }
      return result
    } finally {
      if (explicitInFlightRef.current === startToken) {
        explicitInFlightRef.current = null
      }
    }
  }, [beginAuthOp])

  const signUp = useCallback(
    (args) => runExplicitAuthOp(() => authSignUp(args)),
    [runExplicitAuthOp]
  )

  const logIn = useCallback(
    (args) => runExplicitAuthOp(() => authLogIn(args)),
    [runExplicitAuthOp]
  )

  const logOut = useCallback(
    () => runExplicitAuthOp(async () => {
      await authLogOut()
      return null
    }),
    [runExplicitAuthOp]
  )

  const value = useMemo(
    () => ({ user, profile, loading, signUp, logIn, logOut }),
    [user, profile, loading, signUp, logIn, logOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth() must be used inside an <AuthProvider>')
  }
  return ctx
}

export default AuthContext

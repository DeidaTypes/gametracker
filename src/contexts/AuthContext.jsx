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
  // supabase.js) — nothing serializes them relative to each other. Without
  // a guard, whichever call's promise chain happens to *resolve* last wins,
  // even if it was the *oldest* one started (e.g. a stale getSession() from
  // a previous cached session resolving after a brand-new signUp already
  // applied its own state). That produces exactly the "random unrelated
  // cached account" symptom.
  //
  // Fix: every operation that's about to write user/profile state stamps a
  // monotonically increasing token when it *starts* (or, for auth events,
  // when the raw event is *received* — see onEventStart below), and only
  // applies its result if that token is still the most recent one issued by
  // the time it resolves. A newer operation starting always "wins" the
  // right to apply state, regardless of resolution order.
  const authSeqRef = useRef(0)
  const beginAuthOp = useCallback(() => {
    authSeqRef.current += 1
    return authSeqRef.current
  }, [])
  const isCurrentAuthOp = useCallback((token) => authSeqRef.current === token, [])

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
        if (cancelled || !isCurrentAuthOp(token)) return
        if (result) {
          setUser(result.user)
          setProfile(result.profile)
        } else {
          setUser(null)
          setProfile(null)
        }
      } catch {
        if (!cancelled && isCurrentAuthOp(token)) {
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
  }, [beginAuthOp, isCurrentAuthOp])

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
  useEffect(() => {
    const unsubscribe = onAuthStateChange(
      ({ user: nextUser, profile: nextProfile }, token) => {
        if (!mountedRef.current) return
        if (!isCurrentAuthOp(token)) return
        setUser(nextUser)
        setProfile(nextProfile)
      },
      beginAuthOp
    )
    return unsubscribe
  }, [beginAuthOp, isCurrentAuthOp])

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

  const signUp = useCallback(async (args) => {
    const token = beginAuthOp()
    // Use the session/user/profile returned directly by our own signUp()
    // call as the source of truth — do NOT wait for the ambient
    // onAuthStateChange listener to "catch up". The listener will still
    // fire for this signUp (harmless, same data), but a slower, unrelated
    // event (e.g. a stale getSession()/refreshSession() from a previous
    // cached account) must never be allowed to overwrite this result —
    // the token check below (and on the listener/restore effects) enforces
    // that regardless of resolution order.
    const result = await authSignUp(args)
    if (isCurrentAuthOp(token)) {
      setUser(result.user)
      setProfile(result.profile)
    }
    return result
  }, [beginAuthOp, isCurrentAuthOp])

  const logIn = useCallback(async (args) => {
    const token = beginAuthOp()
    // Same principle as signUp: trust the session this call itself
    // resolved with, not whatever the auth listener happens to deliver.
    const result = await authLogIn(args)
    if (isCurrentAuthOp(token)) {
      setUser(result.user)
      setProfile(result.profile)
    }
    return result
  }, [beginAuthOp, isCurrentAuthOp])

  const logOut = useCallback(async () => {
    const token = beginAuthOp()
    await authLogOut()
    if (isCurrentAuthOp(token)) {
      setUser(null)
      setProfile(null)
    }
  }, [beginAuthOp, isCurrentAuthOp])

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

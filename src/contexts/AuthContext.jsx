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

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Initial session restore. Runs once on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await getCurrentUser()
        if (cancelled) return
        if (result) {
          setUser(result.user)
          setProfile(result.profile)
        } else {
          setUser(null)
          setProfile(null)
        }
      } catch {
        if (!cancelled) {
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
  }, [])

  // Keep the localStorage profile mirror (read synchronously by the
  // own-profile UI) in step with the authoritative Supabase row. This is
  // what makes the name + username captured at signup show up everywhere
  // and survive a reinstall / different device — without it the local
  // store would fall back to its empty default.
  useEffect(() => {
    if (profile) syncProfileFromSupabase(profile)
  }, [profile])

  // Subscribe to auth state changes (sign in / out / token refresh).
  useEffect(() => {
    const unsubscribe = onAuthStateChange(({ user: nextUser, profile: nextProfile }) => {
      if (!mountedRef.current) return
      setUser(nextUser)
      setProfile(nextProfile)
    })
    return unsubscribe
  }, [])

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
    const result = await authSignUp(args)
    // Optimistically populate context so the route guard doesn't bounce
    // the user back to /login between signUp resolving and the
    // onAuthStateChange listener firing.
    setUser(result.user)
    setProfile(result.profile)
    return result
  }, [])

  const logIn = useCallback(async (args) => {
    const result = await authLogIn(args)
    setUser(result.user)
    setProfile(result.profile)
    return result
  }, [])

  const logOut = useCallback(async () => {
    await authLogOut()
    setUser(null)
    setProfile(null)
  }, [])

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

import React, { useEffect, useRef, useState } from 'react'
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from 'react-router-dom'
import { AnimatePresence } from 'motion/react'
import PageTransition from './components/PageTransition'
import TopNav from './components/TopNav'
import MobileNav from './components/MobileNav'
import BottomNav from './components/BottomNav'
import Home from './pages/Home'
import Explore from './pages/Explore'
import DiscoverReviewsAll from './pages/DiscoverReviewsAll'
import Search from './pages/Search'
import CategoryResults from './pages/CategoryResults'
import Library from './pages/Library'
import Wishlist from './pages/Wishlist'
import Reviews from './pages/Reviews'
import GameDetail from './pages/GameDetail'
import GameReviewsAll from './pages/GameReviewsAll'
import DeveloperDetail from './pages/DeveloperDetail'
import Profile from './pages/Profile'
import UserBadgesPage from './pages/UserBadgesPage'
import UserFollowers from './pages/UserFollowers'
import UserFollowing from './pages/UserFollowing'
import MessagesInbox from './pages/MessagesInbox'
import MessagesThread from './pages/MessagesThread'
import ReviewComments from './pages/ReviewComments'
import ReviewDetail from './pages/ReviewDetail'
import ReviewNew from './pages/ReviewNew'
import JournalNew from './pages/JournalNew'
import JournalEntry from './pages/JournalEntry'
import Settings from './pages/Settings'
import SettingsBlocked from './pages/SettingsBlocked'
import SettingsEmail from './pages/SettingsEmail'
import SettingsPassword from './pages/SettingsPassword'
import Stats from './pages/Stats'
import ActivityCalendar from './pages/ActivityCalendar'
import CurrentlyPlaying from './pages/CurrentlyPlaying'
import SmartListDetail from './pages/SmartListDetail'
import ListDetail from './pages/ListDetail'
import Onboarding from './pages/Onboarding'
import LogIn from './pages/auth/LogIn'
import SignUp from './pages/auth/SignUp'
// Dev-only visual harnesses. Lazily imported and only registered when
// import.meta.env.DEV is true so they're stripped from production bundles.
const ReviewCardDemo = import.meta.env.DEV
  ? React.lazy(() => import('./pages/_dev/ReviewCardDemo'))
  : null
import { getPreferences, initializePreferences } from './services/userPreferences'
import { initializeProfile } from './services/profileService'
import { initSettings, applySettingsToDom, getSettings } from './services/userSettingsService'
import { loadBlockedIds, clearBlockCache } from './services/blockService'
import ToastHost from './components/Toast'
import CompletionCelebration from './components/celebration/CompletionCelebration'
import MilestoneCelebration from './components/MilestoneCelebration'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { GameColorProvider } from './contexts/GameColorContext'
import { UnreadMessagesProvider } from './contexts/UnreadMessagesContext'
import { SearchOverlayProvider, useSearchOverlay } from './contexts/SearchOverlayContext'
import { SessionProvider } from './contexts/SessionContext'
import SearchOverlay from './components/SearchOverlay'
import SessionPill from './components/SessionPill'
import StopSessionSheet from './components/StopSessionSheet'
import { useBadgeUnlockWatcher } from './hooks/useBadgeUnlockWatcher'
import { useAppResume } from './hooks/useAppResume'
import ErrorBoundary from './components/ErrorBoundary'
import './styles/theme.css'
import './styles/grid.css'
import './styles/_motion.css'
import './pages/auth/Auth.css'
import './App.css'

// Apply persisted accessibility prefs (color-blind mode, reduce motion,
// larger text) to <body> as early as possible so the very first paint
// already reflects them. Cross-device sync from Supabase happens after
// auth resolves via initSettings() in AppContent.
if (typeof document !== 'undefined') {
  applySettingsToDom(getSettings())
}

const PUBLIC_PATHS = new Set(['/login', '/signup'])

/**
 * Animated route outlet. Wraps <Routes> in a single motion.div whose
 * key is the current route path, so AnimatePresence treats every
 * navigation as a child swap and runs exit on the outgoing page
 * before mounting the new one. The motion.div carries the per-page
 * fade + 8 px vertical slide from the motion-system spec.
 *
 * The keyed motion.div pattern is the recommended fix for the
 * "stuck mid-transition" failure mode of AnimatePresence mode="wait":
 * a unique key on each route is the only way React + Motion can tell
 * that the old subtree should be torn down and a new one mounted.
 */
/**
 * Animated route outlet.
 *
 * Each Route renders `<PageTransition>` which wraps the page in a
 * motion.div that fades + slides 8 px on mount. Re-mounts happen
 * naturally on every navigation because we key `<Routes>` itself on
 * `location.pathname` — each route change tears down the previous
 * subtree and mounts a fresh one.
 *
 * Why not AnimatePresence mode="wait" with full exit animations?
 * We tried. In this codebase (Motion 12.38 + React Router 6.30 +
 * layoutId-heavy SharedCover/BottomNav/Profile-tab subtrees), exit
 * animations on the previous page never receive their `onComplete`
 * callback, leaving AnimatePresence permanently "waiting" and the
 * next page never mounts. The deadlock reproduces with or without
 * LayoutGroup. Enter-only is the fail-safe pattern the team already
 * battle-tested before this prompt (see Motion #3059) and it still
 * delivers the spec's "smooth fade + slide-up" feel because every
 * page mount runs the same animation from initial → animate.
 *
 * Internal transitions (Profile tabs, Search tabs, modals, FAB
 * sheet) DO use AnimatePresence — those subtrees are smaller and
 * don't contain layoutId descendants, so they animate cleanly.
 */
function AnimatedRoutes({ location, children }) {
  return (
    <Routes key={location.pathname} location={location}>
      {children}
    </Routes>
  )
}

/**
 * Boot splash shown only while we're restoring the Supabase session on
 * initial page load. Mirrors the existing skeleton style (shared
 * `.skeleton` shimmer class from theme.css) so reduced-motion users get
 * the static fallback for free.
 */
function AuthBootSplash() {
  return (
    <div className="auth-boot" role="status" aria-label="Loading">
      <div className="auth-boot__inner" aria-hidden="true">
        <div className="skeleton auth-boot__avatar" />
        <div className="skeleton auth-boot__bar" />
        <div className="skeleton auth-boot__bar auth-boot__bar--short" />
      </div>
    </div>
  )
}

/**
 * Wraps any route that requires authentication. If the user is not
 * logged in, redirect to /login with a redirectTo param so we can
 * restore the originally-requested route after they sign in.
 */
function RequireAuth({ children }) {
  const { user } = useAuth()
  const location = useLocation()

  if (!user) {
    const original = location.pathname + location.search + location.hash
    const search =
      original && original !== '/'
        ? `?redirectTo=${encodeURIComponent(original)}`
        : ''
    return <Navigate to={`/login${search}`} replace />
  }

  return children
}

/**
 * Inverse of RequireAuth — if the user IS logged in, /login and
 * /signup should bounce to home (or to the originally-requested route
 * if a redirectTo was provided).
 */
function RedirectIfAuthed({ children }) {
  const { user } = useAuth()
  const location = useLocation()

  if (user) {
    const redirectTo =
      new URLSearchParams(location.search).get('redirectTo') || '/'
    return <Navigate to={redirectTo} replace />
  }

  return children
}

function AppContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile, loading: authLoading } = useAuth()
  const [checkingOnboarding, setCheckingOnboarding] = useState(true)
  const mainContentRef = useRef(null)
  const { isOpen: searchOpen } = useSearchOverlay()

  // Sprint 5 P9 — Mount the badge unlock watcher once at the app root so
  // earning a badge anywhere in the app surfaces a celebratory toast.
  // The hook is a no-op while `user` is null and self-handles first-mount
  // semantics so we don't toast for already-earned badges on page load.
  useBadgeUnlockWatcher()

  // Recover after the app is backgrounded and resumed: refresh the Supabase
  // session, reconnect dropped realtime sockets, and trigger every
  // resume-aware screen/hook to refetch — so games reload automatically
  // without a force-quit. (See useAppResume for the full rationale.)
  useAppResume()

  // Native deep-link navigation — appLifecycle.js dispatches 'app:deeplink'
  // after parsing an appUrlOpen / getLaunchUrl URL. We handle it here
  // inside the Router context so we have access to navigate().
  useEffect(() => {
    const handler = (e) => {
      const path = e.detail?.path
      if (path) navigate(path, { replace: true })
    }
    window.addEventListener('app:deeplink', handler)
    return () => window.removeEventListener('app:deeplink', handler)
  }, [navigate])

  const isPublicRoute = PUBLIC_PATHS.has(location.pathname)

  useEffect(() => {
    // Don't run onboarding logic on public auth routes — the user might
    // not have an account yet, and pushing them through onboarding before
    // signup gates is the wrong order.
    if (isPublicRoute) {
      setCheckingOnboarding(false)
      return
    }

    // Wait for the auth session to resolve before deciding what to do.
    // Without this guard the onboarding redirect can fire *during* the
    // session restore and clobber the redirectTo flow.
    if (authLoading) return

    // Only worry about onboarding for signed-in users. Signed-out users
    // get bounced to /login by RequireAuth before this matters.
    if (!user) {
      setCheckingOnboarding(false)
      return
    }

    initializeProfile()

    // Sprint 7 — kick off Supabase-backed sync for accessibility/privacy
    // prefs and hydrate the per-user blocked-users cache so every read
    // path that filters blocked users (reviews, comments, DMs, activity)
    // sees a non-null cache by the time it queries.
    initSettings()
    loadBlockedIds()

    // Primary gate: Supabase-backed onboarded_at (set by Sprint 7.6).
    // Fallback: localStorage flag so a user who completed onboarding
    // offline (or before the profile re-fetches) is never re-bounced.
    const supabaseOnboarded = profile?.onboarded_at != null
    const localOnboarded = getPreferences()?.onboarded === true
    const isOnboarded = supabaseOnboarded || localOnboarded

    if (!isOnboarded && location.pathname !== '/onboarding') {
      if (!getPreferences()) initializePreferences()
      navigate('/onboarding', { replace: true })
    }
    setCheckingOnboarding(false)

    return () => {
      // No teardown — the block cache survives across mounts of
      // AppContent (Strict Mode double-mount in dev) and is cleared
      // explicitly on sign-out below.
    }
  }, [navigate, location.pathname, isPublicRoute, authLoading, user, profile])

  // Sprint 7 — clear the block cache the moment the auth user
  // disappears so a subsequent login by a different account doesn't
  // see the previous user's blocked-users set.
  useEffect(() => {
    if (!user) clearBlockCache()
  }, [user])

  // Scroll-to-top on every route change. The .main-content div persists
  // across navigations (only its child <Routes> subtree re-mounts), so
  // its scrollTop carries over and screens appear scrolled-down on entry.
  // Reset it to 0 whenever the pathname changes so every screen starts at
  // the true top, with the first header fully visible.
  useEffect(() => {
    if (mainContentRef.current) {
      mainContentRef.current.scrollTop = 0
    }
  }, [location.pathname])

  // Block the entire app until the initial Supabase session restore
  // resolves. Without this, a refresh-while-logged-in briefly renders
  // the logged-out state (RequireAuth fires, we bounce to /login) before
  // the session pops back, which is jarring.
  if (authLoading) {
    return <AuthBootSplash />
  }

  // Don't show nav chrome on onboarding or auth screens.
  const showNav =
    location.pathname !== '/onboarding' && !isPublicRoute && !!user

  if (checkingOnboarding && !isPublicRoute) {
    return <div className="app" aria-hidden="true" />
  }

  return (
    <div className="app">
      {showNav && <TopNav />}
      {showNav && <MobileNav />}
      <main className="main-content" ref={mainContentRef}>
        <AnimatedRoutes location={location}>
            {/* Public auth routes */}
            <Route
              path="/login"
              element={
                <RedirectIfAuthed>
                  <PageTransition><LogIn /></PageTransition>
                </RedirectIfAuthed>
              }
            />
            <Route
              path="/signup"
              element={
                <RedirectIfAuthed>
                  <PageTransition><SignUp /></PageTransition>
                </RedirectIfAuthed>
              }
            />

            {/* Authenticated routes — every other route is gated. */}
            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition><Onboarding /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition><Home /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* /home is referenced in places that conceptually mean "home" — alias to /. */}
            <Route path="/home" element={<Navigate to="/" replace />} />
            {/* Sprint: bottom-nav redesign — Explore + Search merged into
                a single "Discover" tab. The Discover tab targets /discover;
                /explore still renders the same component so any deep links
                continue to resolve while we consolidate the codepath in a
                later sprint. */}
            <Route
              path="/discover"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition><Explore /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/explore"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition><Explore /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/discover/reviews"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><DiscoverReviewsAll /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* /search is now a redirect to /discover. The overlay provides
                search behaviour; deep links and bookmarks still resolve. */}
            <Route path="/search" element={<Navigate to="/discover" replace />} />
            <Route
              path="/browse/:categoryKey"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><CategoryResults /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/library"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition><Library /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* /library/played is a deep link from the Profile Played stat.
                The tracker lists live at /list/:listId where listId = 'played'. */}
            <Route path="/library/played" element={<Navigate to="/list/played" replace />} />
            <Route
              path="/wishlist"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><Wishlist /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/reviews"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><Reviews /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/review/new"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><ReviewNew /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/journal/new"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><JournalNew /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/journal/:entryId"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><JournalEntry /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/game/:gameId"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><GameDetail /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/game/:gameId/reviews"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><GameReviewsAll /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/developer/:developerName"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><DeveloperDetail /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/currently-playing"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><CurrentlyPlaying /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/smart-list/:listKey"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><SmartListDetail /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/list/:listId"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><ListDetail /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition><Profile /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* Other-user profiles — /user/:username resolves username→UUID
                then renders the shared Profile component which branch-switches
                on isOwnProfile to fetch data from Supabase vs localStorage. */}
            <Route
              path="/user/:username"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><Profile /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* Fallback route for users without a username set — navigated to
                by review cards and follow rows when author.username is null.
                Profile.jsx detects the UUID param and uses getUserById. */}
            <Route
              path="/user/id/:userId"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><Profile /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* Sprint 5 P9 — Full badge grid for any user. The page resolves
                :username → user_id internally so deep links from a chevron
                tap on the BadgesRow work for both own + future other-user
                profiles. */}
            <Route
              path="/user/:username/badges"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><UserBadgesPage /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* Sprint 6 — Followers / Following list pages. Each is a
                thin route wrapper around the shared FollowsListPage
                component which owns header + tabs + pagination. */}
            <Route
              path="/user/:username/followers"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><UserFollowers /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/user/:username/following"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><UserFollowing /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/stats"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><Stats /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/activity"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><ActivityCalendar /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* Sprint 7 — dedicated Settings surface. /edit-profile remains
                a thin alias that funnels users back to the existing edit-
                profile modal hosted on the Profile page (via location state). */}
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><Settings /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/settings/blocked"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><SettingsBlocked /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/settings/email"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><SettingsEmail /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/settings/password"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><SettingsPassword /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/edit-profile"
              element={<Navigate to="/profile" replace state={{ openEditModal: true }} />}
            />
            {/* Sprint 6 P1 — Threaded comments on a single review. */}
            <Route
              path="/reviews/:reviewId/comments"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><ReviewComments /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* Sprint 7 P1 — Canonical review detail + CenteredModal composer. */}
            <Route
              path="/review/:id"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><ReviewDetail /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* Share-URL alias: /reviews/:id → /review/:id */}
            <Route
              path="/reviews/:id"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><ReviewDetail /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* Sprint 6 P2 — Direct messages. /messages is the inbox,
                /messages/:username opens (or starts) a thread with that
                user. The Sprint 5 P8 stub at /messages/coming-soon now
                redirects to the real inbox so any deep links saved
                during the stub period still resolve to a useful place. */}
            <Route
              path="/messages"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><MessagesInbox /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/messages/coming-soon"
              element={<Navigate to="/messages" replace />}
            />
            <Route
              path="/messages/:username"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><MessagesThread /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />

            {/* Dev-only routes — registered only when running `vite dev`. */}
            {import.meta.env.DEV && ReviewCardDemo && (
              <Route
                path="/_dev/review-card"
                element={
                  <React.Suspense fallback={null}>
                    <ReviewCardDemo />
                  </React.Suspense>
                }
              />
            )}

            {/* Catch-all: send everything else through the auth guard so
                unknown logged-out URLs land on /login (with redirectTo)
                rather than a blank screen. */}
            <Route
              path="*"
              element={
                <RequireAuth>
                  <Navigate to="/" replace />
                </RequireAuth>
              }
            />
        </AnimatedRoutes>
      </main>
      {showNav && <BottomNav />}

      {/* Persistent session timer pill — floats above BottomNav when a
          session is running. Rendered outside .main-content so fixed
          positioning is not clipped by any transformed ancestor. */}
      {showNav && <SessionPill />}

      {/* Stop-session confirmation sheet — appears after stopGameSession(). */}
      <StopSessionSheet />

      {/* Search overlay — rendered outside .main-content to avoid fixed-
          positioning being clipped by any transformed ancestor. AnimatePresence
          drives the enter/exit animations declared inside SearchOverlay. */}
      <AnimatePresence>
        {showNav && searchOpen && <SearchOverlay key="search-overlay" />}
      </AnimatePresence>
    </div>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <AuthProvider>
          {/* UnreadMessagesProvider needs the auth user, so it sits inside
              AuthProvider but outside GameColorProvider/AppContent so the
              BottomNav (and any future chrome) can subscribe to the
              unread DM count from a single source. */}
          <UnreadMessagesProvider>
            {/* GameColorProvider wraps everything so BottomNav, GameDetail, and
                any future chrome consumers can all read/write the current game's
                extracted swatch palette. */}
            <GameColorProvider>
              <SearchOverlayProvider>
              {/* SessionProvider sits inside AuthProvider (needs user) and
                  outside AppContent so the pill/sheet render outside routes. */}
              <SessionProvider>
              <AppContent />
              <ToastHost />
              {/* Mounted once at the root so first-time-Played transitions from
                  anywhere in the app (Game Detail, AddToListButton, future
                  quick-status changes) all surface the same celebration. The
                  component subscribes to celebrationService's queue and only
                  renders when the head is non-null. */}
              <CompletionCelebration />
              {/* Mounted once at root — listens to 'streakUpdated' events and
                  shows the 7 / 30 / 100-day milestone celebration once per
                  milestone per user (localStorage-gated). Never guilt, only joy. */}
              <MilestoneCelebration />
              </SessionProvider>
              </SearchOverlayProvider>
            </GameColorProvider>
          </UnreadMessagesProvider>
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  )
}

export default App

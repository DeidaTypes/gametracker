import React, { useEffect, useRef, useState } from 'react'
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from 'react-router-dom'
import { LayoutGroup } from 'motion/react'
import PageTransition from './components/PageTransition'
import TopNav from './components/TopNav'
import MobileNav from './components/MobileNav'
import BottomNav from './components/BottomNav'
import Home from './pages/Home'
import Explore from './pages/Explore'
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
import Stats from './pages/Stats'
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
import ToastHost from './components/Toast'
import CompletionCelebration from './components/celebration/CompletionCelebration'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { GameColorProvider } from './contexts/GameColorContext'
import { UnreadMessagesProvider } from './contexts/UnreadMessagesContext'
import { useBadgeUnlockWatcher } from './hooks/useBadgeUnlockWatcher'
import './styles/theme.css'
import './styles/grid.css'
import './styles/_motion.css'
import './pages/auth/Auth.css'
import './App.css'

const PUBLIC_PATHS = new Set(['/login', '/signup'])

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
  const { user, loading: authLoading } = useAuth()
  const [checkingOnboarding, setCheckingOnboarding] = useState(true)
  // The single shared scroll container for every page. BottomNav subscribes
  // to its scroll position to drive the iOS-26 shrink-on-scroll behavior.
  const mainContentRef = useRef(null)

  // Sprint 5 P9 — Mount the badge unlock watcher once at the app root so
  // earning a badge anywhere in the app surfaces a celebratory toast.
  // The hook is a no-op while `user` is null and self-handles first-mount
  // semantics so we don't toast for already-earned badges on page load.
  useBadgeUnlockWatcher()

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

    const prefs = getPreferences()
    if (!prefs || !prefs.onboarded) {
      if (!prefs) initializePreferences()
      if (location.pathname !== '/onboarding') {
        navigate('/onboarding', { replace: true })
      }
    }
    setCheckingOnboarding(false)
  }, [navigate, location.pathname, isPublicRoute, authLoading, user])

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
      <div className="main-content" ref={mainContentRef}>
        {/* Page-level fade + 8 px slide on enter via <PageTransition>.
            No AnimatePresence is used here because all AnimatePresence modes
            deadlock with LayoutGroup when layoutId descendants are present
            (Motion bug #3059, confirmed in both dev and production for
            mode="popLayout" and mode="wait"). The enter-only animation —
            new page fades/slides in, old page unmounts cleanly — avoids the
            deadlock while still delivering the polished transition feel
            described in the motion spec. SharedCover FLIP transitions work
            correctly because LayoutGroup and its layoutId tracking are
            unaffected. */}
        <LayoutGroup>
          <Routes>
            {/* Public auth routes */}
            <Route
              path="/login"
              element={
                <RedirectIfAuthed>
                  <LogIn />
                </RedirectIfAuthed>
              }
            />
            <Route
              path="/signup"
              element={
                <RedirectIfAuthed>
                  <SignUp />
                </RedirectIfAuthed>
              }
            />

            {/* Authenticated routes — every other route is gated. */}
            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <PageTransition><Onboarding /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <PageTransition><Home /></PageTransition>
                </RequireAuth>
              }
            />
            {/* /home is referenced in places that conceptually mean "home" — alias to /. */}
            <Route path="/home" element={<Navigate to="/" replace />} />
            <Route
              path="/explore"
              element={
                <RequireAuth>
                  <PageTransition><Explore /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/search"
              element={
                <RequireAuth>
                  <PageTransition><Search /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/browse/:categoryKey"
              element={
                <RequireAuth>
                  <PageTransition><CategoryResults /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/library"
              element={
                <RequireAuth>
                  <PageTransition><Library /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/wishlist"
              element={
                <RequireAuth>
                  <PageTransition><Wishlist /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/reviews"
              element={
                <RequireAuth>
                  <PageTransition><Reviews /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/game/:gameId"
              element={
                <RequireAuth>
                  <PageTransition><GameDetail /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/game/:gameId/reviews"
              element={
                <RequireAuth>
                  <PageTransition><GameReviewsAll /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/developer/:developerName"
              element={
                <RequireAuth>
                  <PageTransition><DeveloperDetail /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/currently-playing"
              element={
                <RequireAuth>
                  <PageTransition><CurrentlyPlaying /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/smart-list/:listKey"
              element={
                <RequireAuth>
                  <PageTransition><SmartListDetail /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/list/:listId"
              element={
                <RequireAuth>
                  <PageTransition><ListDetail /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <PageTransition><Profile /></PageTransition>
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
                  <PageTransition><UserBadgesPage /></PageTransition>
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
                  <PageTransition><UserFollowers /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/user/:username/following"
              element={
                <RequireAuth>
                  <PageTransition><UserFollowing /></PageTransition>
                </RequireAuth>
              }
            />
            <Route
              path="/stats"
              element={
                <RequireAuth>
                  <PageTransition><Stats /></PageTransition>
                </RequireAuth>
              }
            />
            {/* Sprint 6 P1 — Threaded comments on a single review. */}
            <Route
              path="/reviews/:reviewId/comments"
              element={
                <RequireAuth>
                  <PageTransition><ReviewComments /></PageTransition>
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
                  <PageTransition><MessagesInbox /></PageTransition>
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
                  <PageTransition><MessagesThread /></PageTransition>
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
          </Routes>
        </LayoutGroup>
      </div>
      {showNav && <BottomNav scrollContainerRef={mainContentRef} />}
    </div>
  )
}

function App() {
  return (
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
            <AppContent />
            <ToastHost />
            {/* Mounted once at the root so first-time-Played transitions from
                anywhere in the app (Game Detail, AddToListButton, future
                quick-status changes) all surface the same celebration. The
                component subscribes to celebrationService's queue and only
                renders when the head is non-null. */}
            <CompletionCelebration />
          </GameColorProvider>
        </UnreadMessagesProvider>
      </AuthProvider>
    </Router>
  )
}

export default App

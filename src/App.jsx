import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
  useNavigationType,
} from 'react-router-dom'
import { LayoutGroup } from 'motion/react'
import PageTransition, { PageTransitionPhase } from './components/PageTransition'
import {
  BACK_EXIT_ANIM_MS,
  captureSnapshot,
  claimBack,
  clearSnapshots,
  holdLiveLayer,
  notifyBackExited,
  notifyBackSettled,
  registerBackHost,
  teardownBack,
} from './components/backTransition'
import { beginContentHold, endContentHold, MOTION_MS } from './motion/xMotion'
import { useMotionPreference } from './hooks/useMotionPreference'
import { useNavHideOnScroll } from './hooks/useNavHideOnScroll'
import TopNav from './components/TopNav'
import MobileNav from './components/MobileNav'
import BottomNav from './components/BottomNav'
import Home from './pages/Home'
import Explore from './pages/Explore'
import Library from './pages/Library'
import QaHome from './pages/qa/QaHome'
import Profile from './pages/Profile'
import Onboarding from './pages/Onboarding'
import LogIn from './pages/auth/LogIn'
import SignUp from './pages/auth/SignUp'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import {
  ActivityCalendar,
  CategoryResults,
  ChallengeDetail,
  CurrentlyPlaying,
  DeveloperDetail,
  DiscoverCollectionsAll,
  DiscoverNewAll,
  DiscoverReviewsAll,
  GameDetail,
  GameReviewsAll,
  GameSessions,
  JournalEntry,
  JournalNew,
  ListDetail,
  MessagesInbox,
  MessagesThread,
  NotificationsInbox,
  ReviewComments,
  ReviewDetail,
  ReviewNew,
  Reviews,
  Search,
  Settings,
  SettingsAccessibility,
  SettingsAccount,
  SettingsAppearance,
  SettingsBlocked,
  SettingsEmail,
  SettingsHelp,
  SettingsPassword,
  SettingsPrivacy,
  SmartListDetail,
  Stats,
  ThemedDropDetail,
  UserActivity,
  UserBadgesPage,
  UserFollowers,
  UserFollowing,
  UserLibrary,
  Wishlist,
  QaGame,
  QaMine,
  QaQuestion,
  QaSearch,
} from './routes/lazyPages'
import RouteChunkPlaceholder from './components/RouteChunkPlaceholder'
// Dev-only visual harnesses. Lazily imported and only registered when
// import.meta.env.DEV is true so they're stripped from production bundles.
const ReviewCardDemo = import.meta.env.DEV
  ? React.lazy(() => import('./pages/_dev/ReviewCardDemo'))
  : null
const StreakUIDemo = import.meta.env.DEV
  ? React.lazy(() => import('./pages/_dev/StreakUIDemo'))
  : null
import { getPreferences, initializePreferences } from './services/userPreferences'
import { initializeProfile } from './services/profileService'
import { initSettings, applySettingsToDom, getSettings } from './services/userSettingsService'
import { loadBlockedIds, clearBlockCache } from './services/blockService'
import ToastHost from './components/Toast'
import AuthBootSplash from './components/AuthBootSplash'
import CompletionCelebration from './components/celebration/CompletionCelebration'
import RateItHost from './components/RateItHost'
import MilestoneCelebration from './components/MilestoneCelebration'
import BadgeReveal from './components/BadgeReveal'
import BadgeBackfillSummary from './components/BadgeBackfillSummary'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { GameColorProvider } from './contexts/GameColorContext'
import { UnreadMessagesProvider } from './contexts/UnreadMessagesContext'
import { NotificationsProvider } from './contexts/NotificationsContext'
import { NudgesProvider } from './contexts/NudgesContext'
import { SessionProvider } from './contexts/SessionContext'
import SessionPill from './components/SessionPill'
import StopSessionSheet from './components/StopSessionSheet'
import QaComposerHost from './pages/qa/QaComposerHost'
import { useBadgeUnlockWatcher } from './hooks/useBadgeUnlockWatcher'
import { useAppResume, APP_RESUMED_EVENT } from './hooks/useAppResume'
import ErrorBoundary from './components/ErrorBoundary'
import './styles/tokens.css'
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

// /reset-password is public in the sense that matters here — it must not be
// gated on being logged out, and it must not trigger the onboarding redirect.
// Consuming a recovery link SIGNS THE USER IN, so this screen is the one auth
// route that is routinely reached with a live session.
const PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
])

/** Fallback while a pushed route's chunk resolves. Screen-sized, never a spinner. */
function LazyScreen({ children }) {
  return (
    <React.Suspense fallback={<RouteChunkPlaceholder />}>
      {children}
    </React.Suspense>
  )
}

/**
 * Animated route outlet — direction-aware push/pop exit + enter.
 *
 * HISTORY — why this isn't AnimatePresence:
 * An earlier attempt wrapped a keyed <Routes> in <AnimatePresence
 * mode="wait">, which is the textbook React Router + Motion pattern. It
 * deadlocked: exit animations on the outgoing page never received their
 * `onComplete` callback, so `mode="wait"` sat permanently "waiting" and
 * the next page never mounted. It reproduced with or without LayoutGroup.
 * Our best-supported diagnosis: this app's shared Motion layout tree has
 * several long-lived `layoutId` consumers — SharedCover (scoped per
 * gameId, used on ~10 different pages), BottomNav's `nav-pill`, and
 * Profile's tab indicator — and AnimatePresence's exit-complete signal for
 * a subtree is derived from Motion's internal layout-projection bookkeeping
 * for *everything* in that shared tree, not just the exiting page in
 * isolation. If any projection node elsewhere (e.g. a `layoutId` partner
 * that mounts, unmounts, or re-parents while the route exit is in flight)
 * never resolves its FLIP measurement, the exit-tree's completion promise
 * never resolves either, and `mode="wait"` has no timeout or escape hatch —
 * it just hangs forever. Enter-only sidestepped this at the cost of the
 * exit itself being dead code (see PageTransition's old comment, and the
 * `exit` prop that never ran because nothing kept AnimatePresence in the
 * tree).
 *
 * THIS APPROACH:
 * Rather than re-introduce AnimatePresence, this keeps the outgoing page
 * mounted itself (no AnimatePresence involved) and drives its exit as a
 * plain `animate` prop change on an already-mounted motion.div (see
 * PageTransition). That's a bare opacity/y tween whose `onAnimationComplete`
 * is basic Motion functionality, not tied to layout-projection or exit-tree
 * completion — it cannot be blocked by an unrelated `layoutId` partner
 * failing to resolve elsewhere. Two more things close the gaps that made
 * the old attempt fragile:
 *   - Each rendered layer (the exiting page and the entering page can be
 *     mounted simultaneously for one transition's duration) gets its own
 *     <LayoutGroup id={layer.key}>. SharedCover's layoutId is scoped to
 *     gameId, so without this, a source page and GameDetail showing the
 *     same game could suddenly attempt a cross-layer shared-element
 *     "flight" during the overlap that never happened before (source and
 *     destination were never mounted at the same time under the old
 *     enter-only model). Per-layer LayoutGroup isolation keeps that
 *     never-worked, never-attempted state exactly as it was — see
 *     SharedCover.jsx and the module docstring above for why the flight
 *     itself is out of scope here.
 *   - A safety-net timeout (same pattern as SwipeBackWrapper's own
 *     `safetyTimer`) force-unmounts an exiting layer if its
 *     `onAnimationComplete` never fires for some unrelated reason, so this
 *     can't wedge navigation the way AnimatePresence did even in a case we
 *     didn't anticipate.
 *
 * Reduced motion (`useMotionPreference`) skips all of this: layers swap
 * instantly with no overlap and no exit, per requirement.
 *
 * Internal transitions (Profile tabs, Search tabs, modals, FAB sheet)
 * still use AnimatePresence — those subtrees are smaller, self-contained,
 * and don't share layoutId state with the route-level layers, so they
 * remain unaffected by any of this and continue to animate cleanly.
 *
 * BACK NAVIGATION — the slide + previous-screen reveal:
 * A POP is no longer a fade. It hands the animation to backTransition.js,
 * which slides the outgoing layer off to the right while revealing the
 * previous screen underneath it in parallax — the same controller, easing and
 * progress function the left-edge swipe gesture drives, so a back BUTTON and a
 * back SWIPE produce one visual result instead of two similar ones. See that
 * module for the geometry, and for why the revealed screen is a DOM snapshot
 * captured at push time rather than a retained live route layer (short
 * version: `.main-content` is the app's single scroll container, and
 * GameColorContext-style single-instance contexts can't survive two mounted
 * copies of a page).
 *
 * The snapshot is captured here, on PUSH, because this is the one place that
 * still has the outgoing layer's DOM and its pre-reset scrollTop. If no
 * snapshot matches the destination — a cold start or deep link straight into a
 * pushed screen, or a history shape we didn't predict — claimBack returns
 * 'fade' and the previous back-fade behaviour is used unchanged, so this never
 * reveals the wrong screen.
 *
 * Reduced motion still skips all of it: layers swap instantly, no reveal is
 * ever mounted, and no snapshots are taken.
 */
const EXIT_SAFETY_BUFFER_MS = 100
const EXIT_SAFETY_MS = MOTION_MS + EXIT_SAFETY_BUFFER_MS
// Must exceed BACK_EXIT_ANIM_MS (defer + settle) so the layer isn't torn down mid-slide.
const BACK_EXIT_SAFETY_MS = BACK_EXIT_ANIM_MS + EXIT_SAFETY_BUFFER_MS

const TAB_ROOTS = new Set(['/', '/discover', '/explore', '/library', '/profile', '/qa'])

function isTabRoot(pathname) {
  return TAB_ROOTS.has(pathname)
}

function motionClass(layer, motion) {
  if (!layer.role || motion.phase === 'idle' || layer.motionGen !== motion.gen) return ''
  const run = motion.phase === 'run'
  if (layer.role === 'push-enter') {
    return `route-layer--front route-layer--from-right${run ? ' route-layer--to-rest' : ''}`
  }
  if (layer.role === 'push-under') {
    return `route-layer--under${run ? ' route-layer--to-parallax' : ''}`
  }
  if (layer.role === 'pop-exit') {
    return `route-layer--front${run ? ' route-layer--to-off' : ''}`
  }
  if (layer.role === 'pop-under') {
    return `route-layer--under route-layer--from-parallax${run ? ' route-layer--to-rest' : ''}`
  }
  return ''
}

function AnimatedRoutes({ location, navigationType, children, onEnterComplete, scrollRef }) {
  const { reduced } = useMotionPreference()

  const [layers, setLayers] = useState(() => [
    { key: location.key, location, phase: 'current' },
  ])
  const [motion, setMotion] = useState({ gen: 0, phase: 'idle', kind: null })
  const lastKeyRef = useRef(location.key)
  const lastPathRef = useRef(location.pathname)
  const exitTimersRef = useRef(new Map())
  const layerElsRef = useRef(new Map())
  const heldLayerKeyRef = useRef(null)
  const motionGen = useRef(0)
  const rafRef = useRef(0)
  const runTimerRef = useRef(0)

  const clearExitTimer = (key) => {
    const t = exitTimersRef.current.get(key)
    if (t) {
      clearTimeout(t)
      exitTimersRef.current.delete(key)
    }
  }

  const removeLayer = (key) => {
    clearExitTimer(key)
    setLayers((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev))
  }

  const idleMotion = () => {
    cancelAnimationFrame(rafRef.current)
    clearTimeout(runTimerRef.current)
    const gen = ++motionGen.current
    setMotion({ gen, phase: 'idle', kind: null })
    return gen
  }

  // Park the incoming layer offscreen for one frame, then start the slide.
  // The first paint is cached content or a sized placeholder — never a wait
  // on the network. The first animation frame is the parked paint; the
  // second one starts the transition. The timeout is only there for a
  // webview that never schedules that second frame.
  const parkMotion = (kind) => {
    const gen = ++motionGen.current
    cancelAnimationFrame(rafRef.current)
    clearTimeout(runTimerRef.current)
    setMotion({ gen, phase: 'park', kind })
    beginContentHold()
    const start = () => {
      setMotion((m) => (m.gen === gen && m.phase === 'park' ? { gen, phase: 'run', kind } : m))
    }
    rafRef.current = requestAnimationFrame(() => {
      requestAnimationFrame(start)
    })
    runTimerRef.current = setTimeout(start, 100)
    return gen
  }

  useLayoutEffect(() => {
    if (location.key === lastKeyRef.current) return
    const prevKey = lastKeyRef.current
    const fromPath = lastPathRef.current
    lastKeyRef.current = location.key
    lastPathRef.current = location.pathname

    const scrollEl = scrollRef?.current || null
    const prevScrollTop = scrollEl?.scrollTop || 0
    const outgoingEl = layerElsRef.current.get(prevKey) || null
    const toPath = location.pathname
    const tabToTab = isTabRoot(fromPath) && isTabRoot(toPath)
    const tabTap = isTabRoot(toPath) && navigationType !== 'POP'
    const instant = reduced || tabToTab || tabTap || navigationType === 'REPLACE'

    const clearTimers = () => {
      exitTimersRef.current.forEach((t) => clearTimeout(t))
      exitTimersRef.current.clear()
    }

    if (instant) {
      teardownBack()
      clearTimers()
      idleMotion()
      endContentHold()
      setLayers([{ key: location.key, location, phase: 'current', deferWork: false }])
      return
    }

    const direction = navigationType === 'POP' ? 'back' : 'forward'
    const claim = direction === 'back' ? claimBack(location.key, outgoingEl) : null
    if (direction === 'forward') teardownBack()

    // Snapshot the page we're leaving while it is still mounted and still
    // at its scroll offset. A later back reveals this instead of a blank
    // remount. Tab switches never get here.
    if (navigationType === 'PUSH' && outgoingEl && scrollEl) {
      captureSnapshot({
        key: prevKey,
        layerEl: outgoingEl,
        scrollTop: prevScrollTop,
        padTop: getComputedStyle(scrollEl).paddingTop,
      })
    }

    if (claim === 'gesture') {
      clearTimers()
      idleMotion()
      beginContentHold()
      heldLayerKeyRef.current = location.key
      setLayers([{
        key: location.key,
        location,
        phase: 'current',
        direction,
        enterMode: 'instant',
        deferWork: true,
      }])
      return
    }

    const pushing = direction === 'forward'
    const livePop = claim === 'live'
    const sliding = claim === 'slide'
    const gen = pushing || livePop
      ? parkMotion(pushing ? 'push' : 'pop')
      : idleMotion()
    if (sliding) {
      heldLayerKeyRef.current = location.key
      beginContentHold()
    }

    setLayers((prev) => {
      const outgoingSource = prev.find((l) => l.phase === 'current') || prev[prev.length - 1]
      prev.forEach((l) => {
        if (l.phase === 'exiting' && l.key !== outgoingSource?.key) clearExitTimer(l.key)
      })

      const incoming = {
        key: location.key,
        location,
        phase: 'current',
        direction,
        enterMode: sliding ? 'instant' : 'animate',
        deferWork: true,
        role: pushing ? 'push-enter' : livePop ? 'pop-under' : null,
        motionGen: gen,
      }

      if (!outgoingSource) return [incoming]

      const outgoingKey = outgoingSource.key
      const timer = setTimeout(
        () => removeLayer(outgoingKey),
        sliding ? BACK_EXIT_SAFETY_MS : EXIT_SAFETY_MS
      )
      exitTimersRef.current.set(outgoingKey, timer)

      const outgoing = {
        ...outgoingSource,
        phase: 'exiting',
        direction,
        exitMode: sliding ? 'slide' : 'none',
        exitScrollTop: prevScrollTop,
        role: pushing ? 'push-under' : livePop ? 'pop-exit' : null,
        motionGen: gen,
      }
      return [outgoing, incoming]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, navigationType, reduced])

  // Unmount cleanups (useHideNav's body.nav-hidden pop) run before this
  // layout effect in the same commit, so the nav layout is final here.
  useLayoutEffect(() => {
    if (!layers.some((l) => l.phase === 'exiting')) notifyBackExited()
  }, [layers])

  useEffect(() => {
    if (motion.phase !== 'run') return undefined
    const gen = motion.gen
    const timer = setTimeout(() => {
      setMotion((m) => (m.gen === gen ? { gen, phase: 'idle', kind: null } : m))
      endContentHold()
    // After the travel, and after the exiting layer's own timer has
    // unmounted it. Dropping the motion classes earlier lets that fixed
    // layer paint over the page that just arrived.
    }, MOTION_MS + 160)
    return () => clearTimeout(timer)
  }, [motion.phase, motion.gen])

  useEffect(() => {
    const timers = exitTimersRef.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      cancelAnimationFrame(rafRef.current)
      clearTimeout(runTimerRef.current)
      teardownBack()
      endContentHold()
    }
  }, [])

  const showDim = motion.phase !== 'idle' && (motion.kind === 'push' || motion.kind === 'pop')
  let dimClass = 'route-dim'
  if (motion.kind === 'pop') {
    dimClass = motion.phase === 'run'
      ? 'route-dim route-dim--dimmed route-dim--fade-out'
      : 'route-dim route-dim--dimmed'
  } else if (motion.phase === 'run') {
    dimClass = 'route-dim route-dim--fade-in'
  }

  return (
    <div className={motion.phase === 'run' ? 'route-stack route-stack--run' : 'route-stack'}>
      {showDim && <div className={dimClass} aria-hidden="true" />}
      {layers.map((layer) => {
        const isExiting = layer.phase === 'exiting'
        const isSlidingOut = isExiting && layer.exitMode === 'slide'
        const extra = motionClass(layer, motion)
        return (
          <div
            key={layer.key}
            ref={(el) => {
              if (el) {
                layerElsRef.current.set(layer.key, el)
                if (heldLayerKeyRef.current === layer.key) {
                  holdLiveLayer(el)
                  heldLayerKeyRef.current = null
                }
              } else {
                layerElsRef.current.delete(layer.key)
              }
            }}
            className={[
              'route-layer',
              isExiting ? 'route-layer--exiting' : '',
              isSlidingOut ? 'back-slide-top' : '',
              extra,
            ].filter(Boolean).join(' ')}
            style={
              isExiting
                ? {
                    top: `${-(layer.exitScrollTop || 0)}px`,
                    height: `calc(100% + ${layer.exitScrollTop || 0}px)`,
                  }
                : undefined
            }
          >
            <LayoutGroup id={layer.key}>
              <PageTransitionPhase.Provider
                value={{
                  phase: layer.phase,
                  deferWork: !!layer.deferWork && !reduced,
                  onEnterComplete: isExiting ? undefined : () => onEnterComplete?.(layer.key),
                }}
              >
                <Routes location={layer.location}>{children}</Routes>
              </PageTransitionPhase.Provider>
            </LayoutGroup>
          </div>
        )
      })}
    </div>
  )
}

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
  // Element in state (not just the ref) so useNavHideOnScroll's effect
  // re-runs once `<main>` hydrates after the auth/onboarding early returns.
  // A ref-only bind is null on first mount and never retriggers.
  const [mainContentEl, setMainContentElState] = useState(null)

  // MUST be stable. React detaches and re-attaches a callback ref whenever its
  // identity changes, and it does so bottom-up alongside layout effects — so
  // an inline arrow here leaves `mainContentRef.current` null for the whole of
  // AnimatedRoutes' layout effect (a child, which therefore runs before this
  // parent's ref is re-attached). That effect reads scrollTop to snapshot the
  // outgoing page, so an unstable ref silently disables the back transition.
  const setMainContentEl = useCallback((el) => {
    mainContentRef.current = el
    registerBackHost(el)
    setMainContentElState((prev) => (prev === el ? prev : el))
  }, [])

  const navScrollHidden = useNavHideOnScroll(mainContentEl)

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

  // Settings hydrate on app start and sign-in. This used to run inside
  // the onboarding effect below, which depends on location.pathname, so
  // every navigation refetched and could overwrite a privacy value the
  // server had already accepted. Foreground resume hydrates again.
  const settingsUserId = user?.id ?? null
  useEffect(() => {
    if (authLoading) return
    initSettings()
  }, [authLoading, settingsUserId])

  useEffect(() => {
    const onResume = () => initSettings()
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => window.removeEventListener(APP_RESUMED_EVENT, onResume)
  }, [])

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

    // Hydrate the per-user blocked-users cache so every read path that
    // filters blocked users (reviews, comments, DMs, activity) sees a
    // non-null cache by the time it queries.
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
    if (!user) {
      clearBlockCache()
      // Retained page snapshots are per-session content. A different account
      // signing in must never be able to see the previous one's screens
      // revealed behind a back gesture.
      clearSnapshots()
    }
  }, [user])

  // Scroll handling on route change. The .main-content div persists across
  // navigations (only its child <Routes> subtree re-mounts), so its
  // scrollTop carries over and screens would otherwise appear scrolled-down
  // on entry.
  //
  // Going somewhere new starts at the true top, with the first header fully
  // visible. Going *back*, though, should return the user to the spot they
  // left — scrolling halfway down a library, opening a game and pressing
  // back only to land at the top again is the single most disorienting part
  // of navigating this app. We record the offset for each history entry as
  // it is left and put it back on a POP.
  //
  // CHOSEN APPROACH (fixes the mid-fade "jump"): the old code re-wrote
  // el.scrollTop on every rAF for up to 800ms on a POP, because a short
  // destination (still on its skeleton) clamps the write back toward 0.
  // Once the destination grew tall enough — often mid-fade, since the
  // 220ms tween and the data fetch race each other — the very next write
  // finally "stuck" at the larger value and the viewport visibly snapped
  // to it. Two changes fix this instead of just tuning the timing:
  //
  //   1. We never begin the restore attempt until the ENTERING page's
  //      transition has actually finished (PageTransition's
  //      onEnterComplete, wired through AnimatedRoutes below — see its
  //      docstring). A `setTimeout(EXIT_SAFETY_MS)` mirrors the same
  //      safety-net pattern AnimatedRoutes already uses for exit
  //      completion, in case onAnimationComplete never fires for some
  //      unrelated reason. So nothing is ever attempted while the fade
  //      is actually playing.
  //   2. Once we do attempt it, we only ever WRITE scrollTop once. We
  //      poll scrollHeight (a read — never visible) each frame to ask
  //      "can this page hold the full saved offset yet?" and only when
  //      the answer is yes do we perform the single, non-clamped write.
  //      If RESTORE_WINDOW_MS passes without the page growing enough, we
  //      give up and leave it at top — never a late, partial write.
  //
  // PUSH (and REPLACE) always reset to top, and now via useLayoutEffect
  // (before paint) rather than useEffect (after first paint), so a new
  // page can never render for even one frame at the previous page's
  // leftover scrollTop.
  const scrollOffsetsRef = useRef(new Map())
  const navigationType = useNavigationType()
  // { key, cancel } for whichever POP restore attempt is currently
  // in-flight (there is ever only one), plus the set of location keys
  // that have already had a restore attempt started — this is how we
  // make sure the onEnterComplete callback and the EXIT_SAFETY_MS
  // fallback timer never both kick off a second, redundant attempt.
  const restoreRef = useRef({ key: null, cancel: null })
  const attemptedKeysRef = useRef(new Set())

  // Record the outgoing offset, then reset to a clean baseline BEFORE paint.
  //
  // The reset has to be a layout effect so a PUSH never paints one frame at
  // the previous page's leftover scrollTop. The record has to be that same
  // effect's cleanup: a useEffect cleanup runs after this reset (passive
  // effects flush after the layout phase) and was storing 0 for every
  // departure, so back navigation always landed at the top. A layout cleanup
  // runs before the next layout setup — the outgoing offset is still on
  // `.main-content` — and after AnimatedRoutes (a child) has already read it
  // for the back-transition snapshot.
  //
  // POP then sits at top, hidden under that snapshot, until attemptRestore
  // writes the saved offset once and the reveal lifts.
  useLayoutEffect(() => {
    const el = mainContentRef.current
    if (!el) return undefined
    const key = location.key
    // A pop restores the saved offset before paint, while the outgoing
    // page still covers the screen, so the underneath layer is already
    // where the user left it when the slide starts.
    if (navigationType === 'POP') {
      el.scrollTop = scrollOffsetsRef.current.get(key) || 0
    } else {
      el.scrollTop = 0
    }
    return () => {
      const node = mainContentRef.current
      if (node) scrollOffsetsRef.current.set(key, node.scrollTop)
      // The page we're leaving is going away — any restore attempt still
      // polling for it is now moot.
      if (restoreRef.current.key === key) {
        restoreRef.current.cancel?.()
        restoreRef.current = { key: null, cancel: null }
      }
    }
  }, [location.key])

  const attemptRestore = useCallback(
    (key) => {
      if (attemptedKeysRef.current.has(key)) return // already handled once
      if (navigationType !== 'POP' || location.key !== key) return
      const el = mainContentRef.current
      if (!el) {
        notifyBackSettled()
        return
      }
      const saved = scrollOffsetsRef.current.get(key)
      if (!saved) {
        // Nothing to restore, or already at top — correct as-is, so the back
        // reveal has nothing left to wait for.
        notifyBackSettled()
        return
      }

      attemptedKeysRef.current.add(key)

      const RESTORE_WINDOW_MS = 800
      const deadline = performance.now() + RESTORE_WINDOW_MS
      let frame = 0
      let cancelled = false

      const stop = () => {
        cancelled = true
        cancelAnimationFrame(frame)
        el.removeEventListener('wheel', stop)
        el.removeEventListener('touchstart', stop)
        if (restoreRef.current.key === key) restoreRef.current = { key: null, cancel: null }
        // A back transition holds its reveal over this page until the restore
        // has resolved, so the single scrollTop write below happens behind an
        // opaque cover. Without this it would be visible as the same lurch the
        // restore rewrite was fixing.
        notifyBackSettled()
      }

      const poll = () => {
        if (cancelled) return
        // Read-only — never itself visible. Only once this is true do we
        // know the eventual write below will stick in full, not clamp.
        const canHoldFullOffset = el.scrollHeight - el.clientHeight >= saved
        if (canHoldFullOffset) {
          el.scrollTop = saved // the one and only write
          stop()
          return
        }
        if (performance.now() > deadline) {
          stop() // gave up — stays at top, which reads as correct, not broken
          return
        }
        frame = requestAnimationFrame(poll)
      }

      // A manual scroll mid-poll means the user has already taken over;
      // don't yank them to a different position afterward.
      el.addEventListener('wheel', stop, { passive: true, once: true })
      el.addEventListener('touchstart', stop, { passive: true, once: true })
      restoreRef.current = { key, cancel: stop }
      poll()
    },
    [navigationType, location.key]
  )

  // Safety net mirroring AnimatedRoutes' own EXIT_SAFETY_MS: if the
  // entering PageTransition's onAnimationComplete never fires for some
  // unrelated reason, a POP still settles instead of staying parked at
  // top forever. attemptedKeysRef makes this a no-op if the real
  // callback already ran first.
  useEffect(() => {
    if (navigationType !== 'POP') return undefined
    const key = location.key
    const timer = setTimeout(() => attemptRestore(key), EXIT_SAFETY_MS)
    return () => clearTimeout(timer)
  }, [location.key, navigationType, attemptRestore])

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
      {/* This element is also where backTransition.js appends the
          back-navigation reveal (registerBackHost). It has to be in here: the
          exiting route layer is `position: fixed; z-index: 2` among these
          children and `.main-content` is itself a stacking context, so
          nothing mounted outside it can paint between the destination layer
          and the exiting one. The reveal is appended and removed as a plain
          trailing DOM child, which React leaves alone because it never
          rendered it. */}
      <main className="main-content" ref={setMainContentEl}>
        <AnimatedRoutes
          location={location}
          navigationType={navigationType}
          onEnterComplete={attemptRestore}
          scrollRef={mainContentRef}
        >
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
            <Route
              path="/forgot-password"
              element={
                <RedirectIfAuthed>
                  <PageTransition><ForgotPassword /></PageTransition>
                </RedirectIfAuthed>
              }
            />
            {/* Deliberately NOT wrapped in RedirectIfAuthed: the recovery link
                establishes a session before this screen renders, so guarding it
                on being logged out would bounce the user off the one screen
                that can complete the reset. */}
            <Route
              path="/reset-password"
              element={
                <PageTransition><ResetPassword /></PageTransition>
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
                    <PageTransition swipeBack><LazyScreen><DiscoverReviewsAll /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/discover/collections"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><DiscoverCollectionsAll /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/discover/drop"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><ThemedDropDetail /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/discover/new"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><DiscoverNewAll /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* /search renders the full Search page (4 tabs: Games, Reviews,
                Users, Lists). The overlay on /discover remains untouched;
                this route activates the already-complete Search.jsx. */}
            <Route
              path="/search"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition><LazyScreen><Search /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/browse/:categoryKey"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><CategoryResults /></LazyScreen></PageTransition>
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
            {/* Q&A tab root is static so a tab tap never waits on a chunk.
                The four screens under it are pushes: they slide in on the
                stack you were already on (Library → game → questions, back
                returns to the game). */}
            <Route
              path="/qa"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition><QaHome /></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/qa/game/:igdbId"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><QaGame /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/qa/q/:questionId"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><QaQuestion /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/qa/mine"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><QaMine /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/qa/search"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><QaSearch /></LazyScreen></PageTransition>
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
                    <PageTransition swipeBack><LazyScreen><Wishlist /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/reviews"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><Reviews /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/review/new"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><ReviewNew /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/journal/new"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><JournalNew /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/journal/:entryId"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><JournalEntry /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/game/:gameId"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><GameDetail /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/game/:gameId/reviews"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><GameReviewsAll /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/game/:gameId/sessions"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><GameSessions /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/developer/:developerName"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><DeveloperDetail /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/currently-playing"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><CurrentlyPlaying /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/smart-list/:listKey"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><SmartListDetail /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/list/:listId"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><ListDetail /></LazyScreen></PageTransition>
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
                    <PageTransition swipeBack><LazyScreen><UserBadgesPage /></LazyScreen></PageTransition>
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
                    <PageTransition swipeBack><LazyScreen><UserFollowers /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/user/:username/following"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><UserFollowing /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* Fallback for users without a username set (see /user/id/:userId
                above) — most real accounts have no username, so without
                these routes tapping Followers/Following from a visitor
                profile navigated to a URL FollowsListPage could never
                resolve, rendering "User not found." for real users. */}
            <Route
              path="/user/id/:userId/followers"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><UserFollowers /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/user/id/:userId/following"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><UserFollowing /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/user/id/:userId/badges"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><UserBadgesPage /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* Full activity history — the destination behind the Recent
                activity "See all" on Profile Home. /activity below is a
                different surface (the signed-in user's calendar). */}
            <Route
              path="/user/:username/activity"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><UserActivity /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/user/id/:userId/activity"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><UserActivity /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* Yearly challenge detail — the games behind the ring. Takes
                an optional ?year= so an older challenge stays linkable. */}
            <Route
              path="/user/:username/challenge"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><ChallengeDetail /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/user/id/:userId/challenge"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><ChallengeDetail /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* Another user's tracked-games grid — the tap destination
                behind the Games stat on a visitor profile. Own profile
                routes to /library instead (see ProfilePlayerCard's
                onGamesClick in Profile.jsx); UserLibrary itself also
                redirects there as a safety net for a direct/deep link. */}
            <Route
              path="/user/:username/library"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><UserLibrary /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/user/id/:userId/library"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><UserLibrary /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/stats"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><Stats /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/activity"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><ActivityCalendar /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* Settings hub. Sub-screens are one push away and swipe back
                here. /edit-profile is unused: nothing links to it. The
                redirect stays so an old deep link still opens the modal. */}
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><Settings /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/settings/blocked"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><SettingsBlocked /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/settings/email"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><SettingsEmail /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/settings/password"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><SettingsPassword /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/settings/appearance"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><SettingsAppearance /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/settings/accessibility"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><SettingsAccessibility /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/settings/account"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><SettingsAccount /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/settings/privacy"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><SettingsPrivacy /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/settings/help"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><SettingsHelp /></LazyScreen></PageTransition>
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
                    <PageTransition swipeBack><LazyScreen><ReviewComments /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            {/* Pulse feed broadening — same threaded comments page, keyed
                to a non-review activity_events row (logged session,
                finished/started a game, added to backlog/a list). */}
            <Route
              path="/activity/:activityId/comments"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><ReviewComments /></LazyScreen></PageTransition>
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
                    <PageTransition swipeBack><LazyScreen><ReviewDetail /></LazyScreen></PageTransition>
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
                    <PageTransition swipeBack><LazyScreen><ReviewDetail /></LazyScreen></PageTransition>
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
              path="/notifications"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><NotificationsInbox /></LazyScreen></PageTransition>
                  </ErrorBoundary>
                </RequireAuth>
              }
            />
            <Route
              path="/messages"
              element={
                <RequireAuth>
                  <ErrorBoundary>
                    <PageTransition swipeBack><LazyScreen><MessagesInbox /></LazyScreen></PageTransition>
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
                    <PageTransition swipeBack><LazyScreen><MessagesThread /></LazyScreen></PageTransition>
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
            {import.meta.env.DEV && StreakUIDemo && (
              <Route
                path="/_dev/streak-ui"
                element={
                  <React.Suspense fallback={null}>
                    <StreakUIDemo />
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
      {showNav && <BottomNav scrollHidden={navScrollHidden} />}

      {/* Persistent session timer pill — floats above BottomNav when a
          session is running. Rendered outside .main-content so fixed
          positioning is not clipped by any transformed ancestor. */}
      {showNav && <SessionPill />}

      {/* Stop-session confirmation sheet — appears after stopGameSession(). */}
      <StopSessionSheet />
      <QaComposerHost />
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
          <NotificationsProvider>
            {/* GameColorProvider wraps everything so BottomNav, GameDetail, and
                any future chrome consumers can all read/write the current game's
                extracted swatch palette. */}
            <GameColorProvider>
              {/* SessionProvider sits inside AuthProvider (needs user) and
                  outside AppContent so the pill/sheet render outside routes. */}
              <SessionProvider>
              {/* NudgesProvider must be inside SessionProvider (usePresence
                  reads SessionContext for the currently-active game) and
                  inside AuthProvider (useProgressNudges reads user id).
                  It supplies transient presence pings + progress nudges
                  without touching the DB notifications inbox. */}
              <NudgesProvider>
              <AppContent />
              <ToastHost />
              {/* Mounted once at the root so first-time-Played transitions from
                  anywhere in the app (Game Detail, AddToListButton, future
                  quick-status changes) all surface the same celebration. The
                  component subscribes to celebrationService's queue and only
                  renders when the head is non-null. */}
              <CompletionCelebration />
              <RateItHost />
              {/* Mounted once at root — listens to 'streakUpdated' events and
                  shows the 3/7/15/30/100-day milestone celebration once per
                  milestone per user, EVER (server-gated via
                  user_streak_milestones — see streakMilestoneService.js and
                  MilestoneCelebration.jsx, S16-2). Never guilt, only joy. */}
              <MilestoneCelebration />
              {/* Mounted once at root — listens to 'badgeEarned' events
                  dispatched by useBadgeUnlockWatcher and shows a full-screen
                  reveal overlay for each newly-earned achievement badge. */}
              <BadgeReveal />
              {/* One-time historical-grants summary — first launch after
                  badges went live, never again. Genuine single unlocks
                  still go through BadgeReveal above. */}
              <BadgeBackfillSummary />
              </NudgesProvider>
              </SessionProvider>
            </GameColorProvider>
          </NotificationsProvider>
          </UnreadMessagesProvider>
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  )
}

export default App

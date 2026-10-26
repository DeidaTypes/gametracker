import React, {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  ADS_AVAILABLE,
  getAdsState,
  removeAds,
  setBannerWanted,
  subscribeAds,
} from '../services/adsService'
import './AdBanner.css'

/**
 * The free-user ad slot, mounted by BottomNav and nowhere else.
 *
 * The AdMob banner itself is a native view (see adsService.js) that sits
 * above the web view. This component decides when it may show and keeps the
 * web side in step with it:
 *
 *   - a strip behind the banner in the nav's own background token, so the
 *     slot blends with every theme;
 *   - the page's bottom padding, grown by the banner's height (body class
 *     `ad-banner-reserved`, rules in AdBanner.css) only once an ad has
 *     actually loaded, so there is never an empty gap.
 *
 * Who sees it: signed-in free users whose account is over a day old. The
 * moment plusActive turns true, or the profile says so, the native banner is
 * removed and the reserved space is released in the same render.
 *
 * Where: the four tab roots and Q&A, and only while the nav pill is on
 * screen. Pushed screens, popups, onboarding, Messages and Settings never
 * match, and neither does anything else with a composer bar.
 *
 * No animation of its own: native hide / show is instant, and the strip and
 * padding change in one frame, so reduced motion needs no special case.
 */

/** Tab roots, same table as BottomNav (Home, Discover, Library, Profile, Q&A). */
const TAB_ROOTS = new Set(['/', '/home', '/discover', '/explore', '/library', '/profile', '/qa'])

const DAY_MS = 24 * 60 * 60 * 1000
/** Longest delay setTimeout accepts. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1
/** Keep the reserved padding this long after leaving a tab root, so the page
 *  sliding out under a push does not reflow mid-slide. Matches --motion-duration. */
const RESERVE_RELEASE_MS = 400

const NARROW_QUERY = '(max-width: 768px)'
const POPUP_SELECTOR = '[aria-modal="true"], [role="dialog"], [role="alertdialog"]'

function isTabRoot(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return TAB_ROOTS.has(path)
}

function subscribeNarrow(onChange) {
  const mq = window.matchMedia(NARROW_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/** True while the pill nav is laid out (BottomNav.css hides it on wide screens). */
function useNarrowViewport() {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false
  )
}

/** True while any popup (centered modal, sheet, celebration, alert) is mounted. */
function usePopupOpen() {
  const [open, setOpen] = useState(() => !!document.querySelector(POPUP_SELECTOR))
  useEffect(() => {
    let frame = 0
    const check = () => {
      frame = 0
      setOpen(!!document.querySelector(POPUP_SELECTOR))
    }
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(check)
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal', 'role'],
    })
    check()
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
  return open
}

/** True for the first 24 hours of an account. An unknown age counts as new. */
function useFirstDay(createdAt) {
  const [, rerender] = useReducer((n) => n + 1, 0)
  const createdMs = createdAt ? Date.parse(createdAt) : NaN
  const known = Number.isFinite(createdMs)
  const endsAt = known ? createdMs + DAY_MS : 0

  useEffect(() => {
    if (!known) return undefined
    const remaining = endsAt - Date.now()
    if (remaining <= 0) return undefined
    const timer = setTimeout(rerender, Math.min(remaining, MAX_TIMEOUT_MS) + 50)
    return () => clearTimeout(timer)
  }, [known, endsAt])

  return !known || Date.now() < endsAt
}

function AdBannerInner({ navRef, navHidden }) {
  const { pathname } = useLocation()
  const { user, profile, plusActive } = useAuth()
  const { height } = useSyncExternalStore(subscribeAds, getAdsState, getAdsState)
  const narrow = useNarrowViewport()
  const popupOpen = usePopupOpen()
  const firstDay = useFirstDay(user?.created_at || profile?.created_at)

  const stripRef = useRef(null)
  const safeProbeRef = useRef(null)
  const [navHeight, setNavHeight] = useState(0)

  // The pill's own height, so the slot sits exactly one gap above it.
  useLayoutEffect(() => {
    const next = navRef.current?.offsetHeight || 0
    setNavHeight((prev) => (prev === next ? prev : next))
  })

  // Plus is known only once the profile row has loaded; until then no ad is
  // requested, so a Plus user never sees one flash by. The row is read
  // directly as well as through plusActive because plusActive follows it by
  // one effect.
  const isPlus = plusActive || profile?.plus_active === true
  const eligible = !!user && !!profile && !isPlus && !firstDay && narrow && navHeight > 0
  const onRoot = isTabRoot(pathname)
  const wanted = eligible && onRoot && !navHidden && !popupOpen
  const loaded = height > 0

  // Native banner: hidden or shown with the screen, removed for good when the
  // user stops being eligible.
  useEffect(() => {
    if (!eligible) {
      removeAds()
      return
    }
    if (!wanted) {
      setBannerWanted(false)
      return
    }
    // Points above the bottom safe-area edge, from the slot's own geometry.
    const strip = stripRef.current
    const safe = safeProbeRef.current?.offsetHeight || 0
    const fromBottom = strip ? parseFloat(getComputedStyle(strip).bottom) : NaN
    if (!Number.isFinite(fromBottom)) return
    setBannerWanted(true, fromBottom - safe)
  }, [eligible, wanted])

  useEffect(() => () => setBannerWanted(false), [])

  // Page padding: grown by the banner height only while an ad is loaded on a
  // tab root. Leaving the root keeps it a beat longer (RESERVE_RELEASE_MS);
  // losing eligibility drops it at once.
  const reserve = eligible && onRoot && loaded
  useLayoutEffect(() => {
    const body = document.body
    const apply = () => {
      body.style.setProperty('--ad-banner-reserve', `calc(${height}px + var(--space-8))`)
      body.classList.add('ad-banner-reserved')
    }
    const release = () => {
      body.classList.remove('ad-banner-reserved')
      body.style.removeProperty('--ad-banner-reserve')
    }
    if (reserve) {
      apply()
      return undefined
    }
    if (eligible && loaded) {
      const timer = setTimeout(release, RESERVE_RELEASE_MS)
      return () => clearTimeout(timer)
    }
    release()
    return undefined
  }, [reserve, eligible, loaded, height])

  useLayoutEffect(
    () => () => {
      document.body.classList.remove('ad-banner-reserved')
      document.body.style.removeProperty('--ad-banner-reserve')
    },
    []
  )

  return (
    <div
      ref={stripRef}
      className="ad-banner"
      data-active={wanted && loaded ? 'true' : 'false'}
      style={{
        '--ad-nav-height': `${navHeight}px`,
        '--ad-banner-height': `${height}px`,
      }}
      aria-hidden="true"
    >
      <span ref={safeProbeRef} className="ad-banner__safe-probe" />
    </div>
  )
}

export default function AdBanner(props) {
  // Constant for the life of the page, so hook order never changes.
  if (!ADS_AVAILABLE) return null
  return <AdBannerInner {...props} />
}

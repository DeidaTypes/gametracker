import { Capacitor } from '@capacitor/core'

/**
 * Ads for free users: one non-personalized AdMob adaptive banner above the
 * pill nav (see src/components/AdBanner.jsx, the only caller).
 *
 * This file owns the native banner and nothing else. WHO may see it and
 * WHERE (free users only, tab roots only, never over a popup) is decided by
 * AdBanner and passed in through setBannerWanted / removeAds.
 *
 * - Non-personalized only: every request carries npa=1. There is no ATT
 *   prompt and no consent form here: requestTrackingAuthorization and
 *   requestConsentInfo are never called, so iOS never asks.
 * - Both VITE_ADMOB_APP_ID and VITE_ADMOB_BANNER_IOS must be real values for
 *   ads to exist at all. Without them (or off native iOS) every function
 *   here is a no-op and no native code runs.
 * - Development builds always request Google's sample banner, never the real
 *   unit, so testing cannot generate invalid traffic on the live ad unit.
 *   A development build is `vite` or `vite build --mode development`
 *   (npm run build:dev).
 * - The plugin is imported lazily, only on native iOS with ids set, so the
 *   web build never loads it.
 *
 * The native banner is created once and then hidden / resumed as screens
 * change, never recreated for a screen change. The plugin only adds it to
 * the view hierarchy once an ad has actually loaded, so before that there is
 * nothing on screen, and `height` stays 0 so nothing is reserved for it.
 */

const env = import.meta.env

const APP_ID = typeof env.VITE_ADMOB_APP_ID === 'string' ? env.VITE_ADMOB_APP_ID.trim() : ''
const BANNER_UNIT_IOS =
  typeof env.VITE_ADMOB_BANNER_IOS === 'string' ? env.VITE_ADMOB_BANNER_IOS.trim() : ''

// ca-app-pub-<16 digits>~<10 digits> (app) and ca-app-pub-<16 digits>/<10 digits> (unit).
const APP_ID_RE = /^ca-app-pub-\d{16}~\d{10}$/
const UNIT_ID_RE = /^ca-app-pub-\d{16}\/\d{10}$/

/** Google's published sample iOS banner unit. Safe to request from any build. */
const GOOGLE_TEST_BANNER_IOS = 'ca-app-pub-3940256099942544/2435281174'

const IS_DEV_BUILD = env.DEV === true || env.MODE === 'development'

/** Both ids are set to well-formed values. */
export const ADS_CONFIGURED = APP_ID_RE.test(APP_ID) && UNIT_ID_RE.test(BANNER_UNIT_IOS)

/** Ads can exist in this build: configured, and running in the native iOS app. */
export const ADS_AVAILABLE = ADS_CONFIGURED && Capacitor.getPlatform() === 'ios'

/** After a failed load, wait this long before asking for another ad. */
const RETRY_AFTER_MS = 60 * 1000

/* ============================================================
   State (read by AdBanner through useSyncExternalStore)
   ============================================================ */

/** `height`: the loaded ad's height in points, 0 while no ad has loaded. */
let state = Object.freeze({ height: 0 })
const listeners = new Set()

function setHeight(height) {
  if (height === state.height) return
  state = Object.freeze({ height })
  for (const fn of listeners) fn()
}

export function getAdsState() {
  return state
}

export function subscribeAds(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/* ============================================================
   Native banner
   ============================================================ */

let pluginPromise = null
function loadPlugin() {
  if (!pluginPromise) pluginPromise = import('@capacitor-community/admob')
  return pluginPromise
}

let wanted = false // the current screen wants the banner visible
let destroyed = true // no banner is requested (never created, removed, or failed)
let removePending = false // a banner exists natively and must be removed
let loaded = false // an ad is in the native view hierarchy
let nativeVisible = false // ...and not hidden
let margin = 0 // points above the bottom safe-area edge, fixed at creation
let initialized = false
let listenersAttached = false
let retryTimer = null
let queue = Promise.resolve()

function serial(task) {
  const run = queue.then(task, task)
  queue = run.catch(() => {})
  return run
}

function scheduleRetry() {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    reconcile()
  }, RETRY_AFTER_MS)
}

function clearRetry() {
  if (!retryTimer) return
  clearTimeout(retryTimer)
  retryTimer = null
}

async function attachListeners(AdMob) {
  if (listenersAttached) return
  listenersAttached = true
  await AdMob.addListener('bannerAdSizeChanged', (info) => {
    // 0 comes from our own hideBanner and from a failed load; the first is
    // not "no ad" and the second is handled below, so only a real size counts.
    if (info && info.height > 0 && !destroyed) setHeight(Math.round(info.height))
  })
  await AdMob.addListener('bannerAdLoaded', () => {
    loaded = true
    nativeVisible = true
    // Removed (Plus, first day, sign-out) while this ad was still loading.
    if (destroyed) removePending = true
    reconcile()
  })
  await AdMob.addListener('bannerAdFailedToLoad', () => {
    loaded = false
    nativeVisible = false
    setHeight(0)
    if (!destroyed) {
      destroyed = true
      scheduleRetry()
    }
  })
}

/** Bring the native banner in line with `wanted` / `destroyed`. */
function reconcile() {
  return serial(async () => {
    try {
      const { AdMob, BannerAdSize, BannerAdPosition } = await loadPlugin()

      if (removePending) {
        removePending = false
        loaded = false
        nativeVisible = false
        await AdMob.removeBanner()
      }

      if (destroyed) {
        if (!wanted || retryTimer) return
        if (!initialized) {
          await AdMob.initialize({})
          initialized = true
        }
        await attachListeners(AdMob)
        destroyed = false
        await AdMob.showBanner({
          adId: IS_DEV_BUILD ? GOOGLE_TEST_BANNER_IOS : BANNER_UNIT_IOS,
          adSize: BannerAdSize.ADAPTIVE_BANNER,
          position: BannerAdPosition.BOTTOM_CENTER,
          margin,
          npa: true,
        })
        return
      }

      if (!loaded) return
      if (wanted && !nativeVisible) {
        nativeVisible = true
        await AdMob.resumeBanner()
      } else if (!wanted && nativeVisible) {
        nativeVisible = false
        await AdMob.hideBanner()
      }
    } catch (err) {
      console.warn('[ads] banner failed:', err?.message || err)
      destroyed = true
      removePending = false
      loaded = false
      nativeVisible = false
      setHeight(0)
      // Plugin not linked in this binary, or a native call failed. Back off
      // instead of retrying on every screen change.
      scheduleRetry()
    }
  })
}

/**
 * Show or hide the banner. Cheap to call on every change. The banner is
 * created the first time this is called with wanted=true. `nextMargin` is how
 * many points the banner sits above the bottom safe-area edge (the nav's
 * footprint); it is read once, when the banner is created.
 */
export function setBannerWanted(nextWanted, nextMargin) {
  if (!ADS_AVAILABLE) return
  wanted = nextWanted
  if (destroyed) margin = Math.max(0, Math.round(nextMargin || 0))
  reconcile()
}

/**
 * Hide and discard the banner right away and forget that an ad ever loaded:
 * a Plus purchase or restore, the first-day window, sign-out.
 */
export function removeAds() {
  if (!ADS_AVAILABLE) return
  wanted = false
  clearRetry()
  setHeight(0)
  if (destroyed && !loaded) return
  removePending = true
  destroyed = true
  reconcile()
}

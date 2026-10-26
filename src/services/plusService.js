import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

/**
 * Checkpoint Plus — purchases through RevenueCat, status from the server.
 *
 * The only thing the UI trusts is `users.plus_active`, which is written
 * solely by the revenuecat-webhook Edge Function (see
 * supabase/migrations/20261026140000_plus.sql). The RevenueCat SDK result of
 * a purchase or restore never flips the UI by itself; it only triggers a
 * re-read of the server value, polled for up to POLL_LIMIT_MS to cover webhook
 * lag (`finishing` is true meanwhile).
 *
 * Everything Plus is hidden unless VITE_REVENUECAT_IOS_KEY holds a real
 * RevenueCat iOS public SDK key. Buying and restoring additionally need the
 * native iOS app; the web build can still show other users' badges.
 */

const env = import.meta.env

const IOS_KEY = typeof env.VITE_REVENUECAT_IOS_KEY === 'string'
  ? env.VITE_REVENUECAT_IOS_KEY.trim()
  : ''

export const PLUS_CONFIG = Object.freeze({
  productModel: 'subscription',
  entitlementId: 'plus',
  productIds: Object.freeze({
    monthly: 'checkpoint_plus_monthly',
    yearly: 'checkpoint_plus_yearly',
  }),
})

/** Plus exists in this build (badges, context value). */
export const PLUS_ENABLED = /^appl_[A-Za-z0-9]+$/.test(IOS_KEY)

/** Buying / restoring is possible here (native iOS only). */
export const PLUS_PURCHASES_AVAILABLE = PLUS_ENABLED && Capacitor.getPlatform() === 'ios'

/** Apple's own subscription management page; '' for a one-time product. */
export const MANAGE_SUBSCRIPTION_URL = PLUS_CONFIG.productModel === 'subscription'
  ? 'itms-apps://apps.apple.com/account/subscriptions'
  : ''

const POLL_INTERVAL_MS = 1000
const POLL_LIMIT_MS = 10000

/* ============================================================
   Server status store
   ============================================================ */

let state = Object.freeze({ active: false, expiresAt: null, finishing: false })
let generation = 0
/** @type {Set<(s: typeof state) => void>} */
const listeners = new Set()

function setState(patch) {
  const next = { ...state, ...patch }
  if (
    next.active === state.active &&
    next.expiresAt === state.expiresAt &&
    next.finishing === state.finishing
  ) {
    return
  }
  state = Object.freeze(next)
  for (const fn of listeners) {
    try {
      fn(state)
    } catch (err) {
      console.error('[plus] subscriber failed:', err)
    }
  }
}

export function getPlusState() {
  return state
}

export function subscribePlus(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** The server's answer, as last read. Always false when Plus is not configured. */
export function isPlus() {
  return PLUS_ENABLED && state.active
}

/** Adopt plus_active from a freshly fetched profile row. */
export function seedPlusFromProfile(profile) {
  if (!profile) return
  setState({ active: profile.plus_active === true })
}

/** Signed out: forget everything and drop any in-flight refresh. */
export function resetPlus() {
  generation += 1
  setState({ active: false, expiresAt: null, finishing: false })
}

/** Re-read plus_active / plus_expires_at for the signed-in user. */
export async function refreshPlus() {
  if (!PLUS_ENABLED) return state
  const gen = generation
  const { data, error } = await supabase.rpc('my_plus_status')
  if (gen !== generation) return state
  if (error) {
    console.warn('[plus] status refresh failed:', error.message)
    return state
  }
  const row = Array.isArray(data) ? data[0] : data
  setState({
    active: row?.plus_active === true,
    expiresAt: row?.plus_expires_at || null,
  })
  return state
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Poll the server until it reports Plus or POLL_LIMIT_MS passes. */
async function awaitServerPlus() {
  const gen = generation
  const deadline = Date.now() + POLL_LIMIT_MS
  setState({ finishing: true })
  try {
    for (;;) {
      await refreshPlus()
      if (gen !== generation) return false
      if (state.active) return true
      if (Date.now() >= deadline) return false
      await sleep(POLL_INTERVAL_MS)
    }
  } finally {
    if (gen === generation) setState({ finishing: false })
  }
}

/* ============================================================
   RevenueCat SDK
   ============================================================ */

let pluginPromise = null
let configured = false
let rcUserId = null
let queue = Promise.resolve()

function loadPurchases() {
  if (!pluginPromise) {
    pluginPromise = import('@revenuecat/purchases-capacitor').then((m) => m.Purchases)
  }
  return pluginPromise
}

// configure / logIn / logOut must not interleave.
function serial(task) {
  const run = queue.then(task, task)
  queue = run.catch(() => {})
  return run
}

/** Identify the RevenueCat customer as our Supabase user. */
export function plusLogIn(userId) {
  if (!PLUS_PURCHASES_AVAILABLE || !userId) return Promise.resolve()
  return serial(async () => {
    const Purchases = await loadPurchases()
    if (!configured) {
      await Purchases.configure({ apiKey: IOS_KEY, appUserID: userId })
      configured = true
      rcUserId = userId
      return
    }
    if (rcUserId !== userId) {
      await Purchases.logIn({ appUserID: userId })
      rcUserId = userId
    }
  })
}

export function plusLogOut() {
  if (!PLUS_PURCHASES_AVAILABLE) return Promise.resolve()
  return serial(async () => {
    if (!configured || !rcUserId) return
    rcUserId = null
    const Purchases = await loadPurchases()
    await Purchases.logOut()
  })
}

async function signedInPurchases() {
  if (!PLUS_PURCHASES_AVAILABLE) throw new Error('Checkpoint Plus is not available here.')
  await queue
  if (!configured || !rcUserId) throw new Error('Sign in to use Checkpoint Plus.')
  return loadPurchases()
}

function isCancelled(err) {
  return err?.userCancelled === true || String(err?.code) === '1'
}

/**
 * The current offering's Plus packages, matched to PLUS_CONFIG.productIds.
 * Prices come from `pkg.product.priceString` (App Store localized) — never
 * hardcode one. A plan the offering doesn't carry is null.
 *
 * @returns {Promise<{ monthly: object|null, yearly: object|null }>}
 */
export async function getOfferings() {
  const Purchases = await signedInPurchases()
  const offerings = await Purchases.getOfferings()
  const packages = offerings?.current?.availablePackages || []
  const byProduct = (id) => packages.find((p) => p?.product?.identifier === id) || null
  return {
    monthly: byProduct(PLUS_CONFIG.productIds.monthly),
    yearly: byProduct(PLUS_CONFIG.productIds.yearly),
  }
}

/**
 * Buy a package from getOfferings().
 * @returns {Promise<{ status: 'active' | 'pending' | 'cancelled' }>}
 *   'pending' = Apple charged, but the server hasn't confirmed within the
 *   polling window yet; the next refresh (resume, relaunch) will pick it up.
 */
export async function purchase(pkg) {
  const Purchases = await signedInPurchases()
  try {
    await Purchases.purchasePackage({ aPackage: pkg })
  } catch (err) {
    if (isCancelled(err)) return { status: 'cancelled' }
    throw err
  }
  return { status: (await awaitServerPlus()) ? 'active' : 'pending' }
}

/**
 * Restore purchases for this Apple ID onto the signed-in account.
 * @returns {Promise<{ status: 'active' | 'pending' | 'none' }>}
 */
export async function restore() {
  const Purchases = await signedInPurchases()
  const { customerInfo } = await Purchases.restorePurchases()
  const hasEntitlement = Boolean(customerInfo?.entitlements?.active?.[PLUS_CONFIG.entitlementId])
  if (!hasEntitlement) {
    await refreshPlus()
    return { status: isPlus() ? 'active' : 'none' }
  }
  return { status: (await awaitServerPlus()) ? 'active' : 'pending' }
}

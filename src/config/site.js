/**
 * Site configuration — the ONLY place the app's outward-facing values live.
 *
 * Everything here is read from VITE_ env vars at build time (see .env.example)
 * and is public by nature: it is compiled into the bundle, so nothing in this
 * file may be secret.
 *
 * Rule for every consumer: a value that is not configured is an empty string,
 * and the feature that needs it is HIDDEN (or, for share actions, degrades to
 * sharing text without a link). Never substitute a placeholder.
 *
 *   SITE_URL        https://… origin of the static site in /web. Powers the
 *                   Privacy / Terms rows and every shared link.
 *   SUPPORT_EMAIL   Address behind "Send feedback".
 *   APP_STORE_ID    Numeric App Store ID. Powers "Rate the app".
 */

const env = import.meta.env

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function readSiteUrl() {
  const raw = clean(env.VITE_SITE_URL).replace(/\/+$/, '')
  return /^https?:\/\/[^\s/]+/i.test(raw) ? raw : ''
}

function readSupportEmail() {
  const raw = clean(env.VITE_SUPPORT_EMAIL)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : ''
}

function readAppStoreId() {
  const raw = clean(env.VITE_APP_STORE_ID)
  // Real App Store IDs are 9-10 digits; an all-zero value is not an ID.
  return /^(?!0+$)\d{6,}$/.test(raw) ? raw : ''
}

export const SITE_URL = readSiteUrl()
export const SUPPORT_EMAIL = readSupportEmail()
export const APP_STORE_ID = readAppStoreId()

/**
 * Version comes from package.json, injected at build time by vite.config.js
 * (`define: { __APP_VERSION__ }`). Empty when the build did not inject it.
 */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''
export const BUILD_NUMBER = clean(env.VITE_BUILD_NUMBER)

/** Custom URL scheme registered in ios/App/App/Info.plist. */
export const APP_URL_SCHEME = 'checkpoint'

export const PRIVACY_URL = SITE_URL ? `${SITE_URL}/privacy` : ''
export const TERMS_URL = SITE_URL ? `${SITE_URL}/terms` : ''

/** itms-apps:// opens the App Store's review screen directly on iOS. */
export const RATE_APP_URL = APP_STORE_ID
  ? `itms-apps://itunes.apple.com/app/id${APP_STORE_ID}?action=write-review`
  : ''

/** True when share actions can include a link. */
export const SHARE_LINKS_ENABLED = Boolean(SITE_URL)

/**
 * One short path segment per shareable thing. The same segments are used by
 * the web landing pages (/web/r, /l, /q, /u) and by the checkpoint:// deep
 * links, and appLifecycle.js maps them onto app routes.
 */
const LINK_SEGMENT = Object.freeze({
  review: 'r',
  list: 'l',
  question: 'q',
  profile: 'u',
})

const MAX_LINK_TITLE = 100

/**
 * Public https link to a share landing page, or '' when SITE_URL is not set
 * (or the thing has no id). Callers share text without a link in that case.
 *
 * `title` is optional and ends up in the URL as ?t=… so the landing page can
 * name what was shared without fetching anything.
 *
 * @param {'review'|'list'|'question'|'profile'} kind
 * @param {string} id   review / list / question id, or the profile username
 * @param {{ title?: string }} [opts]
 * @returns {string}
 */
export function siteLink(kind, id, { title } = {}) {
  const segment = LINK_SEGMENT[kind]
  const value = id == null ? '' : String(id).trim()
  if (!SITE_URL || !segment || !value) return ''
  const base = `${SITE_URL}/${segment}/${encodeURIComponent(value)}`
  const label = clean(title).slice(0, MAX_LINK_TITLE)
  return label ? `${base}?t=${encodeURIComponent(label)}` : base
}

/**
 * Link to the site root. Used for invites, which carry ?ref=<userId>.
 * '' when SITE_URL is not set.
 */
export function siteRootLink(params) {
  if (!SITE_URL) return ''
  const query = params ? new URLSearchParams(params).toString() : ''
  return query ? `${SITE_URL}/?${query}` : SITE_URL
}

/** mailto: link to support, or '' when SUPPORT_EMAIL is not set. */
export function supportMailto(subject) {
  if (!SUPPORT_EMAIL) return ''
  return subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`
}

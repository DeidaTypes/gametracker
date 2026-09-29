// storageQuota — shared helpers for detecting and diagnosing localStorage
// quota exhaustion.
//
// Root cause context (see libraryService.js / swipeService.js for the
// fixes): a Capacitor WKWebView's localStorage quota is far smaller than a
// desktop browser's, so writes that never come close to failing on web can
// throw QuotaExceededError on a physical iOS device after a relatively
// small amount of bloat accumulates. This module is the one place that
// decides "was that a quota error?" so every storage-layer catch block
// agrees on the answer, and the one place that measures per-key size so an
// on-device diagnosis doesn't need ad-hoc math scattered across files.
//
// getLocalStorageSizes() and getTotalLocalStorageBytes() are not called on
// launch. From a device Web Inspector console, import this module and call
// them when a future quota issue needs measuring.

/**
 * True if `err` is a localStorage quota-exceeded error, across the
 * spellings different engines/versions actually throw:
 *   - modern spec: DOMException named 'QuotaExceededError'
 *   - legacy WebKit/Safari: err.code === 22
 *   - legacy Firefox: err.code === 1014 (NS_ERROR_DOM_QUOTA_REACHED)
 *   - belt-and-suspenders: message text containing "quota"
 */
export function isQuotaExceededError(err) {
  if (!err) return false
  if (err.name === 'QuotaExceededError') return true
  if (err.code === 22 || err.code === 1014) return true
  return /quota/i.test(err.message || '')
}

/** Byte length of a string as UTF-16 (how localStorage actually counts it). */
export function byteLength(str) {
  if (typeof str !== 'string') return 0
  // localStorage stores UTF-16 code units, 2 bytes each. Good enough for a
  // diagnostic estimate — we don't need surrogate-pair-exact precision.
  return str.length * 2
}

/**
 * Measure every localStorage key belonging to this app (i.e. everything
 * present — localStorage is already namespaced to this origin), sorted
 * largest first.
 *
 * @returns {Array<{ key: string, bytes: number, kb: number }>}
 */
export function getLocalStorageSizes() {
  const rows = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key == null) continue
      let value = ''
      try {
        value = localStorage.getItem(key) || ''
      } catch {
        continue
      }
      const bytes = byteLength(value)
      rows.push({ key, bytes, kb: Math.round((bytes / 1024) * 10) / 10 })
    }
  } catch {
    return []
  }
  return rows.sort((a, b) => b.bytes - a.bytes)
}

/** Total bytes across every localStorage key belonging to this app. */
export function getTotalLocalStorageBytes() {
  return getLocalStorageSizes().reduce((sum, row) => sum + row.bytes, 0)
}

// Caches and abandoned blobs. Safe to drop under pressure: the next read
// refetches them. Never put account data here (gameLibrary, profile,
// settings, swipe history).
const DISPOSABLE_LOCAL_STORAGE_KEYS = [
  'search_cache_v1', // abandoned by searchService (now search_cache_v3)
  'search_cache_v2',
  'search_cache_v3',
  'gameColorCache_v1',
  'gt:ttb:v1',
  'gt:ttb:v2',
  'gt:igdb-genres:v1',
  'gt:igdb-themes:v1',
  'search:browse-categories',
]

// reviewService copies this blob to Supabase once, then leaves it in place.
// Once the marker exists the copy is redundant and is often the thing
// still filling a WKWebView quota.
const LEGACY_REVIEWS_KEY = 'gameReviews'
const LEGACY_REVIEWS_MIGRATED_KEY = 'gameReviews_migratedToSupabase'

/**
 * Drop abandoned keys, and the legacy reviews blob once it has already
 * been migrated. Called on startup so a full disk is cleared before the
 * first user action, not only after a write fails.
 */
export function freeAbandonedLocalStorage() {
  try {
    localStorage.removeItem('search_cache_v1')
    localStorage.removeItem('search_cache_v2')
    localStorage.removeItem('gt:ttb:v1')
    if (localStorage.getItem(LEGACY_REVIEWS_MIGRATED_KEY)) {
      localStorage.removeItem(LEGACY_REVIEWS_KEY)
    }
  } catch {
    // storage unavailable — nothing to free
  }
}

function evictDisposableLocalStorage() {
  try {
    for (const key of DISPOSABLE_LOCAL_STORAGE_KEYS) {
      localStorage.removeItem(key)
    }
    if (localStorage.getItem(LEGACY_REVIEWS_MIGRATED_KEY)) {
      localStorage.removeItem(LEGACY_REVIEWS_KEY)
    }
  } catch {
    // best-effort
  }
}

// One announcement per page load. A full disk used to toast on every status
// tap, swipe, and save. A later small write succeeding must not re-arm it —
// those succeed even while gameLibrary itself still cannot be replaced.
let storageFullAnnounced = false

/** True the first time a quota failure should be shown this page load. */
export function claimStorageFullAnnouncement() {
  if (storageFullAnnounced) return false
  storageFullAnnounced = true
  return true
}

/**
 * localStorage.setItem that survives a WKWebView quota.
 *
 * WebKit counts the existing value and the replacement at the same time, so
 * a shrinking rewrite of a large key (the slim-library migration, a pruned
 * swipe log) throws QuotaExceededError even when the new value would fit on
 * its own. Recovery is: drop caches, then remove the key and write it back.
 * If the new write still fails, the previous value is restored.
 *
 * @returns {{ ok: boolean, quota: boolean }}
 *   ok    — the value is now stored
 *   quota — the failure (or the recovery) involved a quota error
 */
export function setLocalStorageItem(key, value) {
  const raw = String(value)
  try {
    localStorage.setItem(key, raw)
    return { ok: true, quota: false }
  } catch (err) {
    if (!isQuotaExceededError(err)) return { ok: false, quota: false }
  }

  evictDisposableLocalStorage()
  try {
    localStorage.setItem(key, raw)
    return { ok: true, quota: true }
  } catch (err) {
    if (!isQuotaExceededError(err)) return { ok: false, quota: false }
  }

  let previous
  try {
    previous = localStorage.getItem(key)
  } catch {
    previous = null
  }
  try {
    localStorage.removeItem(key)
  } catch {
    // keep going — the set below reports the real outcome
  }
  try {
    localStorage.setItem(key, raw)
    return { ok: true, quota: true }
  } catch (err) {
    if (previous != null) {
      try {
        localStorage.setItem(key, previous)
      } catch {
        // Both the new value and the backup failed. The caller still holds
        // the new value in memory and can retry with a smaller payload.
      }
    }
    return { ok: false, quota: isQuotaExceededError(err) }
  }
}

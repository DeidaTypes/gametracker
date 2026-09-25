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

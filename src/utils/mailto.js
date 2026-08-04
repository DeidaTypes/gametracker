/**
 * Opens a `mailto:` link and reports whether a mail client appears to
 * have handled it.
 *
 * iOS gives web/Capacitor code no direct success/failure callback for
 * custom URL schemes, so this uses the standard heuristic: trigger the
 * navigation, then watch for the page losing focus/visibility shortly
 * after (the OS handing off to Mail). If that never happens within the
 * timeout — e.g. the user deleted the stock Mail app and has no other
 * mail client configured — we resolve `false` so the caller can fall
 * back to a "copy the address" affordance instead of failing silently.
 */
export function openMailto(url, { timeout = 1200 } = {}) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      resolve(false)
      return
    }

    let settled = false
    const finish = (opened) => {
      if (settled) return
      settled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onHide)
      resolve(opened)
    }

    const onVisibilityChange = () => {
      if (document.hidden) finish(true)
    }
    const onHide = () => finish(true)

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onHide)

    window.location.href = url

    setTimeout(() => finish(false), timeout)
  })
}

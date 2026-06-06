/**
 * fetchWithTimeout — a drop-in `fetch` wrapper that aborts a request that
 * never settles.
 *
 * Why this exists: a bare `await fetch(...)` has NO timeout. On a flaky
 * mobile network (or against a host the device simply can't reach — e.g. a
 * physical iPhone that can't hit a dev localhost), the connection can be
 * opened and then held open indefinitely, so the promise never resolves OR
 * rejects. Any loading state gated on that promise then spins forever, even
 * when the calling code correctly resolves `loading` in a `finally` block —
 * because `finally` never runs.
 *
 * Wrapping every network call so it is guaranteed to settle (resolve OR
 * reject within `timeoutMs`) means a hung request becomes a normal error,
 * which the existing error/finally paths already handle → the screen shows
 * an empty/error state instead of an infinite spinner.
 *
 * CRITICAL — why this RACES instead of only aborting:
 * An earlier version returned `fetch(...).finally(...)` and relied on
 * `controller.abort()` (fired by the timer) to reject the request. That works
 * in Chrome/dev, where aborting a fetch always rejects its promise. It does
 * NOT work in WKWebView (the Capacitor iOS runtime): when a request stalls at
 * the network layer (connection opened but no response — routine on flaky
 * mobile networks), calling `abort()` does not reliably settle the underlying
 * fetch promise. Because the wrapper returned that same promise, it never
 * settled either → every `await` hung forever → the `finally` that clears a
 * screen's `loading` flag never ran → universal infinite spinner, and writes
 * silently hung. Since the Supabase client routes ALL of its REST + auth
 * traffic through this wrapper (global.fetch override), and IGDB routes its
 * proxy through it too, that single failure took down every screen at once.
 *
 * The fix: settle on OUR OWN timer via Promise.race. The wrapper rejects after
 * `timeoutMs` no matter what the underlying fetch does, so the promise is
 * GUARANTEED to settle and downstream `finally`/error handling always runs.
 * We still call `abort()` as a best-effort to free the socket and to honor a
 * caller-supplied AbortSignal — but correctness no longer depends on it.
 */

export const DEFAULT_FETCH_TIMEOUT_MS = 15000

export function fetchWithTimeout(input, init = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  // If a caller already passed their own AbortSignal, respect it by chaining:
  // either signal aborting will abort the request.
  const controller = new AbortController()
  const externalSignal = init.signal

  const onExternalAbort = () => controller.abort(externalSignal?.reason)
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason)
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }
  }

  let timer
  // Independent timeout: this promise rejects on its own, so the race below
  // ALWAYS settles within `timeoutMs` even if the fetch promise never does
  // (the WKWebView stall described above).
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      // Best-effort cleanup. Even if the runtime ignores the abort and leaves
      // the fetch pending, the rejection below still settles the wrapper.
      try {
        controller.abort(new DOMException('Request timed out', 'TimeoutError'))
      } catch {
        // Some runtimes throw if abort() is called with a reason — ignore.
      }
      reject(new DOMException(`Request timed out after ${timeoutMs}ms`, 'TimeoutError'))
    }, timeoutMs)
  })

  const request = fetch(input, { ...init, signal: controller.signal })

  return Promise.race([request, timeout]).finally(() => {
    clearTimeout(timer)
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort)
    }
  })
}

export default fetchWithTimeout

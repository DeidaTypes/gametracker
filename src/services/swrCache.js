// Shared stale-while-revalidate cache — Sprint perf pass.
//
// WHY THIS EXISTS
// ----------------
// There is no page-level cache anywhere in the app (no react-query/SWR),
// so every navigation to a screen re-fetches all of its data from
// scratch, even when the user was on that exact screen seconds ago
// (e.g. Home -> Profile -> back -> Profile again). This module is a
// small, dependency-free stand-in: a single in-memory Map keyed by
// "screen+params" strings, with real stale-while-revalidate semantics —
//
//   - Cold key (never fetched, or explicitly invalidated): block on the
//     fetcher, cache the result.
//   - Warm + fresh (younger than `ttlMs`): return the cached value
//     synchronously (well, as a resolved Promise) with zero network
//     calls.
//   - Warm + stale (older than `ttlMs` but not invalidated): return the
//     cached value immediately so the screen never blocks on the
//     network, AND kick a de-duped background refetch so the cache is
//     fresh for the *next* read.
//   - Concurrent callers for the same key while a fetch is in flight
//     share the one in-flight promise instead of firing N requests.
//
// REVALIDATION
// ------------
// Wired directly to the two window events that mean "the data this app
// holds may now be wrong": `app:resumed` (native app was backgrounded —
// see src/services/resumeSequence.js) and `libraryUpdated` (the
// existing cross-app "something in the library/activity graph changed"
// event, dispatched from src/services/libraryService.js and friends).
// On either event every cached entry is invalidated, so the very next
// read for any key is a real network fetch — this is what satisfies the
// "revalidate on resume" requirement without every consuming page having
// to remember to wire its own resume listener into this cache.
//
// Callers that have their OWN more specific "this exact data changed"
// events (e.g. Profile already listens for `reviewAdded`,
// `profileUpdated`, pin-changed events, etc.) should call
// `invalidateSWR(key)` (or pass `{ force: true }` to the next
// `getSWR` call) from those handlers — this module only owns the two
// generic, app-wide signals.
//
// This intentionally does NOT try to be react-query: no hooks, no
// subscriptions, no request de-duping across different keys. Just
// enough to stop identical re-fetches within a short window and to
// avoid serving hopelessly stale data after a resume.

const DEFAULT_TTL_MS = 60 * 1000

/** @type {Map<string, { data: any, fetchedAt: number, ttlMs: number, promise?: Promise<any> }>} */
const store = new Map()

function isFresh(entry) {
  return !!entry && entry.data !== undefined && Date.now() - entry.fetchedAt < entry.ttlMs
}

function refetch(key, fetcher, ttlMs) {
  const prior = store.get(key)

  const promise = Promise.resolve()
    .then(fetcher)
    .then((data) => {
      store.set(key, { data, fetchedAt: Date.now(), ttlMs })
      return data
    })
    .catch((err) => {
      // Keep serving the last good value (if any) rather than wiping the
      // entry out on a transient failure — just drop the in-flight
      // promise so the next call retries instead of hanging on a
      // rejected promise forever.
      if (prior && prior.data !== undefined) {
        store.set(key, { data: prior.data, fetchedAt: prior.fetchedAt, ttlMs: prior.ttlMs })
      } else {
        store.delete(key)
      }
      throw err
    })

  store.set(key, { ...(prior || {}), promise, ttlMs })
  return promise
}

/**
 * Read-through cache with stale-while-revalidate semantics.
 *
 * @template T
 * @param {string} key - unique cache key, conventionally `"<screen>:<params>"`
 *   e.g. `"profile:${targetUserId}"` or `"search:browse-categories"`.
 * @param {() => Promise<T>} fetcher - only called on a cache miss / stale
 *   revalidation / forced refresh.
 * @param {{ ttlMs?: number, force?: boolean }} [options]
 *   - ttlMs: how long a value is served with zero network activity.
 *     Defaults to 60s.
 *   - force: skip the cache entirely and block on a fresh fetch (use
 *     from a handler for an event this cache doesn't already know
 *     about, e.g. "this specific review was just posted").
 * @returns {Promise<T>}
 */
export function getSWR(key, fetcher, { ttlMs = DEFAULT_TTL_MS, force = false } = {}) {
  const entry = store.get(key)

  if (force) {
    return refetch(key, fetcher, ttlMs)
  }

  // Concurrent callers for a cold/stale key share one request.
  if (entry?.promise) {
    return entry.promise
  }

  if (isFresh(entry)) {
    return Promise.resolve(entry.data)
  }

  if (entry && entry.data !== undefined) {
    // Stale but present — serve it now, revalidate in the background.
    refetch(key, fetcher, ttlMs).catch(() => {
      // Swallowed: the caller isn't awaiting this background refresh,
      // and refetch() already preserved the last good value on failure.
    })
    return Promise.resolve(entry.data)
  }

  return refetch(key, fetcher, ttlMs)
}

/** Drop a single cache entry so the next `getSWR` call for it is a real fetch. */
export function invalidateSWR(key) {
  store.delete(key)
}

/** Drop every cache entry whose key starts with `prefix` (e.g. `"profile:"`). */
export function invalidateSWRPrefix(prefix) {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k)
  }
}

/** Drop the entire cache. Called automatically on resume / library updates. */
export function clearSWRCache() {
  store.clear()
}

if (typeof window !== 'undefined') {
  window.addEventListener('app:resumed', clearSWRCache)
  window.addEventListener('libraryUpdated', clearSWRCache)
}

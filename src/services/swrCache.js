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
// `app:resumed` invalidates everything. `libraryUpdated` invalidates
// everything a write can reach, which is every key except the handful
// backed purely by the IGDB catalog — see WRITE_IMMUNE_KEY_PREFIXES for
// why that exclusion is safe. Either way the next read for an invalidated
// key is a real network fetch, which satisfies the "revalidate on resume"
// requirement without every consuming page having to wire its own resume
// listener into this cache.
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

/**
 * Read whatever is already cached for `key` without touching the network.
 *
 * `getSWR` is async even on a hit, so a component that only used it would
 * still render one empty frame before the resolved promise lands — which
 * on a screen transition reads as a flash of blank content. `peekSWR` lets
 * a caller seed its initial state synchronously and paint real content on
 * the first frame, while `getSWR` runs alongside to revalidate.
 *
 * Returns `undefined` when nothing is cached, which callers can safely
 * treat as "we have nothing to show yet, so show a skeleton".
 */
export function peekSWR(key) {
  return store.get(key)?.data
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

/** Drop the entire cache. Called on app resume and on account teardown. */
export function clearSWRCache() {
  store.clear()
}

/**
 * Key prefixes whose fetcher issues NO Supabase read — pure IGDB catalog
 * data. These are the only entries allowed to survive `libraryUpdated`.
 *
 * The invariant is what makes the narrowing safe, so it is worth stating
 * plainly: a prefix may appear here ONLY if nothing it fetches can be
 * changed by anything a user does in this app. `libraryUpdated` is
 * dispatched from 21 write paths (tracker status, progress, hours,
 * sessions, list membership, list metadata, pins, bulk moves). Not one of
 * them can alter a game's IGDB title, cover, summary, genre tags, or which
 * games IGDB considers popular / upcoming. Every other key still gets
 * cleared exactly as before, so no write path can end up under-invalidated
 * — the narrowing removes work, never invalidation.
 *
 *   game:<igdbId>            → getGameById            (IGDB /games)
 *   search:browse-categories → fetchBrowseBuckets     (IGDB /multiquery)
 *   explore:new-releases     → getUpcomingReleases    (IGDB /games)
 *
 * Deliberately NOT here, even though it is tempting: the rest of
 * `explore:*`. Those rails read reviews, trackers, lists and
 * activity_events, all of which the write paths above do change.
 */
const WRITE_IMMUNE_KEY_PREFIXES = [
  'game:',
  'search:browse-categories',
  'explore:new-releases',
]

function isWriteImmune(key) {
  return WRITE_IMMUNE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/**
 * Invalidate everything a write could have touched.
 *
 * Previously this was a full `store.clear()`, which meant setting a game's
 * status also threw away that game's IGDB metadata and the browse
 * categories — data the write cannot affect, and which then cost a fresh
 * fan-out of IGDB requests on the very next navigation.
 */
export function invalidateAfterWrite() {
  for (const key of store.keys()) {
    if (!isWriteImmune(key)) store.delete(key)
  }
}

/* ──────────────────────────────────────────────────────────────────────
   In-flight request coalescing
   ────────────────────────────────────────────────────────────────────── */

/**
 * Share one in-flight promise between concurrent callers asking for the
 * same thing.
 *
 * This is deliberately NOT a cache: the entry is dropped the moment the
 * promise settles, so a later call always goes to the network and no
 * caller can ever observe a value that was already stale when it asked.
 * That makes it safe to wrap read paths that sit behind writes, which is
 * why it exists separately from `getSWR` rather than as a shorter TTL on
 * it.
 *
 * It exists because several independent consumers legitimately need the
 * same data on the same mount — Profile's bundle and its BadgesRow both
 * want the user's reviews, every review card and the feed both want like
 * counts — and each was issuing its own identical request in the same
 * tick. Measured on entry, roughly 40% of the app's requests were exact
 * duplicates already in flight.
 *
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
const inFlight = new Map()

export function dedupeInFlight(key, fn) {
  const existing = inFlight.get(key)
  if (existing) return existing

  const promise = Promise.resolve()
    .then(fn)
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, promise)
  return promise
}

if (typeof window !== 'undefined') {
  // Resume still clears everything: the app was suspended for an unknown
  // length of time, so even the IGDB-backed entries are worth re-reading,
  // and this is not a path the user is waiting on a navigation for.
  window.addEventListener('app:resumed', clearSWRCache)
  window.addEventListener('libraryUpdated', invalidateAfterWrite)
}

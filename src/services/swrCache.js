// Shared stale-while-revalidate cache. In memory only — never localStorage
// (WKWebView quota). No extra library.
//
// An entry stays for the session. `ttlMs` only decides whether the next
// read revalidates in the background. `peekSWR` always returns the last
// value, including after the TTL and after a stale mark.
//
//   app:resumed       mark every entry stale (revalidate on next read),
//                     except discover:deck: (in-progress swipe queue)
//   libraryUpdated    mark library-dependent keys stale (see below)
//   sign-out / account switch / account deletion
//                     clearSWRCache() via clearAllLocalUserData()
//
// The cache does not know the current user. Callers put the user id in
// the key when the value is account-shaped. Identity changes must go
// through clearSWRCache — an in-flight fetch that finishes after a clear
// is dropped (epoch), so the next account cannot observe the previous
// account's write.

const DEFAULT_TTL_MS = 60 * 1000
const MAX_ENTRIES = 200

/** @type {Map<string, { data: any, fetchedAt: number, ttlMs: number, lastAccess: number, promise?: Promise<any> }>} */
const store = new Map()

/** @type {Map<string, Set<(data: any) => void>>} */
const subscribers = new Map()

/** Bumped on clear so a fetch that started under the previous account cannot write back. */
let epoch = 0

/** Per-key generation so a superseded refetch cannot overwrite a newer one. */
const requestSeq = new Map()

/** Separate from the value cache: coalesces concurrent identical reads, then forgets them. */
const inFlight = new Map()

function isFresh(entry) {
  return !!entry && entry.data !== undefined && Date.now() - entry.fetchedAt < entry.ttlMs
}

function notify(key, data) {
  const set = subscribers.get(key)
  if (!set) return
  for (const fn of set) {
    try {
      fn(data)
    } catch (err) {
      console.error('[swrCache] subscriber failed:', err)
    }
  }
}

function evictLRU() {
  while (store.size > MAX_ENTRIES) {
    let victim = null
    for (const key of store.keys()) {
      if (subscribers.get(key)?.size) continue
      if (store.get(key)?.promise) continue
      victim = key
      break
    }
    if (!victim) victim = store.keys().next().value
    if (!victim) break
    store.delete(victim)
  }
}

function touch(key) {
  const entry = store.get(key)
  if (!entry) return undefined
  entry.lastAccess = Date.now()
  store.delete(key)
  store.set(key, entry)
  return entry
}

function commit(key, entry) {
  const next = {
    data: entry.data,
    fetchedAt: entry.fetchedAt,
    ttlMs: entry.ttlMs,
    lastAccess: Date.now(),
  }
  store.delete(key)
  store.set(key, next)
  evictLRU()
  notify(key, next.data)
}

function bumpSeq(key) {
  const seq = (requestSeq.get(key) || 0) + 1
  requestSeq.set(key, seq)
  return seq
}

function refetch(key, fetcher, ttlMs) {
  const myEpoch = epoch
  const seq = bumpSeq(key)
  const prior = store.get(key)

  const promise = Promise.resolve()
    .then(fetcher)
    .then((data) => {
      if (myEpoch !== epoch || requestSeq.get(key) !== seq) return data
      commit(key, { data, fetchedAt: Date.now(), ttlMs })
      return data
    })
    .catch((err) => {
      if (myEpoch !== epoch || requestSeq.get(key) !== seq) throw err
      if (prior && prior.data !== undefined) {
        const kept = {
          data: prior.data,
          fetchedAt: prior.fetchedAt,
          ttlMs: prior.ttlMs,
          lastAccess: Date.now(),
        }
        store.delete(key)
        store.set(key, kept)
      } else {
        store.delete(key)
      }
      throw err
    })

  store.set(key, {
    ...(prior || {}),
    data: prior?.data,
    fetchedAt: prior?.fetchedAt ?? 0,
    ttlMs,
    lastAccess: Date.now(),
    promise,
  })
  return promise
}

/**
 * Read-through cache. A warm entry is returned immediately. TTL expiry
 * and a stale mark both revalidate in the background without dropping
 * the value `peekSWR` can see.
 *
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fetcher
 * @param {{ ttlMs?: number, force?: boolean }} [options]
 * @returns {Promise<T>}
 */
export function getSWR(key, fetcher, { ttlMs = DEFAULT_TTL_MS, force = false } = {}) {
  if (!key) return Promise.resolve().then(fetcher)

  const entry = store.get(key)

  if (force) {
    return refetch(key, fetcher, ttlMs)
  }

  if (entry && entry.data !== undefined && isFresh(entry)) {
    touch(key)
    return Promise.resolve(entry.data)
  }

  if (entry && entry.data !== undefined) {
    if (!entry.promise) {
      refetch(key, fetcher, ttlMs).catch((err) => {
        console.error('[swrCache] background revalidate failed:', key, err)
      })
    }
    touch(key)
    return Promise.resolve(entry.data)
  }

  if (entry?.promise) return entry.promise

  return refetch(key, fetcher, ttlMs)
}

/**
 * Synchronous read. `undefined` means this key has never resolved during
 * the session (or was evicted / cleared). A stale entry still returns
 * its last value.
 */
export function peekSWR(key) {
  if (!key) return undefined
  const entry = touch(key)
  if (!entry || entry.data === undefined) return undefined
  return entry.data
}

/** True when the entry is inside its TTL and not marked stale. */
export function isSWRFresh(key) {
  return isFresh(store.get(key))
}

/** In-flight revalidation for `key`, if one is running. */
export function peekSWRInFlight(key) {
  return store.get(key)?.promise
}

/**
 * Subscribe to cache writes for `key` (including clears, which publish
 * `undefined`). Returns an unsubscribe function.
 */
export function subscribeSWR(key, listener) {
  if (!key || typeof listener !== 'function') return () => {}
  let set = subscribers.get(key)
  if (!set) {
    set = new Set()
    subscribers.set(key, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) subscribers.delete(key)
  }
}

/**
 * Replace the cached value and notify every mounted subscriber.
 * `updater` receives the current value (`undefined` when cold) and may
 * return `undefined` to leave a cold key untouched.
 */
export function mutateSWR(key, updater) {
  if (!key) return undefined
  const entry = store.get(key)
  const current = entry?.data
  const next = typeof updater === 'function' ? updater(current) : updater
  if (next === undefined && current === undefined) return undefined
  const ttlMs = entry?.ttlMs ?? DEFAULT_TTL_MS
  bumpSeq(key)
  commit(key, { data: next, fetchedAt: Date.now(), ttlMs })
  return next
}

/** Run `mutateSWR` on every key that starts with `prefix`. */
export function mutateSWRByPrefix(prefix, updater) {
  if (!prefix) return
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) mutateSWR(key, updater)
  }
}

/**
 * Patch a cached value without bumping `fetchedAt` (it stays as fresh
 * or stale as it was). No-ops when the key is cold.
 */
export function updateSWR(key, updater) {
  const entry = store.get(key)
  if (!entry || entry.data === undefined) return undefined
  const next = updater(entry.data)
  entry.data = next
  touch(key)
  notify(key, next)
  return next
}

/** Keep the value, but make the next read revalidate. */
export function markSWRStale(key) {
  const entry = store.get(key)
  if (!entry || entry.data === undefined) return
  entry.fetchedAt = 0
  entry.promise = undefined
  bumpSeq(key)
}

export function markSWRStaleByPrefix(prefix) {
  if (!prefix) return
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) markSWRStale(key)
  }
}

export function markAllSWRStale() {
  for (const key of store.keys()) {
    if (key.startsWith('discover:deck:')) continue
    markSWRStale(key)
  }
}

/**
 * Explicit single-key invalidation. The value is kept so a screen can
 * still paint it; the next `getSWR` revalidates. Use `clearSWRCache`
 * to actually drop entries.
 */
export function invalidateSWR(key) {
  markSWRStale(key)
}

export function invalidateSWRPrefix(prefix) {
  markSWRStaleByPrefix(prefix)
}

/** Drop everything. Sign-out, account switch, account deletion. */
export function clearSWRCache() {
  epoch += 1
  const keys = [...store.keys()]
  store.clear()
  requestSeq.clear()
  inFlight.clear()
  for (const key of keys) notify(key, undefined)
}

/**
 * IGDB catalog keys. Nothing a library write does can change them.
 * `game:social:` is NOT immune — it is viewer-generated — so it is
 * excluded before the `game:` prefix matches.
 */
function isWriteImmune(key) {
  if (key.startsWith('game:social:')) return false
  if (key.startsWith('game:')) return true
  if (key.startsWith('search:browse-categories')) return true
  if (key.startsWith('explore:new-releases')) return true
  // Live swipe queue. A library write (including swipe-right itself) must
  // not mark it stale — the next read would rebuild the deck and change
  // the card the user is on.
  if (key.startsWith('discover:deck:')) return true
  return false
}

/**
 * Keys a `libraryUpdated` write can make wrong. Marked stale, not
 * deleted. Everything else (messages, comments, follow counts, handle
 * resolution, IGDB catalog) is left fresh — those writes go through
 * `mutateSWR` on their own key.
 *
 *   library:lists:     lists + save counts
 *   list:              list detail
 *   home:feed:         pulse
 *   home:progress:     streak / goal / rivalry
 *   on-this-day:       diary
 *   taste-vector:      taste DNA
 *   profile:badges:    badges
 *   profile:<userId>   profile bundle
 *   explore:*          except explore:new-releases
 *   game:social:       reviews, ratings, circle pulse, followed ratings
 *
 * Not stale on libraryUpdated:
 *   game:<igdbId>             IGDB metadata
 *   search:browse-categories
 *   explore:new-releases
 *   discover:deck:            in-progress swipe queue
 *   messages:inbox:
 *   comments:
 *   profile:follows:
 *   profile:handle:
 */
function isLibraryDependent(key) {
  if (isWriteImmune(key)) return false
  if (key.startsWith('messages:')) return false
  if (key.startsWith('comments:')) return false
  if (key.startsWith('profile:follows:')) return false
  if (key.startsWith('profile:handle:')) return false
  return true
}

export function invalidateAfterWrite() {
  for (const key of store.keys()) {
    if (isLibraryDependent(key)) markSWRStale(key)
  }
}

/**
 * Share one in-flight promise between concurrent callers. Not a cache:
 * the entry is dropped when the promise settles.
 */
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
  window.addEventListener('app:resumed', markAllSWRStale)
  window.addEventListener('libraryUpdated', invalidateAfterWrite)
}

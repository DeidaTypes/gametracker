import { supabase } from './supabase'

/**
 * Session cache for app_flags.
 *
 * `flag_enabled` is the only read. The allow-list column is not
 * client-readable, so this never selects from app_flags. A failure
 * (missing function, RLS, bad payload) resolves false and sticks for
 * the session. A network failure resolves false and is not cached, so
 * the next call tries again. App resume and sign-out drop the cache.
 */

const RESUME_EVENT = 'app:resumed'
const CLEARED_EVENT = 'gt:user-data-cleared'

/** @type {Map<string, boolean>} */
const cache = new Map()
/** @type {Map<string, Promise<boolean>>} */
const inflight = new Map()
/** @type {Set<() => void>} */
const listeners = new Set()

let generation = 0

function isOffline(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const msg = `${error?.message || ''} ${error?.details || ''}`
  return /failed to fetch|network|load failed|offline|timeout/i.test(msg)
}

function notify() {
  for (const fn of listeners) {
    try {
      fn()
    } catch (err) {
      console.error('[flagService] subscriber failed:', err)
    }
  }
}

function drop() {
  generation += 1
  cache.clear()
  inflight.clear()
  notify()
}

async function fetchFlag(key, gen) {
  try {
    const { data, error } = await supabase.rpc('flag_enabled', { p_key: key })
    if (gen !== generation) return cache.get(key) === true
    if (error) {
      if (isOffline(error)) return false
      cache.set(key, false)
      return false
    }
    const on = data === true
    cache.set(key, on)
    return on
  } catch (err) {
    if (gen !== generation) return cache.get(key) === true
    if (isOffline(err)) return false
    cache.set(key, false)
    return false
  }
}

/**
 * Whether `key` is enabled for the current user (global flag or allow list).
 * Default false.
 *
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export function isFlagEnabled(key) {
  if (!key) return Promise.resolve(false)
  if (cache.has(key)) return Promise.resolve(cache.get(key) === true)
  const existing = inflight.get(key)
  if (existing) return existing
  const gen = generation
  const pending = fetchFlag(key, gen).finally(() => {
    if (inflight.get(key) === pending) inflight.delete(key)
  })
  inflight.set(key, pending)
  return pending
}

/** Synchronous session read. False when this key has not resolved yet. */
export function peekFlagEnabled(key) {
  return cache.get(key) === true
}

/** Fired when the session cache is dropped (resume or sign-out). */
export function subscribeFlags(listener) {
  if (typeof listener !== 'function') return () => {}
  listeners.add(listener)
  return () => listeners.delete(listener)
}

if (typeof window !== 'undefined') {
  window.addEventListener(RESUME_EVENT, drop)
  window.addEventListener(CLEARED_EVENT, drop)
}

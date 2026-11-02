import { supabase } from './supabase'
import { APP_RESUMED_EVENT } from './resumeSequence'
import { isLongAbsence } from '../hooks/useAppResume'

/**
 * In-process levels for avatar rings. One users?select=id,level per ~40ms
 * window, shared by every mounted avatar. Unknown ids fail soft: no row
 * means no ring, and a failed request is not cached so a later refresh
 * can try again.
 *
 * Levels are public (users.level is granted to anon and authenticated),
 * so the map is keyed by user id and survives an account switch.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CHUNK = 150
const FLUSH_MS = 40

/** @type {Map<string, number|null>} */
const cache = new Map()
/** @type {Map<string, Set<(level: number|null) => void>>} */
const subscribers = new Map()
const queued = new Set()
const refreshing = new Set()
/** @type {Map<string, number>} */
const epochs = new Map()

let timer = null

export function normalizeUserId(id) {
  if (id == null || id === '') return null
  const value = String(id).trim()
  return UUID_RE.test(value) ? value : null
}

/** Cached level, or null when it has not loaded or the user has no row. */
export function getCachedUserLevel(id) {
  const clean = normalizeUserId(id)
  if (!clean || !cache.has(clean)) return null
  return cache.get(clean)
}

function publish(id, level) {
  cache.set(id, level)
  const subs = subscribers.get(id)
  if (subs) subs.forEach((cb) => cb(level))
}

export function subscribeUserLevel(id, cb) {
  const clean = normalizeUserId(id)
  if (!clean) return () => {}
  let subs = subscribers.get(clean)
  if (!subs) {
    subs = new Set()
    subscribers.set(clean, subs)
  }
  subs.add(cb)
  return () => {
    const current = subscribers.get(clean)
    if (!current) return
    current.delete(cb)
    if (current.size === 0) subscribers.delete(clean)
  }
}

function schedule() {
  if (timer != null) return
  timer = setTimeout(flush, FLUSH_MS)
}

/**
 * Queue one id or a list. Ids already cached or already queued are skipped.
 * @param {string|string[]|null|undefined} idOrIds
 */
export function requestUserLevel(idOrIds) {
  const list = Array.isArray(idOrIds) ? idOrIds : [idOrIds]
  let added = false
  for (const raw of list) {
    const id = normalizeUserId(raw)
    if (!id || cache.has(id) || queued.has(id)) continue
    queued.add(id)
    added = true
  }
  if (added) schedule()
}

/** Force a fresh read. Keeps the current ring until the new value arrives. */
export function refreshUserLevel(id) {
  const clean = normalizeUserId(id)
  if (!clean) return
  refreshing.add(clean)
  queued.add(clean)
  schedule()
}

async function fetchChunk(ids, genAtStart) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, level')
      .in('id', ids)
    if (error) {
      console.error('[levelCache] users level lookup failed:', error.message)
      return
    }
    const found = new Set()
    for (const row of data || []) {
      if (!row?.id || epochs.get(row.id) !== genAtStart.get(row.id)) continue
      found.add(row.id)
      const n = Number(row.level)
      publish(row.id, Number.isFinite(n) && n >= 1 ? n : 1)
    }
    for (const id of ids) {
      if (found.has(id)) continue
      if (epochs.get(id) !== genAtStart.get(id)) continue
      publish(id, null)
    }
  } catch (err) {
    console.error('[levelCache] users level lookup crashed:', err?.message || err)
  }
}

async function flush() {
  timer = null
  const ids = [...queued]
  queued.clear()
  const force = new Set(refreshing)
  refreshing.clear()
  const todo = ids.filter((id) => force.has(id) || !cache.has(id))
  if (!todo.length) return

  const genAtStart = new Map()
  for (const id of todo) {
    const next = (epochs.get(id) || 0) + 1
    epochs.set(id, next)
    genAtStart.set(id, next)
  }

  for (let i = 0; i < todo.length; i += CHUNK) {
    await fetchChunk(todo.slice(i, i + CHUNK), genAtStart)
  }
}

async function refreshOwnLevel() {
  try {
    const { data: { user } = {}, error } = await supabase.auth.getUser()
    if (error || !user?.id) return
    refreshUserLevel(user.id)
  } catch {
    /* soft-fail — the ring keeps its last color */
  }
}

function refreshSubscribed() {
  subscribers.forEach((_subs, id) => refreshUserLevel(id))
}

if (typeof window !== 'undefined') {
  window.addEventListener(APP_RESUMED_EVENT, (event) => {
    if (!isLongAbsence(event)) return
    refreshSubscribed()
  })
  window.addEventListener('badgesUpdated', refreshOwnLevel)
  window.addEventListener('xpUpdated', refreshOwnLevel)
}

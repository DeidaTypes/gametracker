import React from 'react'

/**
 * Per-tab recent searches store, persisted to localStorage under
 * 'gt:recents:v1'. Capped at 8 items per tab. Adding a duplicate (same id
 * or — for the reviews tab — same query string) bumps it to the top
 * instead of duplicating.
 *
 * Sprint 5 owns this. Sprint 6 will swap the underlying transport (e.g.
 * server-side recents synced across devices) without changing the public
 * API, so callers should treat these four functions as the contract.
 */

const STORAGE_KEY = 'gt:recents:v1'
const TAB_LIMIT = 8
const VALID_TABS = ['games', 'devs', 'reviews', 'users', 'lists']
const CHANGE_EVENT = 'gt:recents-changed'

const EMPTY_STATE = Object.freeze({
  games: [],
  devs: [],
  reviews: [],
  users: [],
  lists: [],
})

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY_STATE }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY_STATE }
    // Defensive coalesce — if a previously-stored shape is missing tabs
    // (e.g. older bundle), fill them in so callers always get an array.
    return {
      games: Array.isArray(parsed.games) ? parsed.games : [],
      devs: Array.isArray(parsed.devs) ? parsed.devs : [],
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
      users: Array.isArray(parsed.users) ? parsed.users : [],
      lists: Array.isArray(parsed.lists) ? parsed.lists : [],
    }
  } catch {
    return { ...EMPTY_STATE }
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Quota exceeded or storage disabled — fail silently. Recents are a
    // convenience, not a correctness feature.
  }
  try {
    window.dispatchEvent(
      new CustomEvent(CHANGE_EVENT, { detail: { store } })
    )
  } catch {
    // SSR / no-window — ignore.
  }
}

function isValidTab(tab) {
  return VALID_TABS.includes(tab)
}

/** Stable key used for duplicate detection on a recent item. */
function keyFor(item) {
  if (item == null) return ''
  if (item.id != null) return `id:${item.id}`
  if (typeof item.query === 'string' && item.query) return `q:${item.query.toLowerCase()}`
  return ''
}

export function getRecents(tab) {
  if (!isValidTab(tab)) return []
  return readStore()[tab]
}

export function addRecent(tab, item) {
  if (!isValidTab(tab) || !item) return
  const store = readStore()
  const targetKey = keyFor(item)
  if (!targetKey) return // can't dedupe an item without an id or query

  const filtered = store[tab].filter((existing) => keyFor(existing) !== targetKey)
  const next = [item, ...filtered].slice(0, TAB_LIMIT)
  writeStore({ ...store, [tab]: next })
}

/**
 * Remove a single recent item from the given tab. The `key` may be either
 * the item's `id` OR (for reviews) its `query` string.
 */
export function removeRecent(tab, key) {
  if (!isValidTab(tab) || key == null) return
  const store = readStore()
  const targetIdKey = `id:${key}`
  const targetQueryKey = `q:${String(key).toLowerCase()}`
  const next = store[tab].filter((existing) => {
    const k = keyFor(existing)
    return k !== targetIdKey && k !== targetQueryKey
  })
  writeStore({ ...store, [tab]: next })
}

export function clearRecents(tab) {
  if (!isValidTab(tab)) return
  const store = readStore()
  writeStore({ ...store, [tab]: [] })
}

/**
 * React hook that returns the current recents for a tab and stays in
 * sync across all callers (including this tab — toggles in one component
 * propagate to siblings via the same window event the writer dispatches).
 */
export function useRecents(tab) {
  const [items, setItems] = React.useState(() => getRecents(tab))

  React.useEffect(() => {
    setItems(getRecents(tab))
    const handler = () => setItems(getRecents(tab))
    window.addEventListener(CHANGE_EVENT, handler)
    // Pick up writes from other tabs/windows too.
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler)
      window.removeEventListener('storage', handler)
    }
  }, [tab])

  return items
}

export const RECENTS_STORAGE_KEY = STORAGE_KEY
export const RECENTS_TAB_LIMIT = TAB_LIMIT

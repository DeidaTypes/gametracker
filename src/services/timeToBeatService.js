// Time-to-beat service — fetches IGDB `game_time_to_beats` data via the proxy.
//
// IGDB game_time_to_beats fields (all in SECONDS, all nullable):
//   hastily    — rush playthrough (main story only, minimal extras)
//   normally   — balanced playthrough (some side quests, not completionist)
//   completely — 100% completion
//   count      — number of submissions backing these averages
//   game_id    — IGDB game ID FK
//
// NOTE: the igdb-proxy edge function must be redeployed after adding
// 'game_time_to_beats' to ALLOWED_ENDPOINTS. Run:
//   supabase functions deploy igdb-proxy
// or deploy from the Supabase dashboard.

import { igdbRequest } from './igdb'

// ── Dual-layer cache: in-memory (fast) + localStorage (survives reload) ─────

// v2: invalidates caches that may have stored null when game_time_to_beats
// was not yet allowed by the igdb-proxy Edge Function.
const LS_KEY = 'gt:ttb:v2'
const MEM_TTL_MS = 5 * 60 * 1000 // 5 minutes
const LS_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours — IGDB TTB data rarely changes

/** @type {Map<number, { data: object|null, expiresAt: number }>} */
const memCache = new Map()

/** @type {Map<number, Promise<object|null>>} */
const inflight = new Map()

function readLsCache() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function writeLsCache(store) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store))
  } catch {
    // Quota exceeded — continue without caching.
  }
}

function lsGet(igdbGameId) {
  const store = readLsCache()
  const entry = store[igdbGameId]
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) return undefined
  return entry.data // may be null (confirmed no-entry)
}

function lsSet(igdbGameId, data) {
  const store = readLsCache()
  store[igdbGameId] = { data, expiresAt: Date.now() + LS_TTL_MS }
  writeLsCache(store)
}

// ── Core fetch ────────────────────────────────────────────────────────────────

async function fetchFromIgdb(igdbGameId) {
  const query = `fields hastily, normally, completely, count;
where game_id = ${igdbGameId};
limit 1;`

  const rows = await igdbRequest('game_time_to_beats', query)

  if (!Array.isArray(rows) || rows.length === 0) {
    return null
  }

  const row = rows[0]
  return {
    hastilySeconds: typeof row.hastily === 'number' ? row.hastily : null,
    normallySeconds: typeof row.normally === 'number' ? row.normally : null,
    completelySeconds: typeof row.completely === 'number' ? row.completely : null,
    count: typeof row.count === 'number' ? row.count : 0,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch time-to-beat data for an IGDB game ID.
 *
 * Returns { hastilySeconds, normallySeconds, completelySeconds, count } or
 * null when IGDB has no entry for the game. Never fabricates times.
 *
 * Results are cached in memory (5 min) and localStorage (24 h) so
 * game detail, Home, and Library never re-fetch the same game.
 *
 * @param {number|string} igdbGameId
 * @returns {Promise<{hastilySeconds:number|null, normallySeconds:number|null, completelySeconds:number|null, count:number}|null>}
 */
export async function getTimeToBeat(igdbGameId) {
  const id = Number(igdbGameId)
  if (!id) return null

  // 1. Memory cache
  const memEntry = memCache.get(id)
  if (memEntry && Date.now() < memEntry.expiresAt) {
    return memEntry.data
  }

  // 2. localStorage cache
  const lsData = lsGet(id)
  if (lsData !== undefined) {
    memCache.set(id, { data: lsData, expiresAt: Date.now() + MEM_TTL_MS })
    return lsData
  }

  // 3. Deduplicate concurrent fetches for the same game
  if (inflight.has(id)) {
    return inflight.get(id)
  }

  const promise = fetchFromIgdb(id)
    .then((data) => {
      if (data === null && import.meta.env.DEV) {
        console.warn(`[timeToBeat] no IGDB entry for game ${id} (null result)`)
      }
      memCache.set(id, { data, expiresAt: Date.now() + MEM_TTL_MS })
      lsSet(id, data)
      return data
    })
    .catch((err) => {
      console.error(`[timeToBeat] fetch failed for game ${id}:`, err.message ?? err)
      return null
    })
    .finally(() => {
      inflight.delete(id)
    })

  inflight.set(id, promise)
  return promise
}

/**
 * Evict a single game from both caches (e.g. after a forced refresh).
 * @param {number|string} igdbGameId
 */
export function evictTimeToBeat(igdbGameId) {
  const id = Number(igdbGameId)
  memCache.delete(id)
  const store = readLsCache()
  delete store[id]
  writeLsCache(store)
}

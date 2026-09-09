// Rate-from-memory service — candidate selection + permanent exclusion for
// the onboarding "Five from your past" step.
//
// !! SCOPE GUARANTEE !!
// Nothing in this file writes to `game_trackers`, `activities`
// (status_changed), or `activity_events` (completed). The only writes are:
//   1. `postReview()` (src/services/reviewService.js) — called by the
//      onboarding screen itself, not from here. This file never calls it.
//   2. The permanent exclusion store below, which is a plain localStorage
//      set with no server mirror and no taste-signal side effect.
//
// Candidate selection is deliberately simple — one batched IGDB query
// (never one request per card), gated by a popularity/rating-count floor
// for recognizability. No ML, no new engine — this reuses `igdbRequest`
// from services/igdb.js exactly like every other IGDB caller in the app.
//
// NOTE on `category`: an earlier version of this query added
// `category = 0` (IGDB's documented "main_game" flag) to keep DLC/editions
// out. Verified live against this app's actual IGDB proxy
// (VITE_IGDB_PROXY_URL) that `category` comes back unpopulated for every
// row in this dataset — `fields name, category; where id = 1020;` (Grand
// Theft Auto V) returns `{"id":1020,"name":"..."}` with no `category` key
// at all, and `category != null` against the whole popular-games set
// returns zero rows. Filtering on it silently zeroed every result,
// including "no platform/era selected" (which must never come back empty —
// see spec). Removed rather than worked around; the existing
// popularity/rating-count floor already does most of the "recognizable
// base game" work this app's other IGDB callers rely on (see
// getDiscoveryDeck in igdb.js, which does not filter on category either).

import { igdbRequest, coverUrlFromImageId } from './igdb'

// ── Platform chips ──────────────────────────────────────────────────────
//
// Grouped at the brand level (not per-console) so the chip row stays short
// and recognizable. IGDB platform IDs verified against the IGDB v4
// `platforms` endpoint (api-docs.igdb.com) — each id below is a real,
// numbered platform, not a guess.
export const PLATFORM_CHIPS = Object.freeze([
  { id: 'playstation', label: 'PlayStation', igdbIds: [7, 8, 9, 48, 167] },
  { id: 'xbox', label: 'Xbox', igdbIds: [11, 12, 49, 169] },
  {
    id: 'nintendo',
    label: 'Nintendo',
    igdbIds: [4, 5, 18, 19, 20, 21, 22, 24, 33, 37, 41, 130],
  },
  { id: 'pc', label: 'PC', igdbIds: [6] },
  { id: 'mobile', label: 'Mobile', igdbIds: [34, 39] },
])

// ── Era chips ────────────────────────────────────────────────────────────
//
// Decade windows. `endYear: null` means "through today" — resolved lazily
// so a cached module doesn't bake in a stale "now".
export const ERA_CHIPS = Object.freeze([
  { id: '80s', label: '80s', startYear: 1980, endYear: 1990 },
  { id: '90s', label: '90s', startYear: 1990, endYear: 2000 },
  { id: '2000s', label: '2000s', startYear: 2000, endYear: 2010 },
  { id: '2010s', label: '2010s', startYear: 2010, endYear: 2020 },
  { id: '2020s', label: '2020s', startYear: 2020, endYear: null },
])

function yearToUnix(year) {
  return Math.floor(Date.UTC(year, 0, 1) / 1000)
}

function flattenPlatformIds(platformChipIds) {
  const ids = new Set()
  for (const chipId of platformChipIds || []) {
    const chip = PLATFORM_CHIPS.find((p) => p.id === chipId)
    if (!chip) continue
    for (const id of chip.igdbIds) ids.add(id)
  }
  return [...ids]
}

function buildEraWindows(eraChipIds) {
  const now = Math.floor(Date.now() / 1000)
  const windows = []
  for (const chipId of eraChipIds || []) {
    const chip = ERA_CHIPS.find((e) => e.id === chipId)
    if (!chip) continue
    windows.push({
      start: yearToUnix(chip.startYear),
      end: chip.endYear == null ? now : yearToUnix(chip.endYear),
    })
  }
  return windows
}

// Popularity/rating-count floor — keeps candidates "recognizable" per the
// spec rather than obscure long-tail titles. Deliberately higher than the
// Discover deck's floor of 10 (src/services/igdb.js DISCOVERY_ERAS usage):
// that deck wants variety, this step wants games the user is likely to
// actually remember playing.
const POPULARITY_FLOOR = 100

const CANDIDATE_FIELDS =
  'fields name, cover.image_id, first_release_date, rating_count, ' +
  'involved_companies.company.name, involved_companies.developer;'

function buildWhereClause({ platformIgdbIds, eraWindows }) {
  const clauses = ['cover != null', 'rating_count != null', `rating_count >= ${POPULARITY_FLOOR}`]
  if (platformIgdbIds && platformIgdbIds.length > 0) {
    clauses.push(`platforms = (${platformIgdbIds.join(',')})`)
  }
  if (eraWindows && eraWindows.length > 0) {
    const windowClauses = eraWindows.map(
      (w) => `(first_release_date >= ${w.start} & first_release_date < ${w.end})`
    )
    clauses.push(`(${windowClauses.join(' | ')})`)
  }
  return clauses.join(' & ')
}

function formatCandidate(game) {
  const developer =
    game.involved_companies?.find((c) => c.developer)?.company?.name ||
    game.involved_companies?.[0]?.company?.name ||
    'Unknown'
  return {
    id: game.id,
    title: game.name,
    year: game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : null,
    developer,
    image: coverUrlFromImageId(game.cover?.image_id),
  }
}

function shuffle(arr) {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Fetch a candidate pool for the "Five from your past" step and return up
 * to `limit` formatted cards, ready to render (no further IGDB calls
 * needed per-card).
 *
 * Fires exactly ONE `games` request in the common case (including the "no
 * platform/era selected" skip path, which resolves to a plain popularity
 * query — broadly popular games across eras, per spec). If that returns
 * zero rows — an overly narrow platform+era combo — up to TWO more
 * fallback requests progressively relax the filters (drop era, then drop
 * platform too), each still one batched request, never per-card. Each
 * tier only runs if the previous one came back empty, so the 1-request
 * case is by far the common one.
 *
 * @param {Object} opts
 * @param {string[]} opts.platformChipIds - PLATFORM_CHIPS ids the user picked
 * @param {string[]} opts.eraChipIds - ERA_CHIPS ids the user picked
 * @param {Set<string>} opts.excludeIds - igdb ids to exclude (already
 *   rated + already tracked + permanently excluded), as strings
 * @param {number} [opts.limit=5]
 * @param {number} [opts.poolSize=24] - candidates requested before exclude
 *   filtering; kept generous so filtering rarely starves the final 5
 * @returns {Promise<Array<{id:number, title:string, year:number|null, developer:string, image:string|null}>>}
 */
export async function fetchRateFromMemoryCandidates({
  platformChipIds = [],
  eraChipIds = [],
  excludeIds = new Set(),
  limit = 5,
  poolSize = 24,
} = {}) {
  const platformIgdbIds = flattenPlatformIds(platformChipIds)
  const eraWindows = buildEraWindows(eraChipIds)

  const runQuery = async (ids, windows) => {
    const where = buildWhereClause({ platformIgdbIds: ids, eraWindows: windows })
    const query = `${CANDIDATE_FIELDS}\nwhere ${where};\nsort rating_count desc;\nlimit ${poolSize};`
    try {
      const games = await igdbRequest('games', query)
      return Array.isArray(games) ? games : []
    } catch (err) {
      console.warn('[rateFromMemory] candidate query failed:', err)
      return []
    }
  }

  let games = await runQuery(platformIgdbIds, eraWindows)

  // Tier 2: drop era, keep platform + popularity floor.
  if (games.length === 0 && eraWindows.length > 0) {
    games = await runQuery(platformIgdbIds, [])
  }

  // Tier 3: drop platform too — plain popularity query. Only reachable if
  // a platform filter was actually applied and still came back empty.
  if (games.length === 0 && platformIgdbIds.length > 0) {
    games = await runQuery([], [])
  }

  const filtered = games.filter(
    (g) => g?.id && g?.name && g?.cover?.image_id && !excludeIds.has(String(g.id))
  )

  return shuffle(filtered.map(formatCandidate)).slice(0, limit)
}

// ── Permanent "Never played" exclusion ──────────────────────────────────
//
// The smallest mechanism that works: a plain localStorage set of igdb game
// ids, permanent (no TTL, unlike swipeService's not_interested), and with
// NO taste-signal side effect — "I never played this" is not "I dislike
// this genre", so it must not feed getTasteSignal()/dislikedGenres the way
// swipeService.SWIPE_ACTIONS.NOT_INTERESTED does. Deliberately not mirrored
// to a Supabase table: it only needs to suppress a card from resurfacing in
// this one onboarding flow, on this device, forever. If a future need
// arises for cross-device persistence, promote this to a table then.
const NEVER_PLAYED_KEY = 'gt:rate-from-memory-never-played:v1'

function readNeverPlayed() {
  try {
    const raw = localStorage.getItem(NEVER_PLAYED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/** Set of igdb game ids (strings) permanently marked "never played". */
export function getNeverPlayedExclusions() {
  return new Set(readNeverPlayed())
}

/** Permanently exclude one game from ever resurfacing in this flow. */
export function excludeGameAsNeverPlayed(gameId) {
  if (gameId == null) return
  const ids = new Set(readNeverPlayed())
  ids.add(String(gameId))
  try {
    localStorage.setItem(NEVER_PLAYED_KEY, JSON.stringify([...ids]))
  } catch {
    // storage full — non-fatal, the card just may resurface later
  }
}

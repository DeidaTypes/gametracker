/**
 * Community Mock Service
 *
 * The app is currently single-user (all stores live in localStorage with no
 * concept of a `userId`). The Explore "what's happening" feed needs cross-
 * user activity — trending logs, recently-finished games, recent reviews from
 * other people. Until a real backend lands, this service synthesizes a
 * believable community: ~30 fake users, fake logs (status changes) and fake
 * reviews on real IGDB games.
 *
 * Determinism:
 *   The seed changes once per day so the feed feels stable across reloads
 *   within a session, but evolves day-to-day. The local user's real reviews
 *   and real logs are layered in on top so they show up in the feed as well.
 *
 * Caching:
 *   - Seeded data is persisted to localStorage so reloads don't burn IGDB
 *     budget. Cache invalidates when the daily seed changes or the IGDB pool
 *     is missing.
 *   - In-memory single-flight promise prevents the four hooks from each
 *     issuing a duplicate fetch on the same render.
 *
 * Replace this entire module with real backend calls once multi-user data
 * exists. The four `getX()` functions are the public API the UI consumes.
 */

import { getPopularGames, getRecentlyReleasedGames } from './igdb'
import { getAllReviews } from './reviewService'
import { getLibrary } from './libraryService'

// ─── Config ───────────────────────────────────────────────────────────────────

const SEED_VERSION = 1
const STORAGE_KEY = `communityMockSeed_v${SEED_VERSION}`
const POOL_SIZE = 60
const FAKE_USER_COUNT = 30
const TARGET_LOGS = 240   // total fake logs over last 7 days
const TARGET_REVIEWS = 60 // total fake reviews over last 7 days

const DAY_MS = 86400000
const WEEK_MS = 7 * DAY_MS

const STATUSES = ['want', 'currently', 'played']
// Status weighting tilts toward "played" so "Just finished" has fresh data.
const STATUS_WEIGHTS = [0.30, 0.30, 0.40]

// ─── Deterministic PRNG ───────────────────────────────────────────────────────

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)]
}

function pickWeighted(rng, items, weights) {
  const r = rng()
  let acc = 0
  for (let i = 0; i < items.length; i++) {
    acc += weights[i]
    if (r < acc) return items[i]
  }
  return items[items.length - 1]
}

// ─── Fake user roster ─────────────────────────────────────────────────────────

const HANDLES = [
  'pixelpilgrim', 'controllercaster', 'lorehound', 'questdrifter', 'midboss',
  'savestate_sam', 'dpadhero', 'frame_perfect', 'critpath', 'patchnotes',
  'rngenesis', 'startbutton', 'softlocked', 'newgameplus', 'achievementhunter',
  'speedrunscarlet', 'modder_max', 'lvl99kira', 'co_op_kel', 'completionist_co',
  'permadeath_p', 'rogue_rin', 'tankclassterry', 'healerhana', 'sniperscout',
  'partywipe', 'pacifistruner', 'lorelore', 'soundtrackshu', 'photomodepete',
]

const AVATAR_COLORS = [
  '#c4634e', '#8d5a3a', '#5a7c8d', '#7a8d5a', '#5a8d7c',
  '#8d5a7c', '#5a5a8d', '#8d7c5a', '#7c5a8d', '#5a8d5a',
]

function buildUserRoster(rng) {
  const used = new Set()
  return Array.from({ length: FAKE_USER_COUNT }, (_, i) => {
    const base = HANDLES[i % HANDLES.length]
    let handle = base
    let suffix = 0
    while (used.has(handle)) {
      suffix++
      handle = `${base}${suffix}`
    }
    used.add(handle)
    return {
      id: `mock-user-${i + 1}`,
      username: handle,
      avatarColor: pick(rng, AVATAR_COLORS),
    }
  })
}

// ─── Review snippet pool ──────────────────────────────────────────────────────

const REVIEW_SNIPPETS = [
  'Hands-down one of the best things I\'ve played this year. The pacing finally clicks once you get past the opening hours and from there it just doesn\'t let up.',
  'Genuinely surprised by how much this stuck with me. Combat felt rough at first but the systems open up beautifully and the world is dense in the best way.',
  'Fantastic art direction, killer soundtrack, and a story that earns its emotional beats. A few rough patches in the late game but I\'m still thinking about the ending.',
  'Pretty good but not as life-changing as everyone said. Solid mechanics, decent writing, world feels lived-in. Would recommend if it\'s on sale.',
  'Mixed feelings. The opening is incredible and the core loop is satisfying, but the back half drags. Still, the highs are very high.',
  'Exactly what I needed right now. Cozy, generous with its mechanics, never wastes your time. The kind of game that respects the player.',
  'Absolutely chefs-kiss design. Every system feeds into another and you constantly feel like you\'re getting better, not just leveling up. Replayable as hell.',
  'I went in skeptical and came out a believer. Tight, focused, knows exactly what it wants to be. No bloat, no padding, just craft.',
  'Beautiful but flawed. Performance is rough on launch hardware and the late-game grind almost killed it for me. Still ended up loving it overall.',
  'Imagine a game made specifically for me. Soundtrack is on loop in my head. Combat is exactly the right kind of crunchy.',
  'A masterclass in restraint. Doesn\'t hold your hand, doesn\'t pad its runtime. Just a clean, confident vision executed well.',
  'Did not expect to bounce off this so hard. Not bad, just not for me. Combat felt floaty and the world didn\'t hook me.',
  'Worth the hype. Genuinely surprised this didn\'t come up more in GOTY conversations because mechanically it\'s top tier.',
  'Slept on this for months and now I\'m mad at myself. The first three hours felt slow but once it opens up it doesn\'t let go.',
  'Comfort food. Not the deepest, not the prettiest, but I keep coming back to it after long days. Sometimes that\'s exactly what you want.',
  'Story carries this one. Mechanics are fine, gunplay is serviceable, but the writing is so above average it elevates everything.',
  'Bug-free, smooth performance, beautiful world. Devs clearly cared. Recommend to anyone on the fence.',
  'Combat finally clicked around hour 8 and I haven\'t put it down since. The build variety is genuinely deep.',
  'Loved the vibe more than the gameplay if I\'m honest. Atmosphere is unmatched, even when the moment-to-moment got repetitive.',
  'Earnest, unpretentious, full of small touches that show real craft. Not a banger but a quietly excellent one.',
]

// ─── Seed assembly ────────────────────────────────────────────────────────────

function dailySeed() {
  return Math.floor(Date.now() / DAY_MS)
}

function readCached() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.seed !== dailySeed()) return null
    if (!Array.isArray(parsed.pool) || parsed.pool.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

function writeCached(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Quota or serialization failures are non-fatal — we'll just regenerate next load.
  }
}

function dedupeById(arr) {
  const seen = new Set()
  const out = []
  for (const g of arr) {
    const key = g.id ?? g.gameId
    if (key == null || seen.has(key)) continue
    seen.add(key)
    out.push(g)
  }
  return out
}

async function fetchPool() {
  const [popular, recent] = await Promise.all([
    getPopularGames(50).catch(() => []),
    getRecentlyReleasedGames(30).catch(() => []),
  ])
  return dedupeById([...popular, ...recent])
    .filter((g) => g.image && g.title)
    .slice(0, POOL_SIZE)
}

function generateLogs(pool, users, rng) {
  if (pool.length === 0 || users.length === 0) return []
  const logs = []
  const now = Date.now()

  for (let i = 0; i < TARGET_LOGS; i++) {
    const game = pick(rng, pool)
    const user = pick(rng, users)
    const status = pickWeighted(rng, STATUSES, STATUS_WEIGHTS)
    // Skew timestamps toward recent (cube the random number) so
    // "last 24h" / "last 7 days" both have plenty of data.
    const ageRatio = Math.pow(rng(), 2.2)
    const timestamp = now - ageRatio * WEEK_MS

    logs.push({
      id: `mock-log-${i}`,
      userId: user.id,
      gameId: String(game.id),
      gameRef: { id: game.id, title: game.title, image: game.image, gameId: game.gameId },
      status,
      timestamp,
    })
  }
  return logs
}

function generateReviews(pool, users, rng) {
  if (pool.length === 0 || users.length === 0) return []
  const reviews = []
  const now = Date.now()

  for (let i = 0; i < TARGET_REVIEWS; i++) {
    const game = pick(rng, pool)
    const user = pick(rng, users)
    // Bias rating distribution toward 3.5-4.5 (people review what they liked).
    const ratingBase = 3 + rng() * 2
    const rating = Math.round(ratingBase * 2) / 2
    const text = pick(rng, REVIEW_SNIPPETS)
    const ageRatio = Math.pow(rng(), 1.6)
    const timestamp = now - ageRatio * WEEK_MS

    reviews.push({
      id: `mock-review-${i}`,
      userId: user.id,
      gameId: String(game.id),
      gameRef: { id: game.id, title: game.title, image: game.image, gameId: game.gameId },
      rating,
      text,
      date: new Date(timestamp).toISOString(),
      timestamp,
      isMock: true,
    })
  }
  return reviews
}

// ─── In-memory single-flight ──────────────────────────────────────────────────

let dataPromise = null

async function loadData() {
  if (dataPromise) return dataPromise
  dataPromise = (async () => {
    try {
      return await assembleData()
    } catch (err) {
      // Allow retry on next call if assembly fails.
      dataPromise = null
      throw err
    }
  })()
  return dataPromise
}

async function assembleData() {
  const seed = dailySeed()
  const cached = readCached()
  if (cached) return cached

  const pool = await fetchPool()
  const rng = mulberry32(seed)
  const users = buildUserRoster(rng)
  const logs = generateLogs(pool, users, rng)
  const reviews = generateReviews(pool, users, rng)

  const data = { seed, pool, users, logs, reviews, seedAt: Date.now() }
  writeCached(data)
  return data
}

// ─── Real-user data integration ───────────────────────────────────────────────

const STATUS_LIST_MAP = {
  'want-to-play': 'want',
  'currently-playing': 'currently',
  'played': 'played',
}

const REAL_USER = { id: 'real-user', username: 'you', avatarColor: '#c4634e', isReal: true }

function getRealUserLogs() {
  const library = getLibrary()
  if (!library || !library.lists) return []

  const logs = []
  for (const [listId, status] of Object.entries(STATUS_LIST_MAP)) {
    const list = library.lists[listId]
    if (!list || !Array.isArray(list.games)) continue
    for (const g of list.games) {
      if (!g.addedAt) continue
      logs.push({
        id: `real-log-${listId}-${g.id}`,
        userId: REAL_USER.id,
        gameId: String(g.id),
        gameRef: { id: g.id, title: g.title, image: g.image, gameId: g.gameId },
        status,
        timestamp: new Date(g.addedAt).getTime(),
        isReal: true,
      })
    }
  }
  return logs
}

function getRealUserReviews() {
  const reviews = getAllReviews() || []
  return reviews
    .filter((r) => r && r.gameId && r.date)
    .map((r, idx) => ({
      id: r.id || `real-review-${idx}`,
      userId: REAL_USER.id,
      gameId: String(r.gameId),
      gameRef: { id: r.gameId, title: r.gameTitle, image: r.gameImage },
      rating: parseFloat(r.rating) || 0,
      text: r.text || '',
      date: r.date,
      timestamp: new Date(r.date).getTime(),
      isReal: true,
    }))
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Top games by total log activity in the last 7 days.
 * Returns: [{ game, peopleCount, mostCommonStatus }]
 */
export async function getTrendingThisWeek(limit = 10) {
  const data = await loadData()
  const cutoff = Date.now() - WEEK_MS

  const allLogs = [...data.logs, ...getRealUserLogs()].filter((l) => l.timestamp >= cutoff)

  const byGame = new Map()
  for (const log of allLogs) {
    const gid = log.gameId
    let entry = byGame.get(gid)
    if (!entry) {
      entry = {
        gameId: gid,
        gameRef: log.gameRef,
        peopleCount: 0,
        statusCounts: { want: 0, currently: 0, played: 0 },
        users: new Set(),
      }
      byGame.set(gid, entry)
    }
    if (!entry.users.has(log.userId)) {
      entry.users.add(log.userId)
      entry.peopleCount++
    }
    entry.statusCounts[log.status] = (entry.statusCounts[log.status] || 0) + 1
  }

  return Array.from(byGame.values())
    .filter((e) => e.gameRef && e.gameRef.image)
    .sort((a, b) => b.peopleCount - a.peopleCount)
    .slice(0, limit)
    .map((e) => ({
      game: e.gameRef,
      peopleCount: e.peopleCount,
      mostCommonStatus: dominantStatus(e.statusCounts),
    }))
}

function dominantStatus(counts) {
  let best = 'played'
  let max = -1
  for (const [s, c] of Object.entries(counts)) {
    if (c > max) {
      max = c
      best = s
    }
  }
  return best
}

/**
 * Last N games marked as "Played" in the last 24 hours, with the reviewer
 * (the user who logged it) and — when available — that user's rating.
 */
export async function getJustFinished(limit = 20) {
  const data = await loadData()
  const cutoff = Date.now() - DAY_MS

  const allLogs = [...data.logs, ...getRealUserLogs()].filter(
    (l) => l.status === 'played' && l.timestamp >= cutoff
  )

  const usersById = indexBy(data.users, 'id')
  usersById.set(REAL_USER.id, REAL_USER)

  // Match user reviews on the same game (within ±48h of the log) so cards can
  // show a rating when the reviewer left one.
  const allReviews = [...data.reviews, ...getRealUserReviews()]
  const reviewIndex = new Map()
  for (const r of allReviews) {
    const k = `${r.userId}::${r.gameId}`
    const existing = reviewIndex.get(k)
    if (!existing || r.timestamp > existing.timestamp) reviewIndex.set(k, r)
  }

  return allLogs
    .filter((l) => l.gameRef && l.gameRef.image)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((l) => {
      const reviewer = usersById.get(l.userId) || REAL_USER
      const review = reviewIndex.get(`${l.userId}::${l.gameId}`)
      return {
        id: l.id,
        game: l.gameRef,
        reviewer,
        rating: review ? review.rating : null,
        timestamp: l.timestamp,
      }
    })
}

/**
 * Last N reviews posted across the community + the local user.
 * Returns reviewer + game + truncated review meta.
 */
export async function getCommunityReviews(limit = 20) {
  const data = await loadData()
  const usersById = indexBy(data.users, 'id')
  usersById.set(REAL_USER.id, REAL_USER)

  const allReviews = [...data.reviews, ...getRealUserReviews()]

  return allReviews
    .filter((r) => r.gameRef && r.gameRef.image && r.text)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      game: r.gameRef,
      reviewer: usersById.get(r.userId) || REAL_USER,
      rating: r.rating,
      text: r.text,
      date: r.date,
      timestamp: r.timestamp,
    }))
}

function indexBy(arr, key) {
  const map = new Map()
  for (const item of arr) map.set(item[key], item)
  return map
}

// ─── Test / dev helpers ───────────────────────────────────────────────────────

/** Force-refresh the seed (e.g. from a dev menu). */
export function clearCommunityMockCache() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
  dataPromise = null
}

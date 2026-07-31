// New & Notable — IGDB diagnosis + threshold tuning for the RELEASED-ONLY
// two-lane notability gate.
//
// Answers, against LIVE IGDB data (and the live cache for the "before" half):
//   1. BEFORE — what the section surfaces today: the cached pool's lane mix
//      and, critically, how much of it is NOT YET RELEASED.
//   2. BEFORE — the original date-only rail, to keep the "Room 0" / "Ludus"
//      zero-signal baseline in the same report.
//   3. Which IGDB signals actually exist: hypes, follows, total_rating,
//      total_rating_count, aggregated_rating, involved_companies,
//      first_release_date, game_status — and which are dead weight.
//   4. Signal distributions across RELEASED games in the window, so lane
//      thresholds are set against real percentiles instead of guesses.
//   5. A threshold sweep over both lanes, plus the AFTER output at the
//      chosen thresholds: named examples per lane, obscure exclusions, and
//      a hard assertion that zero unreleased games survive.
//
// Run: node scripts/diagnose-new-notable.mjs

import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const PROXY_URL = env.VITE_IGDB_PROXY_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
const SUPABASE_URL = env.VITE_SUPABASE_URL

const RATE_MAX = 4
const RATE_WINDOW_MS = 1000
let stamps = []
let reqCount = 0

async function throttle() {
  for (;;) {
    const now = Date.now()
    stamps = stamps.filter((t) => now - t < RATE_WINDOW_MS)
    if (stamps.length < RATE_MAX) { stamps.push(now); return }
    await new Promise((r) => setTimeout(r, RATE_WINDOW_MS - (now - stamps[0]) + 10))
  }
}

async function igdb(endpoint, query) {
  await throttle()
  reqCount++
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
      body: JSON.stringify({ endpoint, query }),
    })
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
      continue
    }
    const text = await res.text()
    if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${text.slice(0, 300)}`)
    return JSON.parse(text)
  }
  throw new Error(`${endpoint}: exhausted retries`)
}

const NOW = Math.floor(Date.now() / 1000)
const DAY = 86400
const LOOKBACK_DAYS = 90
const since = NOW - LOOKBACK_DAYS * DAY

// No lookahead at all: `first_release_date <= NOW` is the hard release
// constraint. Anything scheduled for the future never enters the pool.
const FIELDS =
  'id, name, first_release_date, total_rating, total_rating_count, hypes, follows, ' +
  'aggregated_rating, aggregated_rating_count, involved_companies.company.name, ' +
  'involved_companies.publisher, game_status, game_type, version_parent, cover.image_id'

const BASE_WHERE =
  `first_release_date >= ${since} & first_release_date <= ${NOW} & cover != null` +
  ` & game_type = 0 & version_parent = null`

// IGDB game_status enum (documented): 0 Released, 2 Alpha, 3 Beta,
// 4 Early Access, 5 Offline, 6 Cancelled, 7 Rumored, 8 Delisted. IGDB omits
// zero-valued fields, so an ABSENT game_status means 0 / Released.
const STATUS_NAMES = {
  0: 'Released', 2: 'Alpha', 3: 'Beta', 4: 'Early Access',
  5: 'Offline', 6: 'Cancelled', 7: 'Rumored', 8: 'Delisted',
}
const UNRELEASED_STATUSES = new Set([2, 3, 6, 7]) // alpha/beta/cancelled/rumored

function pctile(arr, p) {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

function fmtRow(g) {
  const days = Math.round((g.first_release_date - NOW) / DAY)
  const when = days === 0 ? 'today' : days > 0 ? `+${days}d` : `${days}d`
  return (
    `${(g.name || '?').slice(0, 38).padEnd(38)} rel=${when.padEnd(6)} ` +
    `rating=${String(g.total_rating == null ? '-' : g.total_rating.toFixed(1)).padStart(5)} ` +
    `count=${String(g.total_rating_count ?? 0).padStart(5)} ` +
    `hypes=${String(g.hypes ?? 0).padStart(5)} ` +
    `pub=${hasRecognizedPublisher(g) ? 'Y' : 'n'}`
  )
}

const KNOWN_PUBLISHERS = [
  'electronic arts', 'ea sports', 'ubisoft', 'activision', 'blizzard', 'bethesda',
  'zenimax', 'sony interactive', 'playstation', 'xbox game studios', 'microsoft studios',
  'nintendo', 'square enix', 'capcom', 'bandai namco', 'sega', 'take-two', 'rockstar games',
  '2k games', 'warner bros', 'cd projekt', 'epic games', 'konami', 'focus entertainment',
  'devolver digital', 'annapurna interactive', 'private division',
]
function hasRecognizedPublisher(g) {
  const names = (g.involved_companies || [])
    .filter((ic) => ic.publisher)
    .map((ic) => (ic.company?.name || '').toLowerCase())
  return names.some((n) => KNOWN_PUBLISHERS.some((k) => n.includes(k)))
}

console.log('='.repeat(104))
console.log('NEW & NOTABLE — RELEASED-ONLY, TWO-LANE DIAGNOSIS')
console.log(`Window: first_release_date in [now-${LOOKBACK_DAYS}d, now]  (NO lookahead — released games only)`)
console.log('='.repeat(104))

// ── 1. BEFORE — what the live cache serves right now ──────────────────────
// Whatever is deployed right now — three-lane with lookahead before this
// change, released-only two-lane after it. Reading the cache rather than
// hardcoding the old numbers keeps the "before" half honest on re-runs.
console.log('\n1. BEFORE — the live new_notable_pool cache (as currently deployed)')
console.log('-'.repeat(104))
let beforeRail = []
try {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/new_notable_pool?select=igdb_game_id,name,lane,release_date,total_rating,total_rating_count,hypes,rail_rank&order=release_date.desc`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
  )
  const rows = res.ok ? await res.json() : []
  const nowMs = Date.now()
  const lanes = {}
  for (const r of rows) lanes[r.lane] = (lanes[r.lane] ?? 0) + 1
  const unreleased = rows.filter((r) => r.release_date && new Date(r.release_date).getTime() > nowMs)
  beforeRail = rows.filter((r) => r.rail_rank != null).sort((a, b) => a.rail_rank - b.rail_rank)
  const railUnreleased = beforeRail.filter((r) => r.release_date && new Date(r.release_date).getTime() > nowMs)
  console.log(`   pool rows: ${rows.length}   lanes: ${JSON.stringify(lanes)}   rail: ${beforeRail.length}`)
  console.log(`   UNRELEASED rows in pool: ${unreleased.length}`)
  console.log(`   UNRELEASED rows ON THE RAIL: ${railUnreleased.length} / ${beforeRail.length}`)
  console.log('   rail as the user sees it (rail_rank order):')
  for (const r of beforeRail) {
    const future = r.release_date && new Date(r.release_date).getTime() > nowMs
    console.log(
      `     ${String(r.rail_rank).padStart(2)} ${(r.name || '?').slice(0, 36).padEnd(36)} ` +
      `${String(r.lane).padEnd(12)} ${(r.release_date || '').slice(0, 10)} ` +
      `count=${String(r.total_rating_count ?? 0).padStart(4)} hypes=${String(r.hypes ?? 0).padStart(4)}` +
      `${future ? '   <<< UNRELEASED' : ''}`,
    )
  }
} catch (err) {
  console.log(`   cache read failed: ${err.message.slice(0, 200)}`)
}

// ── 2. BEFORE — the original date-only rail ───────────────────────────────
console.log('\n2. BEFORE — original date-only rail (no notability gate at all)')
console.log('-'.repeat(104))
const dateOnly = await igdb(
  'games',
  `fields ${FIELDS}; where first_release_date >= ${NOW - 90 * DAY} & first_release_date <= ${NOW} & cover != null; sort first_release_date desc; limit 20;`,
)
for (const g of dateOnly) console.log('   ' + fmtRow(g))
const zeroSignal = dateOnly.filter((g) => (g.total_rating_count ?? 0) === 0 && (g.hypes ?? 0) === 0)
console.log(`\n   -> ${zeroSignal.length} / ${dateOnly.length} have ZERO rating_count AND ZERO hypes.`)

// ── 3. Fetch the full released window ─────────────────────────────────────
console.log('\n3. Fetching the full RELEASED window (paged)')
console.log('-'.repeat(104))
const countRes = await igdb('games/count', `where ${BASE_WHERE};`)
const total = Number(countRes?.count ?? 0)
console.log(`   games matching base where: ${total}`)

async function pageBy(sortClause, cap) {
  const pages = Math.ceil(Math.min(total, cap) / 500)
  const out = []
  for (let i = 0; i < pages; i++) {
    const rows = await igdb(
      'games',
      `fields ${FIELDS}; where ${BASE_WHERE}; sort ${sortClause}; limit 500; offset ${i * 500};`,
    )
    out.push(...rows)
    if (rows.length < 500) break
  }
  return out
}

const byCount = await pageBy('total_rating_count desc', 5000)
const byRating = await pageBy('total_rating desc', 1000)
const poolMap = new Map()
for (const g of [...byCount, ...byRating]) poolMap.set(g.id, g)
let pool = [...poolMap.values()]
console.log(`   fetched (deduped): ${pool.length}`)

const futureDated = pool.filter((g) => g.first_release_date > NOW)
console.log(`   future-dated rows returned by the released-only where: ${futureDated.length}  (must be 0)`)

const badStatus = pool.filter((g) => UNRELEASED_STATUSES.has(g.game_status))
console.log(`   past-dated but NOT actually released (alpha/beta/cancelled/rumored): ${badStatus.length}`)
for (const g of badStatus.slice(0, 6)) {
  console.log(`     ${STATUS_NAMES[g.game_status]}: ${fmtRow(g)}`)
}
pool = pool.filter((g) => !UNRELEASED_STATUSES.has(g.game_status))
console.log(`   pool after status filter: ${pool.length}`)

// ── 4. Signal availability ────────────────────────────────────────────────
console.log('\n4. Signal availability across the released window')
console.log('-'.repeat(104))
const availability = [
  ['first_release_date', (g) => g.first_release_date != null],
  ['total_rating', (g) => g.total_rating != null],
  ['total_rating_count > 0', (g) => (g.total_rating_count ?? 0) > 0],
  ['aggregated_rating', (g) => g.aggregated_rating != null],
  ['hypes > 0', (g) => (g.hypes ?? 0) > 0],
  ['follows > 0', (g) => (g.follows ?? 0) > 0],
  ['involved_companies', (g) => (g.involved_companies || []).length > 0],
  ['recognized publisher', (g) => hasRecognizedPublisher(g)],
]
for (const [label, fn] of availability) {
  const n = pool.filter(fn).length
  console.log(`   ${label.padEnd(26)} ${String(n).padStart(5)} / ${pool.length}  (${((n / pool.length) * 100).toFixed(1)}%)`)
}
const statusSpread = {}
for (const g of pool) {
  const k = STATUS_NAMES[g.game_status ?? 0] ?? `unknown(${g.game_status})`
  statusSpread[k] = (statusSpread[k] ?? 0) + 1
}
console.log(`   game_status spread: ${JSON.stringify(statusSpread)}`)

// ── 5. Distributions ─────────────────────────────────────────────────────
console.log('\n5. Signal distributions (released games)')
console.log('-'.repeat(104))
const counts = pool.map((g) => g.total_rating_count ?? 0)
console.log('   total_rating_count percentiles:')
for (const p of [0.5, 0.7, 0.8, 0.9, 0.95, 0.99]) {
  console.log(`     p${Math.round(p * 100)} -> ${pctile(counts, p)}`)
}
console.log(`   with total_rating_count = 0: ${counts.filter((c) => c === 0).length} / ${counts.length}`)
const hypesPositive = pool.map((g) => g.hypes ?? 0).filter((h) => h > 0)
console.log(`   with hypes > 0: ${hypesPositive.length}; percentiles among those:`)
for (const p of [0.5, 0.8, 0.9, 0.95]) {
  console.log(`     p${Math.round(p * 100)} -> ${pctile(hypesPositive, p)}`)
}
const indieBand = pool.filter(
  (g) => (g.total_rating_count ?? 0) >= 3 && (g.total_rating_count ?? 0) <= 60 && g.total_rating != null,
)
console.log(`\n   total_rating among games with 3-60 ratings (the indie band), n=${indieBand.length}:`)
console.log(
  '     ' + [0.5, 0.7, 0.8, 0.9].map((p) => `p${p * 100}=${pctile(indieBand.map((g) => g.total_rating), p).toFixed(0)}`).join('  '),
)

console.log('\n   Top 10 by total_rating_count (Lane A candidates):')
for (const g of [...pool].sort((a, b) => (b.total_rating_count ?? 0) - (a.total_rating_count ?? 0)).slice(0, 10)) {
  console.log('     ' + fmtRow(g))
}
console.log('\n   Top 10 by total_rating among 3-60 ratings (Lane B candidates):')
for (const g of [...indieBand].sort((a, b) => (b.total_rating ?? 0) - (a.total_rating ?? 0)).slice(0, 10)) {
  console.log('     ' + fmtRow(g))
}
const fresh = pool.filter((g) => g.first_release_date >= NOW - 21 * DAY)
console.log(`\n   Released in the last 21 days: ${fresh.length}; of those, hypes>=20: ${fresh.filter((g) => (g.hypes ?? 0) >= 20).length}`)
for (const g of [...fresh].sort((a, b) => (b.hypes ?? 0) - (a.hypes ?? 0)).slice(0, 8)) {
  console.log('     ' + fmtRow(g))
}

// ── 6. Threshold sweep ───────────────────────────────────────────────────
console.log('\n6. Two-lane threshold sweep (A = volume, B = quality)')
console.log('-'.repeat(104))
// A3 ("fresh buzz") is a SUPPORT rule, not a lane: it only applies to a game
// that is already released but too new to have accumulated ratings. Guards:
//   - count < unratedBelow  -> a game with real ratings must qualify on those
//     ratings (Lane A volume or Lane B quality), never on stale pre-release hype
//   - rating null or >= floor -> early ratings that already say "this is bad"
//     veto the buzz; hype must not carry a poorly-reviewed game
const laneA = (g, minCount, pubMinCount, freshHypes, freshDays = 21, unratedBelow = 3, ratingFloor = 70) =>
  (g.total_rating_count ?? 0) >= minCount ||
  (hasRecognizedPublisher(g) && (g.total_rating_count ?? 0) >= pubMinCount) ||
  (g.first_release_date >= NOW - freshDays * DAY &&
    (g.hypes ?? 0) >= freshHypes &&
    (g.total_rating_count ?? 0) < unratedBelow &&
    (g.total_rating == null || g.total_rating >= ratingFloor))
const laneB = (g, minRating, lo, hi) =>
  g.total_rating != null && g.total_rating >= minRating &&
  (g.total_rating_count ?? 0) >= lo && (g.total_rating_count ?? 0) <= hi

console.log('   A3 "fresh buzz" support-rule variants (released games only):')
for (const freshDays of [21, 30]) {
  for (const h of [20, 25, 40]) {
    const admits = pool.filter(
      (g) =>
        g.first_release_date >= NOW - freshDays * DAY &&
        (g.hypes ?? 0) >= h &&
        (g.total_rating_count ?? 0) < 3 &&
        (g.total_rating == null || g.total_rating >= 70),
    )
    console.log(
      `     fresh<=${freshDays}d hypes>=${h} -> ${admits.length}: ${admits.map((g) => `${g.name}(h${g.hypes},c${g.total_rating_count ?? 0},r${g.total_rating == null ? '-' : g.total_rating.toFixed(0)})`).join(', ') || '(none)'}`,
    )
  }
}
console.log('   fresh candidates vetoed by the rating floor / rating guard:')
for (const g of pool.filter(
  (g) => g.first_release_date >= NOW - 30 * DAY && (g.hypes ?? 0) >= 20 &&
    !((g.total_rating_count ?? 0) < 3 && (g.total_rating == null || g.total_rating >= 70)),
)) {
  console.log('     ' + fmtRow(g))
}
console.log()

for (const aCount of [30, 40, 60]) {
  for (const pubMin of [10, 15]) {
    for (const bRating of [78, 80, 82]) {
      for (const [lo, hi] of [[3, 60], [2, 60]]) {
        const A = pool.filter((g) => laneA(g, aCount, pubMin, 20))
        const B = pool.filter((g) => !laneA(g, aCount, pubMin, 20) && laneB(g, bRating, lo, hi))
        console.log(
          `   A(count>=${String(aCount).padStart(2)}|pub>=${String(pubMin).padStart(2)}|fresh_hypes>=20) ` +
          `B(rating>=${bRating},count ${lo}-${hi})  ->  A=${String(A.length).padStart(3)} B=${String(B.length).padStart(3)} total=${String(A.length + B.length).padStart(3)}`,
        )
      }
    }
  }
}

// ── 7. AFTER — chosen thresholds ─────────────────────────────────────────
const A_MIN = 30
const A_PUB_MIN = 10
const A_FRESH_HYPES = 25
const B_MIN_RATING = 80
const B_MIN_COUNT = 3
// No Lane B ceiling: Lane A is evaluated first, so anything with count >= A_MIN
// is already tagged 'aaa' and never reaches Lane B.
const B_MAX_COUNT = Infinity

console.log('\n7. AFTER — chosen thresholds')
console.log(`   LANE A: total_rating_count >= ${A_MIN}  OR  (recognized publisher AND count >= ${A_PUB_MIN})  OR  (released <=21d AND hypes >= ${A_FRESH_HYPES} AND count < ${B_MIN_COUNT} AND rating null-or->=70)`)
console.log(`   LANE B: total_rating >= ${B_MIN_RATING} AND count >= ${B_MIN_COUNT}`)
console.log('-'.repeat(104))
const finalA = pool.filter((g) => laneA(g, A_MIN, A_PUB_MIN, A_FRESH_HYPES))
const finalB = pool.filter((g) => !laneA(g, A_MIN, A_PUB_MIN, A_FRESH_HYPES) && laneB(g, B_MIN_RATING, B_MIN_COUNT, B_MAX_COUNT))
const qualified = [...finalA.map((g) => ({ ...g, lane: 'aaa' })), ...finalB.map((g) => ({ ...g, lane: 'indie' }))]
console.log(`   LANE A (aaa)   : ${finalA.length}`)
console.log(`   LANE B (indie) : ${finalB.length}`)
console.log(`   TOTAL qualified: ${qualified.length} / ${pool.length} released games in window`)
console.log(`   unreleased survivors: ${qualified.filter((g) => g.first_release_date > NOW).length}  (must be 0)`)

console.log('\n   Lane A, by rating count desc:')
for (const g of [...finalA].sort((a, b) => (b.total_rating_count ?? 0) - (a.total_rating_count ?? 0)).slice(0, 14)) {
  console.log('     ' + fmtRow(g))
}
console.log('\n   Lane B, by rating desc:')
for (const g of [...finalB].sort((a, b) => (b.total_rating ?? 0) - (a.total_rating ?? 0)).slice(0, 14)) {
  console.log('     ' + fmtRow(g))
}

console.log('\n   See-all order (release date desc, first 20):')
for (const g of [...qualified].sort((a, b) => b.first_release_date - a.first_release_date).slice(0, 20)) {
  console.log(`     ${g.lane.padEnd(6)} ${fmtRow(g)}`)
}

// ── 8. Named exclusion checks ────────────────────────────────────────────
console.log('\n8. Obscure titles — do they clear either lane?')
console.log('-'.repeat(104))
for (const name of ['Room 0', 'Ludus']) {
  const rows = await igdb('games', `fields ${FIELDS}; search "${name}"; where cover != null; limit 3;`)
  for (const g of rows.slice(0, 2)) {
    const a = laneA(g, A_MIN, A_PUB_MIN, A_FRESH_HYPES)
    const b = laneB(g, B_MIN_RATING, B_MIN_COUNT, B_MAX_COUNT)
    console.log(`   ${fmtRow(g)}  laneA=${a} laneB=${b} -> ${a || b ? 'INCLUDED' : 'EXCLUDED'}`)
  }
}

// The unreleased titles that headline the rail today must all be gone.
console.log('\n9. Previously-railed UNRELEASED titles — confirm they are now excluded')
console.log('-'.repeat(104))
const nowMs = Date.now()
for (const r of beforeRail.filter((x) => x.release_date && new Date(x.release_date).getTime() > nowMs)) {
  const inWindow = pool.some((g) => g.id === Number(r.igdb_game_id))
  const inQualified = qualified.some((g) => g.id === Number(r.igdb_game_id))
  console.log(
    `   ${(r.name || '?').slice(0, 38).padEnd(38)} releases ${(r.release_date || '').slice(0, 10)}  ` +
    `in_released_window=${inWindow}  qualified=${inQualified}`,
  )
}

// ── 10. Window sizing: how much does the see-all grid gain from 180d? ─────
console.log('\n10. Window sizing — qualified games in the 90-180d band (see-all depth)')
console.log('-'.repeat(104))
const olderWhere =
  `first_release_date >= ${NOW - 180 * DAY} & first_release_date < ${since} & cover != null` +
  ` & game_type = 0 & version_parent = null`
const olderCount = Number((await igdb('games/count', `where ${olderWhere};`))?.count ?? 0)
const olderPages = Math.ceil(Math.min(olderCount, 5000) / 500)
const older = []
for (let i = 0; i < olderPages; i++) {
  const rows = await igdb(
    'games',
    `fields ${FIELDS}; where ${olderWhere}; sort total_rating_count desc; limit 500; offset ${i * 500};`,
  )
  older.push(...rows)
  if (rows.length < 500) break
}
const olderClean = older.filter((g) => !UNRELEASED_STATUSES.has(g.game_status))
const olderA = olderClean.filter((g) => laneA(g, A_MIN, A_PUB_MIN, A_FRESH_HYPES))
const olderB = olderClean.filter((g) => !laneA(g, A_MIN, A_PUB_MIN, A_FRESH_HYPES) && laneB(g, B_MIN_RATING, B_MIN_COUNT, B_MAX_COUNT))
console.log(`   90-180d band: ${olderClean.length} released games -> A=${olderA.length} B=${olderB.length} (total ${olderA.length + olderB.length})`)
console.log(`   90d window total qualified : ${qualified.length}`)
console.log(`   180d window total qualified: ${qualified.length + olderA.length + olderB.length}`)

console.log('\n' + '-'.repeat(104))
console.log(`IGDB requests: ${reqCount}`)
console.log('='.repeat(104))

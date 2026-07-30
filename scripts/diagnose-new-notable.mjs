// New & Notable — IGDB-level diagnosis for the three-lane notability gate.
//
// Answers, against LIVE IGDB data:
//   1. What does the current date-only rail actually surface? (confirms the
//      "Room 0" / "Ludus" complaint — obscure games with zero signal)
//   2. What do total_rating, total_rating_count, and hypes actually look like
//      across the recent-release window, so lane thresholds are set against
//      real distributions instead of guesses?
//   3. Named examples per lane (AAA sequel / acclaimed indie / anticipated
//      title / obscure exclusion) with their real signal values, verified
//      against candidate threshold sets.
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
const LOOKBACK_DAYS = 150
const LOOKAHEAD_DAYS = 90
const since = NOW - LOOKBACK_DAYS * DAY
const until = NOW + LOOKAHEAD_DAYS * DAY

const FIELDS =
  'id, name, first_release_date, total_rating, total_rating_count, hypes, ' +
  'aggregated_rating, aggregated_rating_count, involved_companies.company.name, ' +
  'involved_companies.publisher, game_type, version_parent, cover.image_id'

const BASE_WHERE =
  `first_release_date >= ${since} & first_release_date <= ${until} & cover != null` +
  ` & game_type = 0 & version_parent = null`

function pctile(arr, p) {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]
}

function fmtRow(g) {
  const days = Math.round((g.first_release_date - NOW) / DAY)
  const when = days === 0 ? 'today' : days > 0 ? `+${days}d` : `${days}d`
  return (
    `${(g.name || '?').slice(0, 38).padEnd(38)} rel=${when.padEnd(6)} ` +
    `rating=${String(g.total_rating ?? '-').padStart(5)} count=${String(g.total_rating_count ?? 0).padStart(5)} ` +
    `hypes=${String(g.hypes ?? 0).padStart(5)} aggN=${String(g.aggregated_rating_count ?? 0).padStart(4)}`
  )
}

console.log('='.repeat(100))
console.log('NEW & NOTABLE — IGDB DIAGNOSIS')
console.log(`Window: first_release_date in [now-${LOOKBACK_DAYS}d, now+${LOOKAHEAD_DAYS}d]`)
console.log('='.repeat(100))

// ── 1. What does today's DATE-ONLY rail actually surface? ──────────────────
console.log('\n1. CURRENT BEHAVIOR — date-only, no notability gate (mirrors getRecentReleasesForDiscover)')
console.log('-'.repeat(100))
const dateOnlyQuery = `fields name, cover.image_id, first_release_date;
where first_release_date >= ${NOW - 90 * DAY} & first_release_date <= ${NOW} & cover != null;
sort first_release_date desc;
limit 20;`
const dateOnlyGames = await igdb('games', dateOnlyQuery)
const dateOnlyIds = dateOnlyGames.map((g) => g.id)
const dateOnlyFull = dateOnlyIds.length
  ? await igdb('games', `fields ${FIELDS}; where id = (${dateOnlyIds.join(',')}); limit ${dateOnlyIds.length};`)
  : []
const byId = new Map(dateOnlyFull.map((g) => [g.id, g]))
for (const g of dateOnlyGames) {
  const full = byId.get(g.id) || g
  console.log('   ' + fmtRow(full))
}
const zeroSignal = dateOnlyFull.filter((g) => (g.total_rating_count ?? 0) === 0 && (g.hypes ?? 0) === 0)
console.log(`\n   -> ${zeroSignal.length} / ${dateOnlyFull.length} of today's rail have ZERO rating_count AND ZERO hypes.`)
console.log(`      (${zeroSignal.map((g) => g.name).join(', ')})`)

// ── 2. Full candidate pool for the window ───────────────────────────────────
// Two sort orders, merged + deduped: total_rating_count desc alone would bury
// zero-rating-count-but-hyped upcoming titles in an arbitrary tie order and
// risk never paging to them within the offset cap.
console.log('\n2. Fetching full candidate pool in window (paged, two sort orders)...')
console.log('-'.repeat(100))
const countRes = await igdb('games/count', `where ${BASE_WHERE};`)
const total = Number(countRes?.count ?? 0)
console.log(`   Total games in window matching base where: ${total}`)

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

const byCount = await pageBy('total_rating_count desc', 3000)
const byHypes = await pageBy('hypes desc', 1000)
const poolMap = new Map()
for (const g of [...byCount, ...byHypes]) poolMap.set(g.id, g)
const pool = [...poolMap.values()]
console.log(`   Fetched (deduped): ${pool.length} games`)

const released = pool.filter((g) => g.first_release_date <= NOW)
const upcoming = pool.filter((g) => g.first_release_date > NOW)
console.log(`   Already released: ${released.length}   Upcoming: ${upcoming.length}`)

// ── 3. Distributions ─────────────────────────────────────────────────────────
console.log('\n3. Signal distributions across the window')
console.log('-'.repeat(100))
const counts = released.map((g) => g.total_rating_count ?? 0)
const hypes = pool.map((g) => g.hypes ?? 0)

console.log('   total_rating_count percentiles (RELEASED games only):')
for (const p of [0.5, 0.7, 0.8, 0.9, 0.95, 0.99]) {
  console.log(`     p${Math.round(p * 100)} -> ${pctile(counts, p)}`)
}
console.log(`   released games with total_rating_count = 0: ${counts.filter((c) => c === 0).length} / ${counts.length}`)
console.log(`   games (released+upcoming) with hypes > 0: ${hypes.filter((h) => h > 0).length} / ${hypes.length}`)
console.log('   hypes percentiles (only games with hypes > 0):')
const hypesPositive = hypes.filter((h) => h > 0)
for (const p of [0.5, 0.7, 0.8, 0.9, 0.95, 0.99]) {
  console.log(`     p${Math.round(p * 100)} -> ${pctile(hypesPositive, p)}`)
}
console.log(`   upcoming games with hypes > 0: ${upcoming.filter((g) => (g.hypes ?? 0) > 0).length} / ${upcoming.length}`)
console.log(`   released games with hypes > 0: ${released.filter((g) => (g.hypes ?? 0) > 0).length} / ${released.length}`)
console.log(`\n   total_rating distribution among RELEASED games with 3-60 ratings (the "hyped indie" band):`)
const indieBand = released.filter((g) => (g.total_rating_count ?? 0) >= 3 && (g.total_rating_count ?? 0) <= 60 && g.total_rating != null)
console.log(`     n=${indieBand.length}, ratings: ${[0.5, 0.7, 0.8, 0.9].map((p) => `p${p * 100}=${pctile(indieBand.map((g) => g.total_rating), p).toFixed(0)}`).join('  ')}`)

console.log('\n   Top 8 by total_rating_count (candidate AAA/Lane A examples):')
for (const g of [...released].sort((a, b) => (b.total_rating_count ?? 0) - (a.total_rating_count ?? 0)).slice(0, 8)) {
  console.log('     ' + fmtRow(g))
}
console.log('\n   Top 8 by hypes among count<=5 (candidate anticipated/Lane C examples):')
for (const g of [...pool].filter((g) => (g.total_rating_count ?? 0) <= 5).sort((a, b) => (b.hypes ?? 0) - (a.hypes ?? 0)).slice(0, 8)) {
  console.log('     ' + fmtRow(g))
}
console.log('\n   Top 8 by total_rating among count 3-60 (candidate acclaimed-indie/Lane B examples):')
for (const g of [...indieBand].sort((a, b) => (b.total_rating ?? 0) - (a.total_rating ?? 0)).slice(0, 8)) {
  console.log('     ' + fmtRow(g))
}

// ── 4. Named search: the reported obscure titles ────────────────────────────
console.log('\n4. Reported obscure titles — do they clear ANY lane?')
console.log('-'.repeat(100))
for (const name of ['Room 0', 'Ludus']) {
  const rows = await igdb(
    'games',
    `fields ${FIELDS}; search "${name}"; where cover != null; limit 5;`,
  )
  if (!rows.length) { console.log(`   "${name}": not found in IGDB search`); continue }
  for (const g of rows.slice(0, 2)) console.log(`   ${fmtRow(g)}`)
}

// ── 5. Candidate threshold sweep ─────────────────────────────────────────────
console.log('\n5. Candidate lane threshold sweep')
console.log('-'.repeat(100))

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

const laneSets = {
  aaa: [
    { count: 40, follows: 0 },
    { count: 60, follows: 0 },
  ],
  indieRating: [78, 80, 82],
  indieCountRange: [[3, 60], [3, 80]],
  anticipatedHypes: [15, 25, 40],
  anticipatedMaxCount: [2, 5],
}

function laneA(g, minCount) {
  const volume = (g.total_rating_count ?? 0) >= minCount
  const publisher = hasRecognizedPublisher(g) && (g.total_rating_count ?? 0) >= Math.floor(minCount / 2)
  return volume || publisher
}
function laneB(g, minRating, [lo, hi]) {
  const count = g.total_rating_count ?? 0
  return g.total_rating != null && g.total_rating >= minRating && count >= lo && count <= hi
}
function laneC(g, minHypes, maxCount) {
  return (g.hypes ?? 0) >= minHypes && (g.total_rating_count ?? 0) <= maxCount
}

for (const aCount of [40, 60]) {
  for (const bRating of [78, 80]) {
    for (const bRange of [[3, 60], [3, 80]]) {
      for (const cHypes of [15, 25]) {
        for (const cMax of [2, 5]) {
          const passA = pool.filter((g) => laneA(g, aCount))
          const passB = pool.filter((g) => !laneA(g, aCount) && laneB(g, bRating, bRange))
          const passC = pool.filter((g) => !laneA(g, aCount) && !laneB(g, bRating, bRange) && laneC(g, cHypes, cMax))
          const passAny = passA.length + passB.length + passC.length
          console.log(
            `   A(count>=${aCount}) B(rating>=${bRating},count${bRange[0]}-${bRange[1]}) C(hypes>=${cHypes},count<=${cMax})` +
            `  ->  A=${passA.length} B=${passB.length} C=${passC.length} total=${passAny}/${pool.length}`
          )
        }
      }
    }
  }
}

console.log('\n' + '-'.repeat(100))
console.log(`Total IGDB requests: ${reqCount}`)
console.log('='.repeat(100))

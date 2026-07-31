// New & Notable — acceptance check for the release gate + two-lane gate.
//
// Unlike scripts/diagnose-new-notable.mjs (which sweeps candidate thresholds
// with its own copy of the rules, for tuning), this script imports the REAL
// shipped classifier out of supabase/functions/new-notable/lanes.ts and runs
// it over a live IGDB window. If the thresholds in that file change, this
// output changes with them — there is no second copy of the logic to drift.
//
// lanes.ts and publishers.ts are plain JavaScript (their .ts extension is for
// Deno's benefit; neither carries type annotations), so they are loaded via a
// data: URL import rather than transpiled. pool.ts is NOT imported — it
// contains a TS `interface` — so the IGDB window/where below mirrors it by
// hand. That mirror only decides which candidates get fetched; whether an
// unreleased game can pass is decided by the real isReleased(), so a drifted
// where clause cannot produce a false PASS here.
//
// Asserts, and exits non-zero on any failure:
//   1. no unreleased game survives the gate
//   2. neither lane is empty, and neither lane floods the other out
//   3. the obscure zero-signal titles are excluded
//   4. the unreleased titles that used to headline the rail are all gone
//
// Run: node scripts/verify-new-notable-gate.mjs

import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)

async function importDeno(relPath) {
  const src = readFileSync(new URL(relPath, root), 'utf8')
  return await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`)
}

const lanes = await importDeno('supabase/functions/new-notable/lanes.ts')
const { hasRecognizedPublisher } = await importDeno('supabase/functions/new-notable/publishers.ts')
const { classifyLane, curateRail, isReleased, summarizeLanes } = lanes

const env = Object.fromEntries(
  readFileSync(new URL('.env', root), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const PROXY_URL = env.VITE_IGDB_PROXY_URL
const ANON = env.VITE_SUPABASE_ANON_KEY

let stamps = []
let reqCount = 0
async function throttle() {
  for (;;) {
    const now = Date.now()
    stamps = stamps.filter((t) => now - t < 1000)
    if (stamps.length < 4) { stamps.push(now); return }
    await new Promise((r) => setTimeout(r, 1000 - (now - stamps[0]) + 10))
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

// Mirrors pool.ts: LOOKBACK_DAYS = 90, no lookahead, same fields.
const NOW = Math.floor(Date.now() / 1000)
const DAY = 86400
const LOOKBACK_DAYS = 90
const FIELDS =
  'id, name, cover.image_id, first_release_date, game_status, total_rating, ' +
  'total_rating_count, hypes, involved_companies.company.name, ' +
  'involved_companies.publisher, genres.id, genres.name'
const WHERE =
  `first_release_date >= ${NOW - LOOKBACK_DAYS * DAY} & first_release_date <= ${NOW}` +
  ` & cover != null & game_type = 0 & version_parent = null`

const fmt = (g) => {
  const days = Math.round((g.first_release_date - NOW) / DAY)
  return (
    `${(g.name || '?').slice(0, 38).padEnd(38)} rel=${String(days === 0 ? 'today' : `${days}d`).padEnd(6)} ` +
    `rating=${String(g.total_rating == null ? '-' : g.total_rating.toFixed(1)).padStart(5)} ` +
    `count=${String(g.total_rating_count ?? 0).padStart(4)} hypes=${String(g.hypes ?? 0).padStart(4)}`
  )
}

console.log('='.repeat(96))
console.log('NEW & NOTABLE — GATE VERIFICATION (running the shipped lanes.ts)')
console.log(`window: released, last ${LOOKBACK_DAYS}d   clock: ${new Date(NOW * 1000).toISOString()}`)
console.log('='.repeat(96))

const total = Number((await igdb('games/count', `where ${WHERE};`))?.count ?? 0)
async function pageBy(sort, cap) {
  const pages = Math.ceil(Math.min(total, cap) / 500)
  const out = []
  for (let i = 0; i < pages; i++) {
    const rows = await igdb('games', `fields ${FIELDS}; where ${WHERE}; sort ${sort}; limit 500; offset ${i * 500};`)
    out.push(...rows)
    if (rows.length < 500) break
  }
  return out
}
const byId = new Map()
for (const g of [
  ...(await pageBy('total_rating_count desc', 5000)),
  ...(await pageBy('total_rating desc', 1000)),
  ...(await pageBy('hypes desc', 1000)),
]) byId.set(g.id, g)
const windowGames = [...byId.values()]
console.log(`\nwindow: ${total} per IGDB count, ${windowGames.length} fetched+deduped`)

// ── Run the real gate ─────────────────────────────────────────────────────
const rejectedByRelease = windowGames.filter((g) => !isReleased(g, NOW))
const qualified = []
for (const g of windowGames) {
  const result = classifyLane(g, hasRecognizedPublisher(g.involved_companies), NOW)
  if (result) qualified.push({ ...g, ...result, release_date: g.first_release_date * 1000 })
}

console.log(`release gate rejected: ${rejectedByRelease.length}`)
console.log(`lane summary: ${JSON.stringify(summarizeLanes(qualified))}`)

const failures = []

// ── 1. no unreleased survivors ────────────────────────────────────────────
const futureSurvivors = qualified.filter((g) => g.first_release_date > NOW)
console.log(`\n[1] unreleased survivors: ${futureSurvivors.length}`)
if (futureSurvivors.length) {
  failures.push(`${futureSurvivors.length} unreleased game(s) cleared the gate`)
  for (const g of futureSurvivors.slice(0, 10)) console.log('    ' + fmt(g))
}

// A synthetic future-dated row must be rejected even if it has enormous
// signal on every axis — the gate cannot be bought with hype or volume.
const syntheticUpcoming = {
  name: 'SYNTHETIC upcoming blockbuster',
  first_release_date: NOW + 60 * DAY,
  total_rating: 95,
  total_rating_count: 5000,
  hypes: 99999,
}
if (classifyLane(syntheticUpcoming, true, NOW) !== null) {
  failures.push('a future-dated game with maximal signal was NOT rejected')
}
console.log(`    synthetic future-dated max-signal game rejected: ${classifyLane(syntheticUpcoming, true, NOW) === null}`)

// Past-dated but Alpha/Beta/Cancelled/Rumored must also be rejected.
const syntheticAlpha = { ...syntheticUpcoming, name: 'SYNTHETIC alpha', first_release_date: NOW - 10 * DAY, game_status: 2 }
console.log(`    synthetic past-dated ALPHA rejected: ${classifyLane(syntheticAlpha, true, NOW) === null}`)
if (classifyLane(syntheticAlpha, true, NOW) !== null) failures.push('a past-dated Alpha game was NOT rejected')

// ── 2. both lanes healthy ─────────────────────────────────────────────────
const laneA = qualified.filter((g) => g.lane === 'aaa')
const laneB = qualified.filter((g) => g.lane === 'indie')
console.log(`\n[2] Lane A (aaa): ${laneA.length}    Lane B (indie): ${laneB.length}    total: ${qualified.length} / ${windowGames.length}`)
if (!laneA.length) failures.push('Lane A is empty')
if (!laneB.length) failures.push('Lane B is empty')
if (qualified.length > windowGames.length * 0.05) {
  failures.push(`gate is too loose: ${qualified.length} of ${windowGames.length} window games qualified (>5%)`)
}

console.log('\n    Lane A (volume), by lane_score desc:')
for (const g of [...laneA].sort((a, b) => b.lane_score - a.lane_score)) console.log('      ' + fmt(g))
console.log('\n    Lane B (quality), by lane_score desc:')
for (const g of [...laneB].sort((a, b) => b.lane_score - a.lane_score)) console.log('      ' + fmt(g))

// ── 3. obscure zero-signal titles excluded ───────────────────────────────
console.log('\n[3] obscure titles:')
for (const name of ['Room 0', 'Ludus']) {
  const rows = await igdb('games', `fields ${FIELDS}; search "${name}"; where cover != null; limit 3;`)
  for (const g of rows.slice(0, 2)) {
    const verdict = classifyLane(g, hasRecognizedPublisher(g.involved_companies), NOW)
    console.log(`    ${fmt(g)} -> ${verdict ? `INCLUDED as ${verdict.lane}` : 'EXCLUDED'}`)
    if (verdict) failures.push(`obscure title "${g.name}" was included as ${verdict.lane}`)
  }
}

// ── 4. the titles that used to headline the rail ─────────────────────────
console.log('\n[4] previously-railed unreleased headliners:')
const HEADLINERS = [
  'Grand Theft Auto VI', "Marvel's Wolverine", 'Phantom Blade 0', 'Control Resonant',
  'Onimusha: Way of the Sword', 'The Blood of Dawnwalker', 'Resonance: A Plague Tale Legacy',
  'Beast of Reincarnation',
]
for (const name of HEADLINERS) {
  const inPool = qualified.find((g) => g.name === name)
  console.log(`    ${name.padEnd(34)} ${inPool ? 'STILL PRESENT <<< FAIL' : 'excluded'}`)
  if (inPool) failures.push(`unreleased headliner "${name}" is still in the pool`)
}

// ── Rail + see-all preview ───────────────────────────────────────────────
const rail = curateRail(qualified.map((g) => ({ ...g })), 8)
console.log(`\nrail (${rail.length} slots, engine order before taste reordering):`)
for (const g of rail) {
  console.log(`    ${String(g.rail_rank).padStart(2)} ${g.lane.padEnd(6)} ${fmt(g)}`)
}
const railUnreleased = rail.filter((g) => g.first_release_date > NOW)
if (railUnreleased.length) failures.push(`${railUnreleased.length} unreleased game(s) on the rail`)

console.log('\nsee-all grid (release date desc — newest first):')
for (const g of [...qualified].sort((a, b) => b.first_release_date - a.first_release_date)) {
  console.log(`    ${new Date(g.first_release_date * 1000).toISOString().slice(0, 10)} ${g.lane.padEnd(6)} ${g.name}`)
}

console.log('\n' + '='.repeat(96))
if (failures.length) {
  console.log('FAIL')
  for (const f of failures) console.log(`  - ${f}`)
  console.log(`IGDB requests: ${reqCount}`)
  process.exit(1)
}
console.log(`PASS — all ${qualified.length} pooled games are released; Lane A ${laneA.length}, Lane B ${laneB.length}.`)
console.log(`IGDB requests: ${reqCount}`)

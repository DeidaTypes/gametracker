// Themed Drops — IGDB-level diagnosis.
//
// Answers the questions that can only be asked of IGDB itself, independently
// of anything already in our database:
//
//   1. Is `game_time_to_beats` reachable through the proxy, and what fields
//      does it actually return?
//   2. How deep is the pool at a given quality floor?
//   3. What fraction of that pool has a REAL completion time, and how is that
//      coverage distributed across popularity?
//
// For PER-THEME pool depth, do not use this script — ask the engine:
//
//   select net.http_post(
//     url := 'https://<ref>.supabase.co/functions/v1/themed-drops',
//     headers := jsonb_build_object('Content-Type','application/json',
//       'x-engine-secret', (select decrypted_secret from vault.decrypted_secrets
//                            where name = 'taste_engine_secret' limit 1)),
//     body := jsonb_build_object('action','diagnose'));
//
// That path runs the real filter library over the real candidate pool, so it
// stays correct for themes the owner adds later. Reimplementing the filters
// here would just create a second answer that can disagree with the engine.
//
// Run: node scripts/diagnose-themed-drops.mjs

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

// Mirror the engine's ceiling exactly: 4 req/s, 8 concurrent.
const RATE_MAX = 4
const RATE_WINDOW_MS = 1000
const MAX_CONCURRENCY = 8
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ANON}`,
        apikey: ANON,
      },
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

async function mapPool(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = cursor++
        if (i >= items.length) return
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

const HOUR = 3600
const fmt = (n) => String(n).padStart(6, ' ')

// Keep in step with themed-drops/selection.ts and pool.ts.
const FLOOR_RATING = Number(process.env.FLOOR_RATING || 75)
const FLOOR_COUNT = Number(process.env.FLOOR_COUNT || 10)
const TTB_MIN_SECONDS = 15 * 60
const TTB_MAX_SECONDS = 200 * HOUR

// game_type 0 = main game. IGDB RETIRED the old `category` field: `category = 0`
// still parses but matches zero rows, silently emptying the query. This cost an
// hour once — do not switch it back.
const BASE = 'game_type = 0 & version_parent = null & cover != null'
const floorClause = (r, c) => `${BASE} & total_rating >= ${r} & total_rating_count >= ${c}`

const countGames = async (where) => (await igdb('games/count', `where ${where};`))?.count ?? 0

console.log('='.repeat(78))
console.log('THEMED DROPS — IGDB DIAGNOSIS')
console.log('='.repeat(78))

// ── 1. Reachability + field shape ───────────────────────────────────────────
console.log('\n1. game_time_to_beats — reachable through the proxy?')
console.log('-'.repeat(78))
const sample = (await igdb('game_time_to_beats', 'fields *; limit 1;'))?.[0]
console.log(`   REACHABLE. Fields: ${Object.keys(sample || {}).join(', ')}`)
console.log(`   Sample: ${JSON.stringify(sample)}`)
console.log('   FK field is `game_id`. (`game` 400s against this proxy.)')
console.log('   All times in SECONDS. `normally` is the balanced playthrough.')

// ── 2. Floor calibration ────────────────────────────────────────────────────
console.log('\n2. Quality floor calibration')
console.log('-'.repeat(78))
console.log('   total_rating_count is the binding constraint, not the rating:')
const floors = [[70, 10], [75, 10], [75, 25], [75, 50], [78, 25], [80, 20], [85, 20]]
const counts = {}
await mapPool(floors, MAX_CONCURRENCY, async ([r, c]) => {
  counts[`${r}/${c}`] = await countGames(floorClause(r, c))
})
for (const [r, c] of floors) {
  console.log(`   rating >= ${r}, rating_count >= ${String(c).padStart(3)}  ->  ${fmt(counts[`${r}/${c}`])} games`)
}
console.log(`\n   >>> Engine hard floor: ${FLOOR_RATING} / ${FLOOR_COUNT} (the candidate pool)`)
console.log('   >>> Seeded themes add their own 78 / 25 on top, AND-combined.')

// ── 3. Time-to-beat coverage inside the pool ────────────────────────────────
console.log('\n3. Time-to-beat coverage WITHIN the quality pool')
console.log('-'.repeat(78))
console.log('   Global TTB sparsity is irrelevant — what matters is coverage among')
console.log('   games that already clear the floor. Measuring that directly.\n')

const poolSize = counts[`${FLOOR_RATING}/${FLOOR_COUNT}`]
const pages = Array.from({ length: Math.ceil(Math.min(poolSize, 5000) / 500) }, (_, i) => i)
const pool = (
  await mapPool(pages, MAX_CONCURRENCY, (p) =>
    igdb(
      'games',
      `fields id, name, total_rating, total_rating_count; where ${floorClause(FLOOR_RATING, FLOOR_COUNT)};
       sort total_rating_count desc; limit 500; offset ${p * 500};`,
    ),
  )
).flat()

const chunks = []
for (let i = 0; i < pool.length; i += 200) chunks.push(pool.slice(i, i + 200).map((g) => g.id))
const ttbRows = (
  await mapPool(chunks, MAX_CONCURRENCY, (c) =>
    igdb('game_time_to_beats', `fields game_id, normally, count; where game_id = (${c.join(',')}); limit 500;`),
  )
).flat()

const ttb = new Map()
let implausible = 0
for (const r of ttbRows) {
  const gid = Number(r.game_id)
  if (!gid || typeof r.normally !== 'number' || r.normally <= 0) continue
  // Same plausibility bounds the pool refresh applies.
  if (r.normally < TTB_MIN_SECONDS || r.normally > TTB_MAX_SECONDS) { implausible++; continue }
  ttb.set(gid, r.normally / HOUR)
}

console.log(`   Pool fetched: ${pool.length} games`)
console.log(`   With a usable \`normally\` time: ${ttb.size} (${((ttb.size / pool.length) * 100).toFixed(1)}%)`)
console.log(`   Rejected as implausible (<15min or >200h): ${implausible}`)
console.log('     -> data-entry junk (World Cup 98 at 567,890h) and endless games')
console.log('        (League of Legends at 14,451h). Neither is a completion time.')

console.log('\n   Distribution by `normally` hours:')
for (const [label, pred] of [
  ['< 2h', (h) => h < 2],
  ['2-6h    (Have time after work?)', (h) => h >= 2 && h <= 6],
  ['6-12h', (h) => h > 6 && h < 12],
  ['< 12h   (Beat it in a weekend)', (h) => h < 12],
  ['12-20h', (h) => h >= 12 && h < 20],
  ['20h+    (Vampire session?)', (h) => h >= 20],
]) {
  const n = [...ttb.values()].filter(pred).length
  console.log(`      ${label.padEnd(34)} ${fmt(n)}`)
}

// ── 4. Coverage vs popularity ───────────────────────────────────────────────
// This is the finding that shaped the balance lean: TTB coverage collapses in
// the long tail, so a time-based theme and an obscurity bias pull against each
// other. Worth re-checking whenever the floor moves.
console.log('\n4. TTB coverage vs popularity')
console.log('-'.repeat(78))
const q = Math.ceil(pool.length / 5)
for (let d = 0; d < 5; d++) {
  const slice = pool.slice(d * q, (d + 1) * q)
  if (!slice.length) continue
  const covered = slice.filter((g) => ttb.has(g.id)).length
  console.log(
    `   Quintile ${d + 1} (rating_count ${String(slice[0].total_rating_count).padStart(5)}..` +
      `${String(slice[slice.length - 1].total_rating_count).padStart(4)}): ` +
      `${fmt(covered)} / ${fmt(slice.length)}  (${((covered / slice.length) * 100).toFixed(1)}%)`,
  )
}
console.log('\n   Coverage falls off steeply with obscurity, which is why the balance')
console.log('   lean targets a MIDDLE band rather than maximising obscurity — see')
console.log('   LEAN_SWEET_SPOT in themed-drops/selection.ts.')

console.log('\n' + '-'.repeat(78))
console.log(`Total IGDB requests: ${reqCount}`)
console.log('='.repeat(78))

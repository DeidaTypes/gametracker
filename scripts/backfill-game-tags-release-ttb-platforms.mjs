// One-time backfill: populate game_tags.first_release_date / platform_ids /
// platform_names / time_to_beat_normally_seconds / time_to_beat_completely_seconds
// for the 728 existing game_tags rows, in priority order (finished games ->
// touched games -> the rest). See scripts/game-tags-backfill-ids.json for the
// tiered id lists and supabase/migrations/20260915153935_game_tags_release_ttb_platforms.sql
// for the schema this fills in.
//
// This script ONLY talks to IGDB (via the deployed igdb-proxy Edge Function,
// same as scripts/diagnose-themed-drops.mjs) and writes its findings to
// scripts/game-tags-backfill-results.json. It does NOT write to the database —
// game_tags is service-role-write-only (RLS), and this script only has the
// anon key. The actual UPDATE is run separately via the Supabase SQL tool
// against the output file, in batches.
//
// Run: node scripts/backfill-game-tags-release-ttb-platforms.mjs

import { readFileSync, writeFileSync } from 'node:fs'

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

// Mirror the taste-engine's own ceiling exactly: 4 req/s, 8 concurrent.
const RATE_MAX = 4
const RATE_WINDOW_MS = 1000
const MAX_CONCURRENCY = 8
const ID_CHUNK = 200 // ids per `where id = (...)` / `where game_id = (...)` sub-query
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
      console.log(`   [retry] ${endpoint} -> ${res.status}, backing off`)
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

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const idData = JSON.parse(readFileSync(new URL('./game-tags-backfill-ids.json', import.meta.url), 'utf8'))
const entries = [
  ...idData.tier1.map((igdb_game_id) => ({ igdb_game_id, tier: 1 })),
  ...idData.tier2.map((igdb_game_id) => ({ igdb_game_id, tier: 2 })),
  ...idData.tier3.map((igdb_game_id) => ({ igdb_game_id, tier: 3 })),
]

console.log('='.repeat(78))
console.log('GAME_TAGS BACKFILL — release date / platforms / time-to-beat')
console.log('='.repeat(78))
console.log(`Loaded ${entries.length} ids (tier1=${idData.tier1.length} finished, ` +
  `tier2=${idData.tier2.length} touched, tier3=${idData.tier3.length} remaining)`)
console.log(`Batch size: ${ID_CHUNK} ids per sub-query, rate ceiling ${RATE_MAX} req/s / ${MAX_CONCURRENCY} concurrent\n`)

const allIds = entries.map((e) => e.igdb_game_id)
const gameChunks = chunk(allIds, ID_CHUNK)
const ttbChunks = chunk(allIds, ID_CHUNK)

console.log(`games endpoint:              ${gameChunks.length} request(s) of up to ${ID_CHUNK} ids`)
console.log(`game_time_to_beats endpoint: ${ttbChunks.length} request(s) of up to ${ID_CHUNK} ids\n`)

const gamesRows = (
  await mapPool(gameChunks, MAX_CONCURRENCY, (c) =>
    igdb('games', `fields id, first_release_date, platforms.id, platforms.name; where id = (${c.join(',')}); limit ${c.length};`),
  )
).flat()

const ttbRows = (
  await mapPool(ttbChunks, MAX_CONCURRENCY, (c) =>
    igdb('game_time_to_beats', `fields game_id, normally, completely; where game_id = (${c.join(',')}); limit ${c.length};`),
  )
).flat()

console.log(`IGDB returned ${gamesRows.length}/${allIds.length} games rows`)
console.log(`IGDB returned ${ttbRows.length}/${allIds.length} time-to-beat rows`)
console.log(`Total IGDB requests: ${reqCount}`)

const gamesById = new Map(gamesRows.map((g) => [Number(g.id), g]))
const ttbById = new Map(ttbRows.map((r) => [Number(r.game_id), r]))

const now = new Date().toISOString()
const results = entries.map(({ igdb_game_id, tier }) => {
  const g = gamesById.get(igdb_game_id)
  const t = ttbById.get(igdb_game_id)
  const platforms = Array.isArray(g?.platforms) ? g.platforms : []
  return {
    igdb_game_id,
    tier,
    found_in_games: !!g,
    found_in_ttb: !!t,
    // We DID query the `games` endpoint for every id in this run, whether or
    // not IGDB still has a matching row — so this is always stamped.
    release_platform_fetched_at: now,
    first_release_date: typeof g?.first_release_date === 'number'
      ? new Date(g.first_release_date * 1000).toISOString()
      : null,
    // [] is a real "IGDB has no platforms for this game" (or no game row at
    // all), never null — null is reserved for "never attempted", and this
    // row WAS attempted this run.
    platform_ids: platforms.map((p) => Number(p.id)).filter(Boolean),
    platform_names: platforms.map((p) => String(p.name)).filter(Boolean),
    // Same logic: we DID query game_time_to_beats for every id, so this is
    // always stamped, and a missing flavor stays null rather than being
    // backfilled from the other flavor.
    time_to_beat_fetched_at: now,
    time_to_beat_normally_seconds: typeof t?.normally === 'number' ? t.normally : null,
    time_to_beat_completely_seconds: typeof t?.completely === 'number' ? t.completely : null,
  }
})

const outPath = new URL('./game-tags-backfill-results.json', import.meta.url)
writeFileSync(outPath, JSON.stringify({ generatedAt: now, totalIgdbRequests: reqCount, results }, null, 2))
console.log(`\nWrote ${results.length} results to scripts/game-tags-backfill-results.json`)

// ── Quick tier-scoped coverage preview (the DB-side self-check re-derives
// this authoritatively after the UPDATE actually runs; this is a sanity
// check on what IGDB just gave us). ─────────────────────────────────────────
for (const tier of [1, 2, 3]) {
  const rows = results.filter((r) => r.tier === tier)
  const withDate = rows.filter((r) => r.first_release_date != null).length
  const withPlatforms = rows.filter((r) => r.platform_ids.length > 0).length
  const withNormally = rows.filter((r) => r.time_to_beat_normally_seconds != null).length
  const withCompletely = rows.filter((r) => r.time_to_beat_completely_seconds != null).length
  console.log(`\nTier ${tier} (${rows.length} games):`)
  console.log(`  first_release_date populated: ${withDate}/${rows.length}`)
  console.log(`  platform_ids non-empty:       ${withPlatforms}/${rows.length}`)
  console.log(`  time_to_beat_normally:        ${withNormally}/${rows.length}`)
  console.log(`  time_to_beat_completely:      ${withCompletely}/${rows.length}`)
}
console.log('\n' + '='.repeat(78))

// Turns scripts/game-tags-backfill-results.json into a single batched SQL
// UPDATE (via UPDATE ... FROM (VALUES ...)) that writes the IGDB-fetched
// release date / platforms / time-to-beat data into game_tags for exactly
// the 728 rows already in that table. Never inserts a new row — this is a
// backfill of existing cache rows only.
//
// Run: node scripts/generate-game-tags-backfill-sql.mjs
// Writes scripts/game-tags-backfill.chunk-NN.sql (one UPDATE statement per
// chunk of CHUNK_SIZE rows, kept small enough to paste individually).

import { readFileSync, writeFileSync } from 'node:fs'

const CHUNK_SIZE = 80

const { results } = JSON.parse(readFileSync(new URL('./game-tags-backfill-results.json', import.meta.url), 'utf8'))

function sqlStr(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}
function sqlTs(iso) {
  return iso ? sqlStr(iso) + '::timestamptz' : 'null::timestamptz'
}
function sqlIntArray(arr) {
  return `ARRAY[${arr.join(',')}]::integer[]`
}
function sqlTextArray(arr) {
  return `ARRAY[${arr.map(sqlStr).join(',')}]::text[]`
}
function sqlInt(n) {
  return n == null ? 'null::integer' : String(Math.round(n))
}

function rowValues(r) {
  const values = [
    r.igdb_game_id,
    sqlTs(r.first_release_date),
    sqlTs(r.release_platform_fetched_at),
    sqlIntArray(r.platform_ids),
    sqlTextArray(r.platform_names),
    sqlInt(r.time_to_beat_normally_seconds),
    sqlInt(r.time_to_beat_completely_seconds),
    sqlTs(r.time_to_beat_fetched_at),
  ]
  return `  (${values.join(', ')})`
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const chunks = chunk(results, CHUNK_SIZE)
const header = `-- One-time data backfill (not a schema change) generated from IGDB via
-- scripts/backfill-game-tags-release-ttb-platforms.mjs — see
-- scripts/game-tags-backfill-results.json for the raw source data and
-- scripts/game-tags-backfill-ids.json for the tiered id lists / priority
-- order this pulled from (finished games -> touched games -> the rest).
--
-- Updates ONLY the 7 columns added by
-- 20260915153935_game_tags_release_ttb_platforms.sql, on rows that already
-- exist in game_tags (no inserts — every id here was already cached).
-- Values are IGDB's raw response, unfiltered: some \`time_to_beat_normally_seconds\`
-- values are known IGDB data-entry outliers (see chat self-check) and are
-- intentionally NOT cleaned here — this backfill's job is a faithful cache,
-- not badge-threshold judgment calls, which belong to the follow-up prompt.
--
-- Split into ${chunks.length} chunks of up to ${CHUNK_SIZE} rows each purely so each
-- statement is small enough to run individually; this is chunk %I% of ${chunks.length}.
`

chunks.forEach((rows, i) => {
  const n = String(i).padStart(2, '0')
  const sql = header.replace('%I%', String(i + 1)) + `
update public.game_tags as gt
set
  first_release_date = v.first_release_date,
  release_platform_fetched_at = v.release_platform_fetched_at,
  platform_ids = v.platform_ids,
  platform_names = v.platform_names,
  time_to_beat_normally_seconds = v.time_to_beat_normally_seconds,
  time_to_beat_completely_seconds = v.time_to_beat_completely_seconds,
  time_to_beat_fetched_at = v.time_to_beat_fetched_at
from (values
${rows.map(rowValues).join(',\n')}
) as v(
  igdb_game_id, first_release_date, release_platform_fetched_at,
  platform_ids, platform_names,
  time_to_beat_normally_seconds, time_to_beat_completely_seconds, time_to_beat_fetched_at
)
where gt.igdb_game_id = v.igdb_game_id;
`
  writeFileSync(new URL(`./game-tags-backfill.chunk-${n}.sql`, import.meta.url), sql)
})

console.log(`Wrote ${chunks.length} chunk files (up to ${CHUNK_SIZE} rows each) to scripts/game-tags-backfill.chunk-*.sql`)

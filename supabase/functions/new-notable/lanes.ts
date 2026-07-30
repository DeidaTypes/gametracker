// @ts-nocheck
// supabase/functions/new-notable/lanes.ts
//
// THE THREE-LANE NOTABILITY GATE.
//
// A recent/anticipated game qualifies for New & Notable if it clears ANY ONE
// of three lanes (OR logic — one lane is enough). Thresholds below were
// tuned against LIVE IGDB data — see scripts/diagnose-new-notable.mjs and
// the before/after counts in its output — not guessed. Re-run that script
// before changing any number here; the distributions it prints (percentiles
// of total_rating_count and hypes across the actual window) are what these
// numbers are calibrated against.
//
// ── LANE A — "aaa": big release, volume of attention ────────────────────
// Primary signal is total_rating_count: lots of people already rated it.
// Reinforced (lower bar) when a recognized publisher is attached, because a
// major publisher's game accumulates ratings on a different curve than an
// indie's — 15 ratings from a Bethesda game means something different than
// 15 ratings from an unknown solo dev.
//
// Measured (150d back / 90d forward window, 3761-game deduped pool,
// see scripts/diagnose-new-notable.mjs run 2026-07-30):
//   total_rating_count >= 40  ->  12 games   (Palworld 256, Forza Horizon 6
//                                             83, Crimson Desert 108, ...)
//   total_rating_count p99 (released games) was only 13 — so 40 is already
//   deep into "very few games clear this alone", which is exactly right for
//   a lane meant to catch only genuine breakout/AAA volume.
export const LANE_A_MIN_RATING_COUNT = 40
export const LANE_A_PUBLISHER_MIN_RATING_COUNT = 15

// ── LANE B — "indie": hyped indie, quality over volume ──────────────────
// Deliberately NO high count requirement — that is the exact bug being
// fixed. A high total_rating with a real (not huge) audience is the signal:
// quality punching above its size. Upper bound keeps this lane from
// re-absorbing games that are really Lane A material (already has a big
// audience) — 60 sits above the released-pool p99 of 13 for the whole
// window, so it is generous, not exclusionary.
//
// Measured: total_rating among games with 3-60 ratings has p50=78, p70=81,
// p80=85 — so requiring >=80 keeps roughly the top 25-30% of that natural
// "has some ratings" band, not the median. Real examples that cleared this:
// Subnautica 2 (90.0, 38 ratings), Splatoon Raiders (90.5, 6), Sand:
// Raiders Of Sophie (88.8, 7).
export const LANE_B_MIN_RATING = 80
export const LANE_B_MIN_RATING_COUNT = 3
export const LANE_B_MAX_RATING_COUNT = 60

// ── LANE C — "anticipated": buzz before reviews ──────────────────────────
// hypes is IGDB's pre-release interest counter. IGDB's own forum states
// they "don't actively support Follows (and Hype) as a data point" — it is
// unofficial/unmaintained, not a documented-stable metric — but it still
// returns real, non-fabricated values today (this codebase already sorts by
// it in igdb.js's fetchNewThisWeek), and there is no replacement signal for
// "buzz before release" in the schema. `follows` itself is fully deprecated
// (IGDB confirmed it is never populated) and is not requested anywhere in
// this engine.
//
// Measured: among games with hypes > 0, p80=8, p90=17 — so >=15 sits at
// roughly the 85th-88th percentile of "has any hype at all", a real buzz
// signal rather than noise. Paired with total_rating_count <= 5 so a game
// that already has real review volume doesn't ride in on stale hype from
// before it launched — it graduates to Lane A or B instead. Real examples:
// Marvel's Wolverine (hypes 253, 0 ratings, +46d), Gears of War: E-Day
// (hypes 97, 0 ratings, +67d).
export const LANE_C_MIN_HYPES = 15
export const LANE_C_MAX_RATING_COUNT = 5

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Classify one IGDB game row into a lane, or null if it clears none.
 * Checked in priority order A -> B -> C: a game that would qualify for more
 * than one lane (rare — e.g. high count AND high hypes) is tagged with the
 * most specific/informative one rather than counted in all three.
 *
 * @param g  raw IGDB game row: { total_rating, total_rating_count, hypes,
 *           involved_companies }
 * @returns  { lane: 'aaa'|'indie'|'anticipated', lane_score: number,
 *             has_recognized_publisher: boolean } | null
 */
export function classifyLane(g, hasRecognizedPublisher) {
  const rating = g.total_rating ?? null
  const count = n(g.total_rating_count)
  const hypes = n(g.hypes)
  const recognized = hasRecognizedPublisher

  const laneAVolume = count >= LANE_A_MIN_RATING_COUNT
  const laneAPublisher = recognized && count >= LANE_A_PUBLISHER_MIN_RATING_COUNT
  if (laneAVolume || laneAPublisher) {
    return { lane: 'aaa', lane_score: count, has_recognized_publisher: recognized }
  }

  if (
    rating != null &&
    rating >= LANE_B_MIN_RATING &&
    count >= LANE_B_MIN_RATING_COUNT &&
    count <= LANE_B_MAX_RATING_COUNT
  ) {
    return { lane: 'indie', lane_score: rating, has_recognized_publisher: recognized }
  }

  if (hypes >= LANE_C_MIN_HYPES && count <= LANE_C_MAX_RATING_COUNT) {
    return { lane: 'anticipated', lane_score: hypes, has_recognized_publisher: recognized }
  }

  return null
}

/**
 * Rail curation: top `perLane` games from EACH lane by lane_score desc,
 * combined and re-sorted by release date desc so the rail still reads as a
 * chronological "New" feed rather than a lane-grouped leaderboard. This is
 * what prevents one lane (usually "anticipated" — hype-worthy upcoming
 * titles are common) from flooding a rail that only shows ~20-30 slots.
 *
 * @param pool     classified rows: { igdb_game_id, lane, lane_score,
 *                 release_date (ms epoch), ... }
 * @param perLane  max picks per lane (default 8 -> rail cap 24)
 * @returns        the same row objects, each with `rail_rank` (1-based) set
 */
export function curateRail(pool, perLane = 8) {
  const byLane = { aaa: [], indie: [], anticipated: [] }
  for (const g of pool) byLane[g.lane]?.push(g)

  const picked = []
  for (const lane of Object.keys(byLane)) {
    const sorted = [...byLane[lane]].sort(
      (a, b) => b.lane_score - a.lane_score || b.release_date - a.release_date,
    )
    picked.push(...sorted.slice(0, perLane))
  }

  picked.sort((a, b) => b.release_date - a.release_date)
  picked.forEach((g, i) => { g.rail_rank = i + 1 })
  return picked
}

/** QA summary: counts per lane, for the daily job's response + manual diagnosis. */
export function summarizeLanes(classified) {
  const counts = { aaa: 0, indie: 0, anticipated: 0 }
  for (const g of classified) counts[g.lane] = (counts[g.lane] ?? 0) + 1
  return { total: classified.length, ...counts }
}

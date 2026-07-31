// @ts-nocheck
// supabase/functions/new-notable/lanes.ts
//
// THE RELEASE GATE + THE TWO-LANE NOTABILITY GATE.
//
// "New & Notable" means recently RELEASED games worth attention. Two
// independent checks, in this order:
//
//   1. RELEASE GATE (hard, non-negotiable) — the game must already be out.
//      An unreleased game NEVER qualifies, no matter how anticipated it is.
//   2. NOTABILITY GATE — among released games, it must clear Lane A (volume
//      of attention) or Lane B (quality punching above audience size). OR
//      logic: one lane is enough.
//
// Every threshold below was tuned against LIVE IGDB data — see
// scripts/diagnose-new-notable.mjs and the measured counts quoted in each
// section. Re-run that script before changing any number here; the
// percentiles it prints are what these are calibrated against.
//
// ── Signals: what IGDB actually gives us ───────────────────────────────────
// Measured over the released 90-day window (4310 games after the release
// gate, run 2026-07-31):
//
//   first_release_date    100.0%  — always present, drives the release gate
//   game_status            12.3%  — present only when non-zero (see below)
//   hypes > 0              14.2%  — pre-release interest counter
//   total_rating            1.9%  — blended user + critic score, 0-100
//   total_rating_count      1.9%  — user + critic rating volume
//   aggregated_rating       1.4%  — critic-only score
//   involved_companies     45.0%  — developer/publisher rows
//   recognized publisher    0.6%  — involved_companies filtered by KNOWN_PUBLISHERS
//   follows > 0             0.0%  — DEAD. Not one game in the window has it.
//
// `follows` is requested nowhere in this engine: IGDB never populates it, so
// a "high follows" rule would be a rule that matches nothing. Volume has to
// come from total_rating_count, with hypes as a narrow support signal.
//
// total_rating_count is brutally sparse: p50 through p95 are all 0, p99 is 3.
// That is WHY Lane B must not require a high count — requiring one would
// exclude essentially every indie. It is also why Lane A's bar looks high in
// absolute terms: 30 is ~10x p99.

const DAY = 86400

// ── RELEASE GATE ──────────────────────────────────────────────────────────
// IGDB's game_status enum: 0 Released, 2 Alpha, 3 Beta, 4 Early Access,
// 5 Offline, 6 Cancelled, 7 Rumored, 8 Delisted. IGDB omits zero-valued
// fields from responses, so an ABSENT game_status means 0 / Released — which
// is the overwhelming majority (measured spread over the released window:
// Released 3778, Early Access 528, Delisted 4).
//
// first_release_date in the past is necessary but not sufficient: 70 games in
// the window are past-dated yet still Alpha/Beta/Cancelled/Rumored — dated,
// announced, not actually a thing you can go play. Those are excluded.
//
// Early Access (4) is KEPT: it is released, purchasable and playable, and it
// is where a lot of genuinely notable indie work lives (Subnautica 2, rating
// 90.0 with 38 ratings, is Early Access). Delisted/Offline are kept too —
// they did release; both are vanishingly rare inside a 90-day window.
export const UNRELEASED_GAME_STATUSES = new Set([2, 3, 6, 7])

/**
 * The hard release constraint. A game passes only if IGDB says it is out.
 *
 * Lives here, next to the lanes, rather than only in the IGDB `where`
 * clause: the where clause is an optimisation, this is the guarantee. A
 * caller that widens the query can't accidentally let an upcoming title
 * through.
 *
 * @param g       raw IGDB game row
 * @param nowSec  unix seconds; injected so a refresh classifies the whole
 *                pool against one consistent clock
 */
export function isReleased(g, nowSec) {
  const date = g?.first_release_date
  if (typeof date !== 'number' || !Number.isFinite(date)) return false
  if (date > nowSec) return false
  return !UNRELEASED_GAME_STATUSES.has(g.game_status)
}

// ── LANE A — "aaa": big release, VOLUME of attention ──────────────────────
// Broad attention is the signal. Three ways in, OR'd:
//
// A1  total_rating_count >= 30. Lots of people already rated it. Measured:
//     12 games in the released window clear this, and since count p99 is
//     only 3, this is deep into the tail where "genuine breakout" lives.
//     Palworld (257), 007 First Light (147), Forza Horizon 6 (83),
//     Subnautica 2 (38), Mina the Hollower (30).
//
// A2  recognized publisher AND total_rating_count >= 10. A major
//     publisher's release accumulates ratings on a different curve than an
//     unknown solo dev's, so the volume bar drops — but it does NOT vanish:
//     a shovelware title from a big publisher still needs real ratings, so
//     it can't ride the name alone. Measured: only 25 games in the whole
//     window have a recognized publisher at all.
export const LANE_A_MIN_RATING_COUNT = 30
export const LANE_A_PUBLISHER_MIN_RATING_COUNT = 10

// A3  the "fresh buzz" SUPPORT rule — not a lane of its own, and explicitly
//     NOT anticipation. A game that came out days ago physically cannot have
//     accumulated ratings yet; hypes is the only attention signal that
//     exists for it. This applies ONLY to already-released games (the
//     release gate runs first, unconditionally), so an upcoming title with
//     hypes of 964 — Grand Theft Auto VI, which headlined the rail before
//     this change — is rejected before any lane is considered.
//
//     Two guards keep it narrow:
//       - count < LANE_A_FRESH_MAX_RATING_COUNT: once a game has real
//         ratings it must qualify on THOSE (Lane A volume or Lane B
//         quality), never on hype left over from before launch.
//       - rating null or >= LANE_A_FRESH_MIN_RATING: early ratings that
//         already say "this is bad" veto the buzz. Measured effect — "The
//         Relic: First Guardian" (hypes 35, 1 rating, total_rating 55) is
//         excluded by this guard; without it, hype alone would have carried
//         a poorly-received game onto the rail.
//
//     Measured: admits exactly 2 games (Mistfall Hunter, hypes 36 / 0
//     ratings / 3 days old; Avatar Legends: The Fighting Game, hypes 25 / 2
//     ratings / rating 80). Supporting signal, not a flood. hypes >= 25 sits
//     just above p95 (18) of games that have any hype at all.
export const LANE_A_FRESH_WINDOW_DAYS = 21
export const LANE_A_FRESH_MIN_HYPES = 25
export const LANE_A_FRESH_MAX_RATING_COUNT = 3
export const LANE_A_FRESH_MIN_RATING = 70

// ── LANE B — "indie": acclaimed, QUALITY over volume ──────────────────────
// Deliberately NO high count requirement — that is the exact bug being
// fixed. A high total_rating with a modest-but-real audience is the signal:
// quality punching above its size.
//
// Measured: total_rating among games with a real-but-small rating count has
// p50=78, p70=82, p80=86 — so >=80 keeps roughly the top third of that band
// rather than its median. A floor of 3 ratings is what makes the score
// "real" instead of one person's opinion.
//
// There is deliberately no upper bound on count. Lane A is evaluated first,
// so anything with volume is already tagged 'aaa' and never reaches Lane B —
// an explicit ceiling here would be a second, redundant place to keep in
// sync with LANE_A_MIN_RATING_COUNT.
//
// Real qualifiers: Pokémon Infinite Fusion (98.5, 22), MOLE (93.0, 7),
// Splatoon Raiders (90.5, 6), Sand: Raiders Of Sophie (88.8, 7),
// Denshattack! (81.7, 10).
export const LANE_B_MIN_RATING = 80
export const LANE_B_MIN_RATING_COUNT = 3

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Classify one IGDB game row into a lane, or null if it doesn't belong in
 * New & Notable at all.
 *
 * The release gate runs FIRST and is absolute: an unreleased game returns
 * null before any signal is looked at.
 *
 * Lanes are then checked A -> B. A game that could satisfy both (high volume
 * AND a high score) is tagged 'aaa' rather than counted twice, and that
 * priority is also what lets Lane B skip an upper count bound.
 *
 * @param g       raw IGDB game row: { first_release_date, game_status,
 *                total_rating, total_rating_count, hypes, involved_companies }
 * @param hasRecognizedPublisher  precomputed from involved_companies
 * @param nowSec  unix seconds — the clock the whole refresh shares
 * @returns  { lane: 'aaa'|'indie', lane_score: number,
 *             has_recognized_publisher: boolean } | null
 */
export function classifyLane(g, hasRecognizedPublisher, nowSec) {
  if (!isReleased(g, nowSec)) return null

  const rating = g.total_rating ?? null
  const count = n(g.total_rating_count)
  const hypes = n(g.hypes)
  const recognized = hasRecognizedPublisher

  const laneAVolume = count >= LANE_A_MIN_RATING_COUNT
  const laneAPublisher = recognized && count >= LANE_A_PUBLISHER_MIN_RATING_COUNT
  const laneAFreshBuzz =
    g.first_release_date >= nowSec - LANE_A_FRESH_WINDOW_DAYS * DAY &&
    hypes >= LANE_A_FRESH_MIN_HYPES &&
    count < LANE_A_FRESH_MAX_RATING_COUNT &&
    (rating == null || rating >= LANE_A_FRESH_MIN_RATING)

  if (laneAVolume || laneAPublisher || laneAFreshBuzz) {
    // Score the lane on the signal it actually qualified on, so the rail's
    // top-N-per-lane pick ranks a 257-rating breakout above a 30-rating one,
    // and ranks a fresh-buzz pick by its buzz rather than by a count of 0.
    //
    // This means Lane A's score mixes two units: rating count for A1/A2,
    // hypes for A3. Deliberate, and it only affects WHICH games make the
    // rail cut, never the order they appear in — curateRail() re-sorts the
    // whole selection by release date. Normalising the two into a synthetic
    // combined score would invent a conversion rate that no measurement
    // supports.
    const score = laneAVolume || laneAPublisher ? count : hypes
    return { lane: 'aaa', lane_score: score, has_recognized_publisher: recognized }
  }

  if (rating != null && rating >= LANE_B_MIN_RATING && count >= LANE_B_MIN_RATING_COUNT) {
    return { lane: 'indie', lane_score: rating, has_recognized_publisher: recognized }
  }

  return null
}

/**
 * Rail curation: top `perLane` games from EACH lane by lane_score desc,
 * combined and re-sorted by release date desc so the rail reads as a
 * chronological "New" feed rather than a lane-grouped leaderboard. This is
 * what stops the volume lane — where the scores are numerically largest —
 * from crowding a rail that only shows ~16 slots.
 *
 * @param pool     classified rows: { igdb_game_id, lane, lane_score,
 *                 release_date (ms epoch), ... }
 * @param perLane  max picks per lane (default 8 -> rail cap 16)
 * @returns        the same row objects, each with `rail_rank` (1-based) set
 */
export function curateRail(pool, perLane = 8) {
  const byLane = { aaa: [], indie: [] }
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
  const counts = { aaa: 0, indie: 0 }
  for (const g of classified) counts[g.lane] = (counts[g.lane] ?? 0) + 1
  return { total: classified.length, ...counts }
}

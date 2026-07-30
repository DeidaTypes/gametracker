// @ts-nocheck
// supabase/functions/themed-drops/selection.ts
//
// THE SELECTION ENGINE — "something good, every time."
//
// Given a theme and the cached candidate pool, pick the games for one
// scheduled window. Five rules, all of them enforced here except the two that
// are inherently per-viewer:
//
//   a) HARD QUALITY FLOOR   — below, applied to every theme, not opt-out.
//   b) BALANCE LEAN         — below.
//   c) NO-REPEAT MEMORY     — below, via drop_history.
//   d) TASTE ORDERING       — NOT here. Ordering by the B1 vector is per-viewer
//                             and would be meaningless baked into a shared
//                             cache, so it happens in get_active_themed_drop().
//   e) OWNED/TRACKED EXCL.  — NOT here, same reason. This is why a drop selects
//                             more games than the UI shows: every viewer loses
//                             a different subset to their own library.
//
// Selection is deterministic FOR A GIVEN WINDOW (the RNG is seeded from the
// schedule id) so a retry after a partial failure reproduces the same drop
// rather than quietly reshuffling it, while different windows differ.

import type { Candidate, Composition } from './filterLibrary.ts'
import { compileComposition } from './filterLibrary.ts'

// ── (a) Hard quality floor ───────────────────────────────────────────────────
// Applied to EVERY theme regardless of composition. A theme's own rating_floor
// filter can only tighten this (both are AND-combined), never loosen it.
//
// Two numbers, because either alone is a trap: total_rating alone lets in a
// 95-rated game with 4 votes, and total_rating_count alone lets in a
// heavily-rated bad game. Measured against live IGDB, this floor yields ~4.3k
// games — see scripts/diagnose-themed-drops.mjs.
export const HARD_FLOOR_RATING = 75
export const HARD_FLOOR_RATING_COUNT = 10

// ── (b) Balance lean ─────────────────────────────────────────────────────────
// The floor guarantees "not junk". The lean is what makes a drop feel like a
// recommendation instead of a leaderboard: among games that already cleared the
// floor, bias toward the strong-but-less-played end.
//
// Three mechanisms:
//
//   MAINSTREAM_CUT drops the top slice outright. Scoring alone cannot do this
//   reliably — a 95-rated game scores well enough to survive any weighting, and
//   nobody needs Explore to recommend them The Witcher 3.
//
//   LEAN_SWEET_SPOT is where "lesser-known" actually lives. The first version
//   of this engine maximised obscurity, and the result was a drop full of games
//   like Epiko Regal — 98 rating off 17 ratings. That is the
//   "acclaimed-but-barely-rated" failure the quality floor is supposed to
//   prevent, reintroduced by the lean itself from the other direction.
//
//   IGDB's rating counts are savagely skewed, so percentile is not intuition:
//     pct 0.0-0.1 -> 221-5872 ratings   (famous)
//     pct 0.3     ->  67-114 ratings    (known, not famous)  <- the target
//     pct 0.5     ->  31-44 ratings
//     pct 0.7+    ->  under 23 ratings  (barely rated)
//
//   So discovery peaks at pct ~0.32 and falls off in BOTH directions: a famous
//   game and a barely-rated one are equally not what this is for. "Great games
//   you might not have already played" is a middle band, not a tail.
//
//   LEAN_WEIGHT balances that against raw quality.
//
// The cut is RESTORED automatically if it would starve a drop (see
// selectForDrop) — a thin drop is worse than an occasionally familiar one.
export const MAINSTREAM_CUT = 0.04
export const LEAN_WEIGHT = 0.5
export const LEAN_SWEET_SPOT = 0.32

// ── (c) No-repeat memory ─────────────────────────────────────────────────────
// 70 days, inside the 60-90 day range. Global across themes: the user does not
// experience "but that was a different theme" as a different game.
//
// This is a HARD promise and is never relaxed to pad a thin drop. If honouring
// it means shipping fewer games, the drop ships smaller and says so in
// selection_note.
//
// Freshness budget, which is what sets this number alongside drop_size. The
// weekend theme runs every week, so over 70 days it needs 10 x drop_size
// distinct games, plus whatever the overlapping "Have time after work?" theme
// consumes from the same sub-12h pool. At drop_size 20 that is ~240 games
// against a measured pool of 417, roughly 1.7x headroom. Raising this window
// or the weekend drop size eats that margin directly.
export const NO_REPEAT_DAYS = 70

// How many candidates to score before sampling. Sampling from a shortlist
// rather than the whole eligible set keeps quality bounded while still varying
// between activations; the no-repeat log does the rest of the work.
const SHORTLIST_MULTIPLE = 4

// A "Beat it in a weekend" drop that is six Sonic games is technically correct
// and useless. IGDB `collection` is the series/franchise grouping.
const MAX_PER_COLLECTION = 2

export interface SelectionResult {
  games: ScoredCandidate[]
  audit: {
    theme_slug: string
    composition: string
    pool_size: number
    after_floor: number
    after_filters: number
    after_no_repeat: number
    after_mainstream_cut: number
    mainstream_cut_applied: boolean
    collection_capped: number
    requested: number
    selected: number
    note: string | null
  }
}

export interface ScoredCandidate extends Candidate {
  quality_score: number
  discovery_score: number
  selection_score: number
}

/**
 * Pool-depth diagnosis for every theme — the go/no-go gate, runnable on demand.
 *
 * A theme is only viable if its pool can feed every activation inside the
 * no-repeat window without repeating. That depends on how OFTEN the theme runs,
 * which is a property of the rotation, not of the theme: the weekend theme runs
 * every week, while each of N weekday themes runs once every N weeks. A pool of
 * 300 is luxurious for a weekday theme and marginal for the weekend one.
 *
 * Reuses compileComposition, so what this measures is exactly what selection
 * will do — including for a theme the owner added five minutes ago.
 */
export function diagnoseThemes(
  pool: Candidate[],
  themes: Array<{
    slug: string
    display_name: string
    composition: Composition
    drop_size: number
    slot_eligibility: string
  }>,
) {
  const weekdayCount = Math.max(
    themes.filter((t) => t.slot_eligibility === 'weekday' || t.slot_eligibility === 'either').length,
    1,
  )
  const weeksInWindow = NO_REPEAT_DAYS / 7

  const afterFloor = pool.filter(
    (c) =>
      (c.total_rating ?? 0) >= HARD_FLOOR_RATING &&
      (c.total_rating_count ?? 0) >= HARD_FLOOR_RATING_COUNT,
  )

  return themes.map((t) => {
    let eligible = 0
    let leaned = 0
    let error: string | null = null

    try {
      const compiled = compileComposition(t.composition)
      const matches = afterFloor.filter(compiled.test)
      eligible = matches.length
      leaned = matches.filter((c) => (c.popularity_pct ?? 1) >= MAINSTREAM_CUT).length
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }

    // Weekend runs every week; a weekday theme runs once per rotation lap.
    const activations =
      t.slot_eligibility === 'weekend' ? weeksInWindow : weeksInWindow / weekdayCount
    const needed = Math.ceil(activations * t.drop_size)
    const headroom = needed > 0 ? leaned / needed : 0

    return {
      slug: t.slug,
      display_name: t.display_name,
      slot: t.slot_eligibility,
      drop_size: t.drop_size,
      eligible_after_floor_and_filters: eligible,
      eligible_after_balance_lean: leaned,
      activations_per_window: Math.round(activations * 10) / 10,
      games_needed_per_window: needed,
      headroom: Math.round(headroom * 10) / 10,
      verdict: error
        ? 'BROKEN'
        : headroom >= 3 ? 'HEALTHY'
        : headroom >= 1.5 ? 'OK'
        : headroom >= 1 ? 'TIGHT — will go stale as the pool ages'
        : 'TOO THIN — cannot fill its rotation without repeating',
      error,
    }
  })
}

/** Deterministic PRNG so a retry reproduces the same drop. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

function score(c: Candidate): ScoredCandidate {
  // Quality, normalized across the band the floor actually admits. Measuring
  // from the floor rather than from 0 spreads the pool over the full 0-1 range;
  // measuring from 0 would compress every game into 0.75-1.0 and make the
  // quality term nearly constant, silently turning the lean into the only
  // thing that matters.
  const rating = c.total_rating ?? HARD_FLOOR_RATING
  const quality = clamp01((rating - HARD_FLOOR_RATING) / (100 - HARD_FLOOR_RATING))

  // Discovery peaks at the sweet spot and decays linearly toward both ends, so
  // "too famous" and "too obscure" are penalised on the same footing. Each side
  // is normalised by its own distance to the edge, so the peak sits at 1.0 and
  // both extremes reach 0 regardless of where the sweet spot is placed.
  const pct = clamp01(c.popularity_pct ?? 0.5)
  const spread = pct >= LEAN_SWEET_SPOT ? 1 - LEAN_SWEET_SPOT : LEAN_SWEET_SPOT
  const discovery = clamp01(1 - Math.abs(pct - LEAN_SWEET_SPOT) / (spread || 1))

  return {
    ...c,
    quality_score: quality,
    discovery_score: discovery,
    selection_score: (1 - LEAN_WEIGHT) * quality + LEAN_WEIGHT * discovery,
  }
}

/**
 * Weighted sample without replacement, favouring higher scores while still
 * exploring. Cubing the weight keeps the head of the shortlist strongly
 * preferred without making selection a pure sort (which would make every
 * activation of a theme identical until the no-repeat log forced a change).
 */
function weightedSample(
  candidates: ScoredCandidate[],
  count: number,
  rand: () => number,
  collectionCap: number,
): { picked: ScoredCandidate[]; cappedOut: number } {
  const remaining = [...candidates]
  const picked: ScoredCandidate[] = []
  const perCollection = new Map<number, number>()
  let cappedOut = 0

  while (picked.length < count && remaining.length > 0) {
    const weights = remaining.map((c) => Math.pow(c.selection_score + 0.05, 3))
    const total = weights.reduce((a, b) => a + b, 0)

    let target = rand() * total
    let idx = 0
    for (; idx < remaining.length; idx++) {
      target -= weights[idx]
      if (target <= 0) break
    }
    if (idx >= remaining.length) idx = remaining.length - 1

    const [chosen] = remaining.splice(idx, 1)

    // A game can belong to several collections; it is capped out if ANY of
    // them is already full, so a franchise cannot sneak in extra entries by
    // being filed under two series.
    const cols = chosen.collection_ids ?? []
    if (cols.some((id) => (perCollection.get(id) ?? 0) >= collectionCap)) {
      cappedOut++
      continue
    }
    for (const id of cols) perCollection.set(id, (perCollection.get(id) ?? 0) + 1)

    picked.push(chosen)
  }

  return { picked, cappedOut }
}

/**
 * Select the games for one scheduled drop.
 *
 * @param pool          every cached candidate
 * @param theme         the theme row (composition, drop_size, slug)
 * @param recentlyShown igdb ids inside the no-repeat window
 * @param seed          stable per-window seed (the schedule id)
 */
export function selectForDrop(
  pool: Candidate[],
  theme: { slug: string; composition: Composition; drop_size: number },
  recentlyShown: Set<number>,
  seed: string,
): SelectionResult {
  const compiled = compileComposition(theme.composition)
  const requested = theme.drop_size

  // (a) Hard floor. The pool is already built at this floor, so this is a
  // defensive re-check — it costs nothing and means a pool built by an older
  // job version can never leak a sub-floor game into a drop.
  const afterFloor = pool.filter(
    (c) =>
      (c.total_rating ?? 0) >= HARD_FLOOR_RATING &&
      (c.total_rating_count ?? 0) >= HARD_FLOOR_RATING_COUNT,
  )

  // The theme's own composition.
  const afterFilters = afterFloor.filter(compiled.test)

  // (c) No-repeat. Never relaxed.
  const afterNoRepeat = afterFilters.filter((c) => !recentlyShown.has(c.igdb_game_id))

  // (b) Balance lean, part 1: drop the most mainstream slice — unless doing so
  // would leave too little to fill the drop, in which case a famous game beats
  // an empty shelf.
  const cutCandidates = afterNoRepeat.filter((c) => (c.popularity_pct ?? 1) >= MAINSTREAM_CUT)
  const cutApplied = cutCandidates.length >= requested * 1.5
  const eligible = cutApplied ? cutCandidates : afterNoRepeat

  // (b) part 2: score, shortlist, sample.
  const scored = eligible.map(score).sort((a, b) => b.selection_score - a.selection_score)
  const shortlist = scored.slice(0, Math.max(requested * SHORTLIST_MULTIPLE, requested))

  const rand = mulberry32(hashString(seed))
  const { picked, cappedOut } = weightedSample(shortlist, requested, rand, MAX_PER_COLLECTION)

  // Present best-first before per-viewer taste ordering reorders them.
  picked.sort((a, b) => b.selection_score - a.selection_score)

  let note: string | null = null
  if (picked.length < requested) {
    note =
      `Selected ${picked.length} of ${requested} requested. Eligible after floor+filters+no-repeat: ` +
      `${afterNoRepeat.length}. The no-repeat window is never relaxed to pad a drop — ` +
      `if this recurs, the theme's pool is too thin for its rotation frequency.`
  } else if (!cutApplied && afterNoRepeat.length > 0) {
    note =
      `Mainstream cut skipped: only ${cutCandidates.length} candidates survived it ` +
      `(needed ${Math.ceil(requested * 1.5)}). Drop may skew more familiar than usual.`
  }

  return {
    games: picked,
    audit: {
      theme_slug: theme.slug,
      composition: compiled.description,
      pool_size: pool.length,
      after_floor: afterFloor.length,
      after_filters: afterFilters.length,
      after_no_repeat: afterNoRepeat.length,
      after_mainstream_cut: eligible.length,
      mainstream_cut_applied: cutApplied,
      collection_capped: cappedOut,
      requested,
      selected: picked.length,
      note,
    },
  }
}

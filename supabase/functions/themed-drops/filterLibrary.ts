// @ts-nocheck
// supabase/functions/themed-drops/filterLibrary.ts
//
// THE COMPOSABLE FILTER LIBRARY.
//
// A theme is not a query — it is a COMPOSITION of the primitives below,
// stored as data in public.drop_themes.composition. This module is the only
// place that knows how to evaluate a primitive, and it knows nothing about any
// specific theme: there is no branch here on "vampire_session" or "weekend".
//
// That is the whole point. Adding "Soulslike Sunday" tomorrow means inserting a
// drop_themes row that composes `genre` + `theme` + `rating_floor`. No code in
// this file changes, nothing redeploys. Only adding a NEW PRIMITIVE (a filter
// KIND that does not exist yet) requires touching this file — and then also a
// matching public.drop_filter_types row, which is what the database validates
// author compositions against.
//
// Keep FILTERS keyed identically to drop_filter_types.key. assertLibraryInSync()
// is called on every job run so the two can never silently drift apart.

export interface Candidate {
  igdb_game_id: number
  name: string | null
  total_rating: number | null
  total_rating_count: number | null
  release_year: number | null
  genre_ids: number[]
  genre_names: string[]
  theme_ids: number[]
  theme_names: string[]
  game_mode_ids: number[]
  /** IGDB `collections` — the franchise grouping, used for the franchise cap. */
  collection_ids: number[]
  /** IGDB game_time_to_beats.normally. NULL = IGDB publishes no time. */
  time_to_beat_seconds: number | null
  time_to_beat_count: number | null
  /** 0 = most mainstream in the pool, 1 = deepest cut. */
  popularity_pct: number
}

export interface FilterNode {
  type: string
  params: Record<string, unknown>
}

export interface Composition {
  all?: FilterNode[]
  any?: FilterNode[]
}

type Predicate = (c: Candidate) => boolean

interface FilterDef {
  /** Compiles params into a predicate once per selection, not once per game. */
  compile: (params: Record<string, unknown>) => Predicate
  /** Human-readable form of a configured filter, for the selection audit log. */
  describe: (params: Record<string, unknown>) => string
}

const HOUR_SECONDS = 3600

const asNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

const asIntArray = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []

/** Shared "does this id list overlap / cover" helper for the id-set filters. */
function idSetPredicate(
  values: number[],
  match: unknown,
  pick: (c: Candidate) => number[],
): Predicate {
  const wanted = new Set(values)
  const requireAll = String(match ?? 'any').toLowerCase() === 'all'

  if (requireAll) {
    return (c) => {
      const have = new Set(pick(c))
      for (const id of wanted) if (!have.has(id)) return false
      return true
    }
  }
  return (c) => pick(c).some((id) => wanted.has(id))
}

export const FILTERS: Record<string, FilterDef> = {
  // ── time_to_beat ──────────────────────────────────────────────────────────
  // Includes ONLY games with a real recorded IGDB completion time. A game with
  // no `normally` value is EXCLUDED, never estimated from genre, length of
  // description, or anything else. An unknown is not a match.
  //
  // This is why the three time-based themes have smaller pools than the rest
  // (measured: ~41% of the quality pool has a real time) — and it is the
  // correct trade. "Beat it in a weekend" that quietly includes a 60-hour RPG
  // because we guessed is worse than a smaller, honest drop.
  time_to_beat: {
    compile: (params) => {
      const minH = asNumber(params.min_hours)
      const maxH = asNumber(params.max_hours)
      const min = minH === null ? null : minH * HOUR_SECONDS
      const max = maxH === null ? null : maxH * HOUR_SECONDS

      return (c) => {
        const secs = c.time_to_beat_seconds
        if (secs === null || secs === undefined || secs <= 0) return false
        if (min !== null && secs < min) return false
        if (max !== null && secs > max) return false
        return true
      }
    },
    describe: (p) => {
      const lo = asNumber(p.min_hours)
      const hi = asNumber(p.max_hours)
      if (lo !== null && hi !== null) return `time to beat ${lo}-${hi}h`
      if (hi !== null) return `time to beat under ${hi}h`
      if (lo !== null) return `time to beat ${lo}h+`
      return 'has a recorded time to beat'
    },
  },

  // ── genre ─────────────────────────────────────────────────────────────────
  genre: {
    compile: (params) =>
      idSetPredicate(asIntArray(params.ids), params.match, (c) => c.genre_ids),
    describe: (p) =>
      `genre ${String(p.match ?? 'any')} of [${asIntArray(p.ids).join(', ')}]`,
  },

  // ── theme / mood ──────────────────────────────────────────────────────────
  theme: {
    compile: (params) =>
      idSetPredicate(asIntArray(params.ids), params.match, (c) => c.theme_ids),
    describe: (p) =>
      `theme ${String(p.match ?? 'any')} of [${asIntArray(p.ids).join(', ')}]`,
  },

  // ── release_window ────────────────────────────────────────────────────────
  // Same honesty rule as time_to_beat: if a bound is set and the game's release
  // year is unknown, it does not qualify.
  release_window: {
    compile: (params) => {
      const min = asNumber(params.min_year)
      const max = asNumber(params.max_year)
      const bounded = min !== null || max !== null

      return (c) => {
        const y = c.release_year
        if (!bounded) return true
        if (y === null || y === undefined) return false
        if (min !== null && y < min) return false
        if (max !== null && y > max) return false
        return true
      }
    },
    describe: (p) => {
      const lo = asNumber(p.min_year)
      const hi = asNumber(p.max_year)
      if (lo !== null && hi !== null) return `released ${lo}-${hi}`
      if (lo !== null) return `released ${lo} or later`
      if (hi !== null) return `released ${hi} or earlier`
      return 'any release year'
    },
  },

  // ── rating_floor ──────────────────────────────────────────────────────────
  // A theme-level floor layered ON TOP of the engine-wide hard floor, which is
  // applied separately in selection.ts and cannot be opted out of. Because both
  // are AND-combined, the effective floor is always the stricter of the two —
  // a theme can tighten quality but never loosen it.
  rating_floor: {
    compile: (params) => {
      const minRating = asNumber(params.min_rating) ?? 0
      const minCount = asNumber(params.min_rating_count) ?? 0
      return (c) =>
        (c.total_rating ?? 0) >= minRating &&
        (c.total_rating_count ?? 0) >= minCount
    },
    describe: (p) =>
      `rating >= ${asNumber(p.min_rating) ?? 0} with >= ${asNumber(p.min_rating_count) ?? 0} ratings`,
  },

  // ── multiplayer / co-op ───────────────────────────────────────────────────
  multiplayer: {
    compile: (params) =>
      idSetPredicate(asIntArray(params.modes), params.match, (c) => c.game_mode_ids),
    describe: (p) =>
      `game mode ${String(p.match ?? 'any')} of [${asIntArray(p.modes).join(', ')}]`,
  },
}

export class UnknownFilterError extends Error {
  constructor(type: string) {
    super(
      `Unknown filter type "${type}". Known types: ${Object.keys(FILTERS).join(', ')}. ` +
        `Adding a new primitive requires a handler in filterLibrary.ts AND a drop_filter_types row.`,
    )
    this.name = 'UnknownFilterError'
  }
}

export interface CompiledComposition {
  /** True when the candidate satisfies the whole composition. */
  test: Predicate
  /** Readable rendering of the composition, stored on the selection audit. */
  description: string
  filterCount: number
}

/**
 * Turn a stored composition into a single predicate.
 *
 * `all` filters are AND-combined. `any`, when present and non-empty, is an OR
 * group of which at least one member must pass — needed because real themes
 * are genuinely disjunctive ("strategy genres OR the 4X theme"), and without it
 * those would have to be hardcoded.
 *
 * Throws on an unknown filter type rather than skipping it. Silently ignoring
 * a filter would produce a drop that looks fine and is quietly wrong — a
 * "Couch co-op" drop full of single-player games. Failing loudly here surfaces
 * as selection_state='failed' on the schedule row, which is visible.
 */
export function compileComposition(composition: Composition): CompiledComposition {
  const allNodes = Array.isArray(composition?.all) ? composition.all : []
  const anyNodes = Array.isArray(composition?.any) ? composition.any : []

  if (allNodes.length === 0 && anyNodes.length === 0) {
    throw new Error('Composition has no filters — that would match the entire pool.')
  }

  const compile = (node: FilterNode) => {
    const def = FILTERS[node?.type]
    if (!def) throw new UnknownFilterError(node?.type)
    return {
      test: def.compile(node.params || {}),
      label: def.describe(node.params || {}),
    }
  }

  const alls = allNodes.map(compile)
  const anys = anyNodes.map(compile)

  const test: Predicate = (c) => {
    for (const f of alls) if (!f.test(c)) return false
    if (anys.length > 0) {
      let hit = false
      for (const f of anys) {
        if (f.test(c)) { hit = true; break }
      }
      if (!hit) return false
    }
    return true
  }

  const parts: string[] = []
  if (alls.length) parts.push(alls.map((f) => f.label).join(' AND '))
  if (anys.length) parts.push(`(${anys.map((f) => f.label).join(' OR ')})`)

  return {
    test,
    description: parts.join(' AND '),
    filterCount: alls.length + anys.length,
  }
}

/**
 * Fail fast if the DB registry and this module have drifted.
 *
 * The registry is what the database validates author compositions against, so
 * a type registered there but missing here would let the owner save a theme
 * that the engine then cannot evaluate — the exact "edited a row, drop broke on
 * Thursday" failure this design exists to prevent. Checked on every run.
 */
export function assertLibraryInSync(registryKeys: string[]): void {
  const code = new Set(Object.keys(FILTERS))
  const db = new Set(registryKeys)

  const missingInCode = [...db].filter((k) => !code.has(k))
  const missingInDb = [...code].filter((k) => !db.has(k))

  if (missingInCode.length) {
    throw new Error(
      `Filter library out of sync: drop_filter_types registers [${missingInCode.join(', ')}] ` +
        `but filterLibrary.ts has no handler. Themes using these would be unevaluatable.`,
    )
  }
  if (missingInDb.length) {
    console.warn(
      `[themed-drops] filterLibrary.ts implements [${missingInDb.join(', ')}] with no ` +
        `drop_filter_types row — authors cannot discover or safely use these yet.`,
    )
  }
}

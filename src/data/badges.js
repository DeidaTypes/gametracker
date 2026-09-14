import {
  Clock,
  Timer,
  Gem,
  MessageSquareText,
  BookOpen,
  Trophy,
  Flame,
  Scale,
  Image,
  Compass,
  CalendarCheck,
  Heart,
  Pickaxe,
  Banknote,
  Rocket,
  Layers,
  Bookmark,
  MessageCircle,
  Users,
  Siren,
  Sword,
  CalendarRange,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sunset,
  Palette,
  Sunrise,
} from 'lucide-react'

/**
 * Sprint 16 (S16-4) — the approved 32-badge catalogue.
 *
 * REPLACES the Sprint 5 P9 catalogue that used to live here (Reviewer /
 * Curator / Player / Explorer / Social — countBadge() over client-computed
 * useUserStats counters). That catalogue is retired, not extended:
 *   - Three of its names (Curator, Conversationalist, Backlog Slayer)
 *     reappear below in WAVE 3 under new, not-yet-instrumented definitions
 *     — they are NOT the same badges and do not inherit old progress.
 *   - Its "Backlog Slayer" scored current game_trackers.status, which is
 *     exactly what the new decoupling rule (see Finisher below) forbids.
 *   - Old earned rows in user_badges (badge_id like 'reviewer-10') are
 *     left alone — harmless, simply unreferenced by this file now.
 *     Backfill/migration of old earned state is explicitly out of scope
 *     (S16-4a).
 *
 * SHAPE CHANGE FROM SPRINT 5, PRESERVED CONTRACT:
 *   Every badge object still has the exact same shape existing UI
 *   consumers depend on — `icon`, `name`, `description`, `tier`, `target`,
 *   `progress(stats)`, `isEarned(stats)` — so BadgeDetailModal, BadgesRow,
 *   BadgeShowcase, UserBadgesPage, and BadgeReveal (all out of scope for
 *   this prompt — S16-5) need ZERO changes.
 *
 *   What DID change is what `stats` IS. It is no longer computed client
 *   side by useUserStats (20+ live queries) — it is now exactly the
 *   contents of one `select badge_id, tier, current_value from
 *   user_badges where user_id = X` query, reshaped by useBadges.js into
 *   `{ [familyId]: current_value, [familyId + '__tier']: tier }`. So
 *   `progress()` / `isEarned()` below are pure arithmetic against an
 *   already-persisted number — not a recomputation. See useBadges.js.
 *
 * Family ids (e.g. 'timekeeper') match the badge_id values written by
 * recompute_my_badges() in
 * supabase/migrations/20260914190930_badge_tiers_persistence.sql — do not
 * rename one side without the other.
 */

const clamp = (n, max) => Math.max(0, Math.min(Number(n) || 0, max))

const CLIENT_TIER_RANK = { bronze: 1, silver: 2, gold: 3, platinum: 4 }
const clientTierRank = (t) => CLIENT_TIER_RANK[t] || 0

/**
 * A WAVE 1 / WAVE 2 (shipped) badge family — three tiers, one row per
 * family in user_badges, computed server-side by recompute_my_badges().
 *
 * `isEarned` checks the PERSISTED tier (never regresses, per the "no
 * badge computed from current status" / "earned tiers survive later data
 * loss" rules), while `progress` reports the live current_value — the two
 * can disagree in an edge case (e.g. a tier earned, then the raw count
 * drops) and that is intentional: the tier stays earned, honestly, and
 * the progress bar shows the honest current number rather than a frozen
 * one.
 */
function tieredBadge({ id, name, description, icon, tiers, silent = false, wave }) {
  const tierNames = ['bronze', 'silver', 'gold']
  return tierNames.map((tierName, i) => ({
    id: `${id}-${tierName}`,
    family: id,
    category: 'sprint16',
    wave,
    silent,
    tier: tierName,
    name,
    description,
    icon,
    target: tiers[i],
    progress: (stats) => clamp(stats?.[id], tiers[i]),
    isEarned: (stats) => clientTierRank(stats?.[`${id}__tier`]) >= clientTierRank(tierName),
  }))
}

/**
 * A WAVE 3 (deferred) badge with a real, product-specified tier ladder
 * that could not ship because the underlying data does not exist yet, or
 * (Time Traveler / Short Stack / The Long Haul) exists for only part of
 * the user's finished games and would silently undercount the rest.
 * Definitions are kept so the shelf can show them; progress/isEarned are
 * hard-locked to "never earned" — there is no statKey to read.
 */
function deferredTieredBadge({ id, name, description, icon, tiers, blockedReason }) {
  const tierNames = ['bronze', 'silver', 'gold']
  return tierNames.map((tierName, i) => ({
    id: `${id}-${tierName}`,
    family: id,
    category: 'sprint16',
    wave: 3,
    silent: false,
    tier: tierName,
    name,
    description: `${description} (Coming soon.)`,
    icon,
    target: tiers[i],
    blockedReason,
    progress: () => 0,
    isEarned: () => false,
  }))
}

/**
 * A WAVE 3 badge with NO product-specified thresholds at all (the 16
 * named only, with no tier numbers, in the prompt). Rendered as a single
 * locked placeholder — no fabricated numbers.
 */
function deferredBadge({ id, name, description, icon, blockedReason }) {
  return [
    {
      id,
      family: id,
      category: 'sprint16',
      wave: 3,
      silent: false,
      tier: 'bronze',
      name,
      description: `${description} (Coming soon.)`,
      icon,
      target: 1,
      blockedReason,
      progress: () => 0,
      isEarned: () => false,
    },
  ]
}

export const BADGES = [
  // ── WAVE 1 — ships fully; data confirmed live against this project ──────
  ...tieredBadge({
    id: 'timekeeper',
    name: 'Timekeeper',
    description: 'Log play sessions.',
    icon: Clock,
    tiers: [25, 150, 500],
    wave: 1,
  }),
  ...tieredBadge({
    id: 'marathoner',
    name: 'Marathoner',
    description: 'Log a single play session this long.',
    icon: Timer,
    tiers: [4, 8, 12],
    wave: 1,
  }),
  ...tieredBadge({
    id: 'devoted',
    name: 'Devoted',
    description: 'Log this many total hours in one game.',
    icon: Gem,
    tiers: [50, 150, 400],
    wave: 1,
  }),
  ...tieredBadge({
    id: 'critic',
    name: 'Critic',
    description: 'Write reviews with an actual body.',
    icon: MessageSquareText,
    tiers: [10, 50, 200],
    wave: 1,
  }),
  ...tieredBadge({
    id: 'chronicler',
    name: 'Chronicler',
    description: 'Write diary entries with a note.',
    icon: BookOpen,
    tiers: [15, 75, 250],
    wave: 1,
  }),
  ...tieredBadge({
    id: 'finisher',
    name: 'Finisher',
    description: 'Finish games — counted from completion events, so deleting a tracker row can never take this away.',
    icon: Trophy,
    tiers: [10, 50, 150],
    wave: 1,
  }),
  ...tieredBadge({
    id: 'kept-the-fire',
    name: 'Kept the Fire',
    description: 'Reach a long streak, ever — reuses your best-ever streak, not today\u2019s.',
    icon: Flame,
    tiers: [7, 30, 100],
    wave: 1,
    // Collision rule: streak milestones (3/7/15/30/100 days) already
    // celebrate at day 7/30/100. This badge records and shows a tier the
    // same as any other — it just never fires its own celebration toast
    // (see useBadgeUnlockWatcher.js's `if (badge.silent) continue`).
    silent: true,
  }),

  // ── WAVE 2 — shipped after measuring query cost (see chat report) ───────
  ...tieredBadge({
    id: 'honest',
    name: 'Honest',
    description: 'Write reviews with words on games you rated under 3 stars.',
    icon: Scale,
    tiers: [5, 20, 60],
    wave: 2,
  }),
  ...tieredBadge({
    id: 'full-picture',
    name: 'Full Picture',
    description: 'Write diary entries with a mood, hours, and a note all present.',
    icon: Image,
    tiers: [10, 50, 150],
    wave: 2,
  }),
  ...tieredBadge({
    id: 'omnivore',
    name: 'Omnivore',
    description: 'Finish games across this many distinct genres.',
    icon: Compass,
    tiers: [5, 12, 20],
    wave: 2,
  }),
  ...tieredBadge({
    id: 'regular',
    name: 'Regular',
    description: 'Log a session in this many distinct calendar months.',
    icon: CalendarCheck,
    tiers: [3, 12, 24],
    wave: 2,
  }),
  ...tieredBadge({
    id: 'resonant',
    name: 'Resonant',
    description: 'Receive hearts on your reviews.',
    icon: Heart,
    tiers: [25, 150, 500],
    wave: 2,
  }),

  // ── WAVE 2 candidates MOVED to Wave 3 — real thresholds kept, but data
  //    coverage is incomplete (see chat report: only ~65% of finished
  //    games have a release year or a time-to-beat number cached anywhere
  //    in this project) or entirely absent (platforms) ─────────────────
  ...deferredTieredBadge({
    id: 'time-traveler',
    name: 'Time Traveler',
    description: 'Finish games across distinct release decades.',
    icon: CalendarRange,
    tiers: [3, 5, 7],
    blockedReason:
      'release_year exists only in drop_candidate_pool (Themed Drops\u2019 curated pool), which covers ~65% of a real user\u2019s finished games in this project — not every game. Needs a full per-game release-date cache, not the Drops-scoped one.',
  }),
  ...deferredTieredBadge({
    id: 'short-stack',
    name: 'Short Stack',
    description: 'Finish games with a completionist time under 5 hours.',
    icon: Layers,
    tiers: [5, 20, 60],
    blockedReason:
      'Same drop_candidate_pool coverage gap as Time Traveler, plus its time_to_beat_seconds is IGDB\u2019s general time-to-beat, not verified to be the "completionist" figure this definition specifies.',
  }),
  ...deferredTieredBadge({
    id: 'the-long-haul',
    name: 'The Long Haul',
    description: 'Finish games with a completionist time over 80 hours.',
    icon: Sword,
    tiers: [1, 3, 8],
    blockedReason: 'Same as Short Stack.',
  }),
  ...deferredTieredBadge({
    id: 'platform-nomad',
    name: 'Platform Nomad',
    description: 'Finish games across distinct platforms.',
    icon: Rocket,
    tiers: [3, 6, 10],
    blockedReason:
      'No table in this project caches per-game platforms at all (game_tags and drop_candidate_pool both cache genres/themes but never platforms). Needs a new IGDB-backed cache column before this can compute for anyone.',
  }),

  // ── WAVE 3 — deferred, no data source today, definitions kept for the
  //    shelf only. See chat report for the one-line instrumentation need
  //    behind each. ─────────────────────────────────────────────────────
  ...deferredBadge({
    id: 'prospector',
    name: 'Prospector',
    description: 'Discover a game before it\u2019s popular.',
    icon: Pickaxe,
    blockedReason: 'Needs a "discovery order" signal — when the user added/reviewed a game relative to when it crossed a popularity threshold. No such ranking or timing is captured today.',
  }),
  ...deferredBadge({
    id: 'paid-off',
    name: 'Paid Off',
    description: 'Finish a game that sat in your backlog a long time.',
    icon: Banknote,
    blockedReason: 'Partial data exists (activities has backlogged + status_changed/to_status=played timestamps for the same game), but the exact elapsed-time thresholds and tiers are not specified.',
  }),
  ...deferredBadge({
    id: 'early-adopter',
    name: 'Early Adopter',
    description: 'Play or review a game shortly after its release.',
    icon: Rocket,
    blockedReason: 'Needs each game\u2019s release_date compared to the activity timestamp. Release dates are not cached with full coverage anywhere in this project (see Time Traveler).',
  }),
  ...deferredBadge({
    id: 'deep-cut',
    name: 'Deep Cut',
    description: 'Play or review a very low-popularity game.',
    icon: Layers,
    blockedReason: 'drop_candidate_pool.popularity_rank/popularity_pct only cover the curated Drops pool, not every game a user might play — needs full-coverage popularity data.',
  }),
  ...deferredBadge({
    id: 'curator',
    name: 'Curator',
    description: 'Build lists people actually save.',
    icon: Bookmark,
    blockedReason: 'The old Sprint 5 "Curator" badge counted raw list count; this name is being redefined (list quality/saves?) and the new definition + thresholds are not specified yet.',
  }),
  ...deferredBadge({
    id: 'conversationalist',
    name: 'Conversationalist',
    description: 'Leave comments on reviews.',
    icon: MessageCircle,
    blockedReason: 'The old Sprint 5 badge counted a dead `comments` table (0 rows) via a localStorage shadow counter. Needs repointing to the live `review_comments` table plus new thresholds.',
  }),
  ...deferredBadge({
    id: 'circle',
    name: 'Circle',
    description: 'Build mutual connections with other players.',
    icon: Users,
    blockedReason: 'No defined "circle" concept (mutual follows? close-friends list?) or count thresholds specified yet.',
  }),
  ...deferredBadge({
    id: 'first-responder',
    name: 'First Responder',
    description: 'Be first to comment or react on a review.',
    icon: Siren,
    blockedReason: 'Needs "first by timestamp" ordering logic across review_comments/reactions with a defined count threshold — not implemented.',
  }),
  ...deferredBadge({
    id: 'backlog-slayer',
    name: 'Backlog Slayer',
    description: 'Clear a large backlog.',
    icon: Sword,
    blockedReason: 'The old Sprint 5 badge scored game_trackers.status directly, which the new decoupling rule forbids. Needs re-anchoring to completion EVENTS (like Finisher) with new thresholds.',
  }),
  ...deferredBadge({
    id: 'years-work',
    name: 'Year\u2019s Work',
    description: 'Hit your yearly game-count goal.',
    icon: CalendarRange,
    blockedReason: 'user_goals (yearly game-count challenges) exists, but the mapping from goal completion to a badge tier ladder is not specified.',
  }),
  ...deferredBadge({
    id: 'comeback',
    name: 'Comeback',
    description: 'Return to a dropped game and finish it.',
    icon: RotateCcw,
    blockedReason: 'Needs a "dropped, then later played" event-sequence detector over `activities` with a defined count threshold — not implemented.',
  }),
  ...deferredBadge({
    id: 'veteran',
    name: 'Veteran',
    description: 'Stick around.',
    icon: ShieldCheck,
    blockedReason: 'No anchor definition given (account age? total lifetime activity?) or thresholds specified.',
  }),
  ...deferredBadge({
    id: 'perfect-month',
    name: 'Perfect Month',
    description: 'Hit every tracked habit in one calendar month.',
    icon: Sparkles,
    blockedReason: '"Perfect" is undefined — which combination of session/review/diary/streak activity qualifies a month is not specified.',
  }),
  ...deferredBadge({
    id: 'weekender',
    name: 'Weekender',
    description: 'Play mostly on weekends.',
    icon: Sunset,
    blockedReason: 'play_sessions.played_on can support a weekend/weekday split, but the exact ratio or count thresholds are not specified.',
  }),
  ...deferredBadge({
    id: 'tastemaker',
    name: 'Tastemaker',
    description: 'Build a following around your taste.',
    icon: Palette,
    blockedReason: 'Explicitly gated on S16-10 per the sprint prompt — not this prompt\u2019s decision to make.',
  }),
  ...deferredBadge({
    id: 'dawn-patrol',
    name: 'Dawn Patrol',
    description: 'Play early in the morning, often.',
    icon: Sunrise,
    blockedReason: 'Explicitly gated on S16-10 per the sprint prompt — not this prompt\u2019s decision to make.',
  }),
]

/**
 * Tier metadata — `border` is the literal CSS value used for the 3px
 * circular border around the badge icon. Platinum is a metallic
 * linear-gradient masked via `border-image` (see BadgesRow.css). No
 * Sprint 16 badge currently reaches platinum (every ladder above is
 * bronze/silver/gold only) — this is kept for the modal/showcase CSS
 * classes that already branch on it, and in case a future tier is added.
 */
export const TIER_STYLES = {
  bronze:   { color: '#CD7F32' },
  silver:   { color: '#C0C0C0' },
  gold:     { color: '#FFD700' },
  platinum: {
    color: '#E5E4E2',
    gradient: 'linear-gradient(135deg, #E5E4E2, #B7C4CF, #E5E4E2)',
  },
}

/**
 * Convenience map for tier ordering — used by the full grid page when
 * we want earned badges sorted by prestige inside each section.
 */
export const TIER_RANK = { bronze: 0, silver: 1, gold: 2, platinum: 3 }

/** Full Sprint 16 catalogue size — used for "N of 32 earned" copy. */
export const BADGE_CATALOG_FAMILY_COUNT = 32

/** Families omitted from shelf / full-screen until S16-10. */
export const BADGE_SHELF_HIDDEN_FAMILIES = new Set(['tastemaker', 'dawn-patrol'])

/**
 * Six collapsible shelf categories for the profile teaser + full badges
 * screen. Every family in BADGES appears exactly once except
 * BADGE_SHELF_HIDDEN_FAMILIES.
 */
export const BADGE_SHELF_CATEGORIES = [
  {
    id: 'home-sessions',
    label: 'Home & Sessions',
    families: ['timekeeper', 'marathoner', 'devoted', 'kept-the-fire', 'regular', 'weekender'],
  },
  {
    id: 'reviews-diary',
    label: 'Reviews & Diary',
    families: ['critic', 'chronicler', 'honest', 'full-picture'],
  },
  {
    id: 'library',
    label: 'Library',
    families: [
      'finisher',
      'omnivore',
      'time-traveler',
      'short-stack',
      'the-long-haul',
      'platform-nomad',
      'backlog-slayer',
      'paid-off',
    ],
  },
  {
    id: 'discover',
    label: 'Discover',
    families: ['prospector', 'early-adopter', 'deep-cut'],
  },
  {
    id: 'community',
    label: 'Community',
    families: ['resonant', 'curator', 'conversationalist', 'circle', 'first-responder'],
  },
  {
    id: 'time-return',
    label: 'Time & Return',
    families: ['years-work', 'comeback', 'veteran', 'perfect-month'],
  },
]

const familyToCategoryLabel = (() => {
  const map = new Map()
  for (const cat of BADGE_SHELF_CATEGORIES) {
    for (const family of cat.families) {
      map.set(family, cat.label)
    }
  }
  return map
})()

/** Category heading for a badge family (celebration + full screen). */
export function getBadgeShelfCategoryLabel(familyId) {
  return familyToCategoryLabel.get(familyId) || null
}

/** Bronze-tier row for a family — the locked-state representative. */
export function getRepresentativeBadge(familyId) {
  return (
    BADGES.find((b) => b.family === familyId && b.tier === 'bronze')
    || BADGES.find((b) => b.family === familyId)
    || null
  )
}

/** Highest earned tier badge for a family, or null when locked. */
export function getHighestEarnedTierBadge(familyId, stats) {
  for (const tier of ['gold', 'silver', 'bronze']) {
    const badge = BADGES.find((b) => b.family === familyId && b.tier === tier)
    if (badge?.isEarned(stats)) return badge
  }
  return null
}

/** Distinct families with at least bronze earned. */
export function countEarnedBadgeFamilies(stats) {
  const seen = new Set()
  let count = 0
  for (const badge of BADGES) {
    if (seen.has(badge.family)) continue
    seen.add(badge.family)
    if (getHighestEarnedTierBadge(badge.family, stats)) count += 1
  }
  return count
}

/** Shelf-visible families in category order (hidden families excluded). */
export function getShelfVisibleFamilies() {
  return BADGE_SHELF_CATEGORIES.flatMap((cat) =>
    cat.families.filter((id) => !BADGE_SHELF_HIDDEN_FAMILIES.has(id))
  )
}

/**
 * Initial / empty stats object. Exported so consumers (and the unlock
 * watcher) can rely on a stable shape before async data resolves.
 *
 * Kept as an empty object (rather than the old per-counter shape) — every
 * Sprint 16 badge reads `stats[badge.family]` / `stats[badge.family +
 * '__tier']`, which are simply absent (undefined) until useBadges'
 * persisted-state query resolves; `clamp(undefined, target)` is 0 and
 * `clientTierRank(undefined)` is 0, so an empty object is already a
 * correct "nothing earned yet" baseline. Still exported because
 * src/hooks/useUserStats.js (kept for its still-used
 * bumpSharesCount/bumpCommentsCount localStorage helpers — see that file)
 * imports it for its own unrelated initial state.
 */
export const EMPTY_STATS = {}

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
  Zap,
  HandHelping,
} from 'lucide-react'

/**
 * Sprint 16 (S16-4) — the approved 32-badge catalogue.
 *
 * REPLACES the Sprint 5 P9 catalogue that used to live here (Reviewer /
 * Curator / Player / Explorer / Social — countBadge() over client-computed
 * useUserStats counters). That catalogue is retired, not extended:
 *   - Three of its names (Curator, Conversationalist, Backlog Slayer)
 *     reappear below under new definitions with no relation to the old
 *     ones — they are NOT the same badges and do not inherit old
 *     progress. Curator and Conversationalist shipped live in the
 *     Wave-3-to-live pass (see that section below); Backlog Slayer is
 *     still deferred (Wave 3).
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
function tieredBadge({ id, name, names, description, icon, tiers, silent = false, wave }) {
  const tierNames = ['bronze', 'silver', 'gold']
  return tierNames.map((tierName, i) => ({
    id: `${id}-${tierName}`,
    family: id,
    category: 'sprint16',
    wave,
    silent,
    tier: tierName,
    // `names` (optional) gives each tier its own title, bronze/silver/gold
    // order — e.g. Helper / Trusted Helper / Legend Helper. Every other
    // family keeps one name across its three tiers.
    name: names?.[i] || name,
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

  // ── WAVE 2 candidates that were MOVED to Wave 3 (Time Traveler, Short
  //    Stack, The Long Haul, Platform Nomad) and Early Adopter (originally
  //    a no-threshold Wave 3 placeholder) all shipped live together below,
  //    once game_tags widened with release date / time-to-beat / platforms
  //    and was backfilled across all 728 existing rows — see "FIVE BADGES
  //    ON THE WIDENED CACHE" further down. They are not re-declared here.

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
    id: 'backlog-slayer',
    name: 'Backlog Slayer',
    description: 'Clear a large backlog.',
    icon: Sword,
    blockedReason: 'The old Sprint 5 badge scored game_trackers.status directly, which the new decoupling rule forbids. Needs re-anchoring to completion EVENTS (like Finisher) with new thresholds.',
  }),
  ...deferredBadge({
    id: 'dawn-patrol',
    name: 'Dawn Patrol',
    description: 'Play early in the morning, often.',
    icon: Sunrise,
    blockedReason: 'Explicitly gated on S16-10 per the sprint prompt — not this prompt\u2019s decision to make.',
  }),

  // ── FIVE BADGES ON THE WIDENED CACHE (this prompt) — Time Traveler,
  //    Early Adopter, Short Stack, The Long Haul, Platform Nomad. Blocked
  //    since Wave 2/3 on missing game facts (release date, time-to-beat,
  //    platforms); unblocked now that game_tags carries all three,
  //    backfilled across all 728 existing rows (commit 7977dd4). Same RPC
  //    as every other family — recompute_my_badges() in
  //    supabase/migrations/20260915170000_five_badges_widened_cache.sql.
  //
  //    Coverage (this project's live data, see that migration's header
  //    for the query):
  //      - first_release_date / platform_ids: 79/79 finished games (100%)
  //        — Time Traveler and Platform Nomad need no caveat.
  //      - time_to_beat_completely_seconds: 53/79 finished games (67.1%)
  //        — Short Stack and The Long Haul's descriptions say so.
  //      - time_to_beat_normally_seconds is NEVER read by either TTB
  //        badge — completely (100%-completion) is the only flavor that
  //        matches "completionist time" in both definitions.
  //
  //    200-HOUR PLAUSIBILITY BOUND: time_to_beat_completely_seconds is
  //    bounded to 15min-200h (private.plausible_ttb_seconds() in that
  //    migration), matching supabase/functions/themed-drops/pool.ts's
  //    existing TTB_MIN_PLAUSIBLE_SECONDS/TTB_MAX_PLAUSIBLE_SECONDS. A
  //    value outside that range (Star Citizen: 99,999h; League of
  //    Legends: 14,452h; also WoW/Minecraft/GTA V/CS:GO/Fortnite — 9 of
  //    them land in finished-game data in this project) is treated as
  //    UNKNOWN, never as a very long completion — so a game like GTA V
  //    cannot back into The Long Haul off an IGDB sentinel/live-service
  //    artifact.
  ...tieredBadge({
    id: 'time-traveler',
    name: 'Time Traveler',
    description: 'Finish games across distinct release decades.',
    icon: CalendarRange,
    tiers: [3, 5, 7],
    wave: 5,
  }),
  ...tieredBadge({
    id: 'early-adopter',
    name: 'Early Adopter',
    description: 'Play or review games within 30 days of their release.',
    icon: Zap,
    tiers: [3, 15, 40],
    wave: 5,
  }),
  ...tieredBadge({
    id: 'short-stack',
    name: 'Short Stack',
    description:
      'Finish games with a completionist time under 5 hours, from games with a known completion time.',
    icon: Layers,
    tiers: [5, 20, 60],
    wave: 5,
  }),
  ...tieredBadge({
    id: 'the-long-haul',
    name: 'The Long Haul',
    description:
      'Finish games with a completionist time over 80 hours, from games with a known completion time.',
    icon: Sword,
    tiers: [1, 3, 8],
    wave: 5,
  }),
  ...tieredBadge({
    id: 'platform-nomad',
    name: 'Platform Nomad',
    description: 'Finish games across distinct platforms.',
    icon: Rocket,
    tiers: [3, 6, 10],
    wave: 5,
  }),

  // ── WAVE 3 -> LIVE (this prompt) — a read-only diagnosis confirmed all
  //    eleven of these are computable today from EXISTING tables (no
  //    schema change, no new write path). Server-side computation lives
  //    in recompute_my_badges() —
  //    supabase/migrations/20260915120000_wave3_eleven_badges_live.sql —
  //    same RPC as every Wave 1/2 family above. Descriptions below
  //    describe what each ACTUALLY measures now; several of the Wave 3
  //    placeholders above were written against a different (and in
  //    Conversationalist/Deep Cut's case, wrong-table) assumption. ──────
  ...tieredBadge({
    id: 'circle',
    name: 'Circle',
    description: 'Build mutual connections — people who follow you back.',
    icon: Users,
    tiers: [3, 15, 50],
    wave: 4,
  }),
  ...tieredBadge({
    id: 'conversationalist',
    name: 'Conversationalist',
    description: 'Leave comments on other players\u2019 reviews.',
    icon: MessageCircle,
    tiers: [10, 50, 200],
    wave: 4,
  }),
  ...tieredBadge({
    id: 'first-responder',
    name: 'First Responder',
    description: 'Be the first to comment on someone else\u2019s review or pulse post.',
    icon: Siren,
    tiers: [5, 25, 100],
    wave: 4,
  }),
  ...tieredBadge({
    id: 'curator',
    name: 'Curator',
    description: 'Get saves on lists you built.',
    icon: Bookmark,
    tiers: [5, 25, 100],
    wave: 4,
  }),
  ...tieredBadge({
    id: 'tastemaker',
    name: 'Tastemaker',
    description: 'Build a following of people who genuinely share your taste — over 70% match.',
    icon: Palette,
    tiers: [3, 15, 50],
    wave: 4,
  }),
  ...tieredBadge({
    id: 'years-work',
    name: 'Year\u2019s Work',
    description: 'Hit your yearly game-count goal — lifetime, across every year.',
    icon: CalendarRange,
    tiers: [1, 2, 3],
    wave: 4,
  }),
  ...tieredBadge({
    id: 'comeback',
    name: 'Comeback',
    description: 'Return to a game you dropped and finish it.',
    icon: RotateCcw,
    tiers: [1, 5, 15],
    wave: 4,
  }),
  ...tieredBadge({
    id: 'veteran',
    name: 'Veteran',
    description: 'Stick around — full account-years with at least one logged session.',
    icon: ShieldCheck,
    tiers: [1, 2, 3],
    wave: 4,
  }),
  ...tieredBadge({
    id: 'weekender',
    name: 'Weekender',
    description: 'Log play sessions on weekends.',
    icon: Sunset,
    tiers: [10, 50, 150],
    wave: 4,
  }),
  ...tieredBadge({
    id: 'perfect-month',
    name: 'Perfect Month',
    description: 'Log a session on every single day of a calendar month.',
    icon: Sparkles,
    tiers: [1, 3, 12],
    wave: 4,
  }),
  // ── Q&A — a best answer is one the ASKER picked. Counted server-side by
  //    private.sync_helper_badge() (supabase/migrations/20261026100000_
  //    helper_badge.sql), which updates the ANSWERER's row when the pick
  //    happens. Each tier has its own title. ─────────────────────────────
  ...tieredBadge({
    id: 'helper',
    name: 'Helper',
    names: ['Helper', 'Trusted Helper', 'Legend Helper'],
    description: 'Have your answers picked as the best answer to a question.',
    icon: HandHelping,
    tiers: [1, 10, 50],
    wave: 4,
  }),
  ...tieredBadge({
    id: 'deep-cut',
    name: 'Deep Cut',
    description: 'Finish games most people have never heard of — under 50 IGDB ratings.',
    icon: Layers,
    tiers: [3, 12, 35],
    wave: 4,
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

/** Full Sprint 16 catalogue size — used for "N of 33 earned" copy. */
export const BADGE_CATALOG_FAMILY_COUNT = 33

/**
 * Families omitted from shelf / full-screen until S16-10.
 * Tastemaker shipped live in the Wave-3-to-live pass (this prompt) — it
 * is no longer gated, despite the still-accurate "gated on S16-10" note
 * on Dawn Patrol below (Dawn Patrol was not part of that pass).
 */
export const BADGE_SHELF_HIDDEN_FAMILIES = new Set(['dawn-patrol'])

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
    families: ['resonant', 'curator', 'conversationalist', 'circle', 'first-responder', 'tastemaker', 'helper'],
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

import {
  Edit3,
  BookOpen,
  Star,
  Crown,
  ListPlus,
  Bookmark,
  Library,
  Gamepad2,
  Target,
  Trophy,
  Award,
  Compass,
  Heart,
  MessageCircle,
  Share2,
} from 'lucide-react'

/**
 * Sprint 5 P9 — Badge catalogue.
 *
 * Pure data + pure functions. Nothing here touches React, the network,
 * or localStorage directly — the consuming hooks (useUserStats / useBadges)
 * own all data sourcing so badges can be unit-tested in isolation and
 * Sprint 6's Supabase-backed counters can swap in transparently.
 *
 * Each badge contributes a `progress(stats)` and `isEarned(stats)` callback
 * so adding new badges is a pure data change. Use `clamp` to bound progress
 * at the badge's `target` — the detail modal renders `progress / target` and
 * we never want progress to read "120 / 100".
 */

const clamp = (n, max) => Math.max(0, Math.min(Number(n) || 0, max))

/**
 * Helper for "count threshold" badges (the common case): earn when the
 * stat reaches `target`, otherwise progress = current value (capped).
 */
function countBadge({ id, category, tier, name, description, icon, statKey, target }) {
  return {
    id,
    category,
    tier,
    name,
    description,
    icon,
    target,
    progress: (stats) => clamp(stats?.[statKey], target),
    isEarned: (stats) => (Number(stats?.[statKey]) || 0) >= target,
  }
}

export const BADGES = [
  // ── Reviewer ────────────────────────────────────────────────────────────
  countBadge({
    id: 'reviewer-1',
    category: 'reviewer',
    tier: 'bronze',
    name: 'First Review',
    description: 'Post your first review.',
    icon: Edit3,
    statKey: 'reviewsCount',
    target: 1,
  }),
  countBadge({
    id: 'reviewer-10',
    category: 'reviewer',
    tier: 'silver',
    name: 'Critic in Training',
    description: 'Post 10 reviews.',
    icon: BookOpen,
    statKey: 'reviewsCount',
    target: 10,
  }),
  countBadge({
    id: 'reviewer-50',
    category: 'reviewer',
    tier: 'gold',
    name: 'Veteran Critic',
    description: 'Post 50 reviews.',
    icon: Star,
    statKey: 'reviewsCount',
    target: 50,
  }),
  countBadge({
    id: 'reviewer-250',
    category: 'reviewer',
    tier: 'platinum',
    name: 'Legendary Critic',
    description: 'Post 250 reviews.',
    icon: Crown,
    statKey: 'reviewsCount',
    target: 250,
  }),

  // ── Curator ─────────────────────────────────────────────────────────────
  countBadge({
    id: 'curator-1',
    category: 'curator',
    tier: 'bronze',
    name: 'Listmaker',
    description: 'Create your first list.',
    icon: ListPlus,
    statKey: 'listsCount',
    target: 1,
  }),
  countBadge({
    id: 'curator-5',
    category: 'curator',
    tier: 'silver',
    name: 'Curator',
    description: 'Create 5 lists.',
    icon: Bookmark,
    statKey: 'listsCount',
    target: 5,
  }),
  countBadge({
    id: 'curator-20',
    category: 'curator',
    tier: 'gold',
    name: 'Master Curator',
    description: 'Create 20 lists.',
    icon: Library,
    statKey: 'listsCount',
    target: 20,
  }),

  // ── Player ──────────────────────────────────────────────────────────────
  countBadge({
    id: 'player-5',
    category: 'player',
    tier: 'bronze',
    name: 'Completionist Initiate',
    description: 'Mark 5 games as Played.',
    icon: Gamepad2,
    statKey: 'playedCount',
    target: 5,
  }),
  countBadge({
    id: 'player-25',
    category: 'player',
    tier: 'silver',
    name: 'Game Buff',
    description: 'Mark 25 games as Played.',
    icon: Target,
    statKey: 'playedCount',
    target: 25,
  }),
  countBadge({
    id: 'player-100',
    category: 'player',
    tier: 'gold',
    name: 'Backlog Slayer',
    description: 'Mark 100 games as Played.',
    icon: Trophy,
    statKey: 'playedCount',
    target: 100,
  }),
  countBadge({
    id: 'player-500',
    category: 'player',
    tier: 'platinum',
    name: 'Game Sage',
    description: 'Mark 500 games as Played.',
    icon: Award,
    statKey: 'playedCount',
    target: 500,
  }),

  // ── Explorer ────────────────────────────────────────────────────────────
  countBadge({
    id: 'explorer-genres-10',
    category: 'explorer',
    tier: 'bronze',
    name: 'Genre Hopper',
    description: 'Play games from 10 different genres.',
    icon: Compass,
    statKey: 'distinctGenresCount',
    target: 10,
  }),
  countBadge({
    id: 'explorer-indie-20',
    category: 'explorer',
    tier: 'silver',
    name: 'Indie Champion',
    description: 'Play 20 indie-tagged games.',
    icon: Heart,
    statKey: 'indiePlayedCount',
    target: 20,
  }),

  // ── Social ──────────────────────────────────────────────────────────────
  countBadge({
    id: 'social-comments-5',
    category: 'social',
    tier: 'bronze',
    name: 'Conversationalist',
    description: 'Leave 5 comments on reviews.',
    icon: MessageCircle,
    statKey: 'commentsCount',
    target: 5,
  }),
  countBadge({
    id: 'social-share-1',
    category: 'social',
    tier: 'bronze',
    name: 'Shareholder',
    description: 'Share a review with someone.',
    icon: Share2,
    statKey: 'sharesCount',
    target: 1,
  }),
]

/**
 * Tier metadata — `border` is the literal CSS value used for the 3px
 * circular border around the badge icon. Platinum is a metallic
 * linear-gradient masked via `border-image` (see BadgesRow.css).
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

/**
 * Initial / empty stats object. Exported so consumers (and the unlock
 * watcher) can rely on a stable shape before async data resolves.
 */
export const EMPTY_STATS = {
  reviewsCount: 0,
  listsCount: 0,
  playedCount: 0,
  distinctGenresCount: 0,
  indiePlayedCount: 0,
  commentsCount: 0,
  sharesCount: 0,
}

import {
  TIER_RANK,
  getBadgeShelfCategoryLabel,
} from '../data/badges'

const TIER_RING_COLOR = {
  bronze: 'var(--tier-bronze)',
  silver: 'var(--tier-silver)',
  gold: 'var(--tier-gold)',
}

const TIER_LABEL = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
}

const SINGLE_RING_COLOR = {
  app: 'var(--accent)',
  review: 'var(--accent-review)',
  social: 'var(--accent-journal)',
}

const SINGLE_TIER_LABEL = {
  1: 'Easy',
  2: 'Medium',
  3: 'Hard',
}

/**
 * Celebration copy with the earned tier's real threshold substituted in.
 * Keys match badge `family` ids from src/data/badges.js.
 */
const CELEBRATION_DESCRIPTION = {
  timekeeper: (n) => `Log ${n} play sessions.`,
  marathoner: (n) => `Log a single play session ${n} hours long.`,
  devoted: (n) => `Log ${n} total hours in one game.`,
  critic: (n) => `Write ${n} reviews with an actual body.`,
  chronicler: (n) => `Write ${n} diary entries with a note.`,
  finisher: (n) =>
    `Finish ${n} games — counted from completion events, so deleting a tracker row can never take this away.`,
  'kept-the-fire': (n) =>
    `Reach a ${n}-day streak, ever — reuses your best-ever streak, not today\u2019s.`,
  honest: (n) => `Write ${n} reviews with words on games you rated under 3 stars.`,
  'full-picture': (n) =>
    `Write ${n} diary entries with a mood, hours, and a note all present.`,
  omnivore: (n) => `Finish games across ${n} distinct genres.`,
  regular: (n) => `Log a session in ${n} distinct calendar months.`,
  resonant: (n) => `Receive ${n} hearts on your reviews.`,
  'time-traveler': (n) => `Finish games across ${n} distinct release decades.`,
  'short-stack': (n) => `Finish ${n} games with a completionist time under 5 hours.`,
  'the-long-haul': (n) => `Finish ${n} games with a completionist time over 80 hours.`,
  'platform-nomad': (n) => `Finish games across ${n} distinct platforms.`,
  prospector: (n) => `Discover ${n} games before they\u2019re popular.`,
  'paid-off': (n) => `Finish ${n} games that sat in your backlog a long time.`,
  'early-adopter': (n) => `Play or review ${n} games shortly after their release.`,
  'deep-cut': (n) => `Play or review ${n} very low-popularity games.`,
  curator: (n) => `Build ${n} lists people actually save.`,
  conversationalist: (n) => `Leave ${n} comments on reviews.`,
  circle: (n) => `Build ${n} mutual connections with other players.`,
  'first-responder': (n) => `Be first to comment or react on ${n} reviews.`,
  'backlog-slayer': (n) => `Clear ${n} games from your backlog.`,
  'years-work': (n) => `Hit your yearly game-count goal ${n} ${n === 1 ? 'time' : 'times'}.`,
  comeback: (n) => `Return to ${n} dropped games and finish them.`,
  veteran: (n) => `Stick around for ${n} ${n === 1 ? 'year' : 'years'}.`,
  'perfect-month': (n) => `Hit every tracked habit in ${n} calendar ${n === 1 ? 'month' : 'months'}.`,
  weekender: (n) => `Play mostly on weekends for ${n} tracked ${n === 1 ? 'month' : 'months'}.`,
}

export function buildBadgeCelebrationDescription(badge) {
  const formatter = CELEBRATION_DESCRIPTION[badge.family]
  if (formatter) return formatter(badge.target)
  return badge.description.replace(' (Coming soon.)', '')
}

/**
 * Props bundle for UnlockCelebration when a badge tier unlock fires.
 */
export function buildBadgeCelebrationProps(badge) {
  if (badge.kind === 'single') {
    const level = badge.level
    return {
      Icon: badge.icon,
      ringColor: SINGLE_RING_COLOR[badge.accent] || 'var(--accent)',
      tierLabel: SINGLE_TIER_LABEL[level] || null,
      eyebrow: 'Badge unlocked',
      title: badge.name,
      category: getBadgeShelfCategoryLabel(badge.family),
      description: badge.description,
      progressDots: { total: 3, filled: level },
      shareTitle: `${badge.name} badge on Checkpoint`,
      shareText: `I just earned ${badge.name} on Checkpoint!`,
    }
  }

  const tierRank = TIER_RANK[badge.tier] ?? 0
  const tierName = TIER_LABEL[badge.tier] || badge.tier

  return {
    Icon: badge.icon,
    ringColor: TIER_RING_COLOR[badge.tier] || 'var(--accent)',
    tierLabel: tierName,
    eyebrow: 'Badge unlocked',
    title: badge.name,
    category: getBadgeShelfCategoryLabel(badge.family),
    description: buildBadgeCelebrationDescription(badge),
    progressDots: { total: 3, filled: tierRank + 1 },
    shareTitle: `${badge.name} badge on Checkpoint`,
    shareText: `I just earned ${tierName} ${badge.name} on Checkpoint!`,
  }
}

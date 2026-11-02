import { BADGES } from './badges'

/**
 * Player Level math. Mirrors private.level_for() in
 * supabase/migrations/20261030220000_player_level_xp.sql:
 * level n starts at 100(n-1) + 25(n-1)(n-2), capped at 50.
 * The database is the only writer of XP. This file only describes it.
 */

export const MAX_LEVEL = 50

/** XP at which level n starts. Level 1 starts at 0. */
export function xpForLevel(n) {
  return 100 * (n - 1) + 25 * (n - 1) * (n - 2)
}

/** Highest level (1–50) whose start is still <= xp. */
export function levelForXp(xp) {
  const safe = Math.max(0, Math.floor(Number(xp) || 0))
  let level = 1
  for (let n = 2; n <= MAX_LEVEL; n += 1) {
    if (xpForLevel(n) <= safe) level = n
    else break
  }
  return level
}

/**
 * Where `xp` sits inside its level.
 * nextLevelXp is null at 50. fraction is 1 at 50.
 */
export function levelProgress(xp) {
  const safe = Math.max(0, Math.floor(Number(xp) || 0))
  const level = levelForXp(safe)
  const levelStartXp = xpForLevel(level)
  const isMax = level >= MAX_LEVEL
  const nextLevelXp = isMax ? null : xpForLevel(level + 1)
  const intoLevel = safe - levelStartXp
  const levelCost = isMax ? 0 : nextLevelXp - levelStartXp
  const toNext = isMax ? 0 : Math.max(0, nextLevelXp - safe)
  let fraction = 1
  if (!isMax) {
    fraction = levelCost > 0 ? intoLevel / levelCost : 0
    if (fraction < 0) fraction = 0
    else if (fraction > 1) fraction = 1
  }
  return {
    level,
    levelStartXp,
    nextLevelXp,
    intoLevel,
    levelCost,
    toNext,
    fraction,
    isMax,
  }
}

export const RANKS = Object.freeze([
  { name: 'Rookie', min: 1, max: 4 },
  { name: 'Player', min: 5, max: 9 },
  { name: 'Pro', min: 10, max: 19 },
  { name: 'Elite', min: 20, max: 29 },
  { name: 'Master', min: 30, max: 49 },
  { name: 'Legend', min: 50, max: 50 },
])

/** Rank covering this level. Out-of-range levels clamp into 1–50. */
export function rankFor(level) {
  const n = Math.min(MAX_LEVEL, Math.max(1, Math.floor(Number(level) || 1)))
  return RANKS.find((rank) => n >= rank.min && n <= rank.max) || RANKS[0]
}

export const LEVEL_REWARDS = Object.freeze([
  { level: 2, name: 'Avatar rings', detail: 'Cobalt, Mint and Violet rings', short: 'unlocks avatar rings' },
  { level: 3, name: 'Title slot', detail: 'Show one earned badge under your name', short: 'unlocks a title for your name' },
  { level: 5, name: 'Streak Freeze', detail: 'Miss a day without losing your streak (holds 1)', short: 'unlocks a Streak Freeze' },
  { level: 7, name: 'Glow ring', detail: 'A soft glow behind your ring', short: 'unlocks the Glow ring' },
  { level: 10, name: 'Favorites frames', detail: 'Gold edge and Glow frames for your 4 favorites', short: 'unlocks favorites frames' },
  { level: 12, name: 'Second Streak Freeze', detail: 'Hold 2 at once', short: 'unlocks a second Streak Freeze' },
  { level: 15, name: 'App icons', detail: '3 alternate Checkpoint icons for your home screen', short: 'unlocks App icons' },
  { level: 18, name: 'Gold ring', detail: 'The star gold, around your avatar', short: 'unlocks the Gold ring' },
  { level: 20, name: 'Elite rank + Holo frame', detail: 'A shimmering frame for your favorites', short: 'unlocks the Holo frame' },
  { level: 25, name: 'Custom title', detail: 'Write your own title', short: 'unlocks a custom title' },
  { level: 30, name: 'Prism ring', detail: 'A ring in all three accent colors', short: 'unlocks the Prism ring' },
  { level: 35, name: 'App icons, set 2', detail: '3 more icons', short: 'unlocks more App icons' },
  { level: 40, name: 'Animated ring', detail: 'Your ring slowly turns', short: 'unlocks the Animated ring' },
  { level: 50, name: 'Legend', detail: 'Legend rank, a Legend ring and the Legend title', short: 'unlocks Legend' },
])

/** The reward granted exactly at this level, or null. */
export function rewardAt(level) {
  return LEVEL_REWARDS.find((reward) => reward.level === level) || null
}

/** Rewards with level in (fromExclusive, toInclusive]. */
export function rewardsBetween(fromExclusive, toInclusive) {
  const from = Number(fromExclusive)
  const to = Number(toInclusive)
  return LEVEL_REWARDS.filter((reward) => reward.level > from && reward.level <= to)
}

/** The next `count` rewards strictly above `level`. */
export function nextRewards(level, count) {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  if (n === 0) return []
  return LEVEL_REWARDS.filter((reward) => reward.level > level).slice(0, n)
}

const TIER_WORD = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' }

// Streak XP refs are milestone day counts (user_streak_milestones.milestone_days).
const STREAK_NAME = { 3: 'Spark', 7: 'Ember', 15: 'Kindled', 30: 'Blaze', 100: 'Wildfire' }

function badgeName(ref) {
  const id = String(ref ?? '')
  if (!id) return ''
  const exact = BADGES.find((badge) => badge.id === id)
  if (exact?.name) return exact.name
  const family = BADGES.find((badge) => badge.family === id)
  return family?.name || ''
}

/** tier refs are "{familyId}:{bronze|silver|gold}". */
function tierPhrase(ref) {
  const raw = String(ref ?? '')
  const cut = raw.lastIndexOf(':')
  if (cut <= 0) return ''
  const family = raw.slice(0, cut)
  const tier = raw.slice(cut + 1)
  const word = TIER_WORD[tier] || ''
  const badge = BADGES.find((item) => item.family === family && item.tier === tier)
    || BADGES.find((item) => item.id === family || item.family === family)
  return [badge?.name, word].filter(Boolean).join(' ')
}

function streakPhrase(ref) {
  return STREAK_NAME[Number(ref)] || ''
}

/**
 * Recent XP copy, keyed by xp_events.source.
 * badge / tier / streak are functions of the row's ref: badge id, "id:tier",
 * or the streak's day count. Everything else is a fixed line.
 * Call xpSourceLabel(source, ref) — don't render a function entry directly.
 */
export const XP_SOURCE_LABELS = Object.freeze({
  session: 'Session logged',
  started: 'Started a game',
  finished: 'Finished a game',
  backlog: 'Added to Backlog',
  rate: 'Rated a game',
  review: 'Review posted',
  journal: 'Journal entry',
  list: 'Made a list',
  qa_answer: 'Answered a question',
  qa_best: 'Best answer picked',
  qa_ask: 'Asked a question',
  heart_given: 'Hearted a post',
  heart_received: 'Heart on your post',
  comment: 'Comment',
  follow: 'Followed a player',
  badge(ref) {
    const name = badgeName(ref)
    return name ? `Badge \u00b7 ${name}` : 'Badge'
  },
  tier(ref) {
    const phrase = tierPhrase(ref)
    return phrase ? `Badge \u00b7 ${phrase}` : 'Badge'
  },
  streak(ref) {
    const name = streakPhrase(ref)
    return name ? `Streak \u00b7 ${name}` : 'Streak'
  },
  challenge: 'Yearly Challenge',
})

/** One line for a Recent XP row. Unknown sources return ''. */
export function xpSourceLabel(source, ref) {
  const entry = XP_SOURCE_LABELS[source]
  if (typeof entry === 'function') return entry(ref)
  return entry || ''
}

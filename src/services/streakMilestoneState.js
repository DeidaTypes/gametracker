import { hasFreezeAvailable } from './streakMilestoneService'
import { toLocalDateKey } from './statsService'

/**
 * Streak milestone state (S16-2).
 *
 * Single source of truth for tier names, ladder progress, celebration
 * props, and at-risk detection. UI surfaces (Home strip, detail sheet,
 * UnlockCelebration) read from here — they do not re-derive tiers.
 */

export const STREAK_TIERS = Object.freeze([
  { days: 3, name: 'Spark', ringColor: 'var(--streak-tier-spark)' },
  { days: 7, name: 'Ember', ringColor: 'var(--streak-tier-ember)' },
  { days: 15, name: 'Kindled', ringColor: 'var(--streak-tier-kindled)' },
  { days: 30, name: 'Blaze', ringColor: 'var(--streak-tier-blaze)' },
  { days: 100, name: 'Wildfire', ringColor: 'var(--streak-tier-wildfire)' },
])

export const STREAK_MILESTONE_DAYS = STREAK_TIERS.map((t) => t.days)

const TIER_BY_DAYS = new Map(STREAK_TIERS.map((t) => [t.days, t]))

function todayLocalStr() {
  return toLocalDateKey(new Date())
}

function yesterdayLocalStr() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return toLocalDateKey(d)
}

/**
 * Rolling 7-day calendar cells (oldest → today), same shape the old
 * Home streak strip used.
 */
export function buildRollingWeekCells(dateCounts) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const SHORT_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const cells = []

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key = toLocalDateKey(d)
    cells.push({
      key,
      dayLabel: SHORT_DAYS[d.getDay()],
      active: (dateCounts?.get(key) ?? 0) > 0,
      isToday: i === 0,
    })
  }

  return cells
}

/** Highest tier the user has reached at `currentStreak` days. */
export function getCurrentTier(currentStreak) {
  let tier = null
  for (const t of STREAK_TIERS) {
    if (currentStreak >= t.days) tier = t
  }
  return tier
}

/** Next tier above `currentStreak`, or null at Wildfire. */
export function getNextTier(currentStreak) {
  return STREAK_TIERS.find((t) => currentStreak < t.days) ?? null
}

/**
 * Ladder row for the detail sheet: done / next / locked.
 */
export function buildStreakLadder(currentStreak) {
  const next = getNextTier(currentStreak)
  return STREAK_TIERS.map((tier) => {
    let status = 'locked'
    if (currentStreak >= tier.days) status = 'done'
    else if (next?.days === tier.days) status = 'next'
    return { ...tier, status }
  })
}

/**
 * Full read-model for streak UI surfaces.
 *
 * @param {{ streakData: object|null, weekCells: Array }} input
 */
export function buildStreakMilestoneView({ streakData, weekCells = [] }) {
  const currentStreak = streakData?.current_streak ?? 0
  const longestStreak = streakData?.longest_streak ?? 0
  const lastActiveDate = streakData?.last_active_date ?? null
  const today = todayLocalStr()
  const loggedToday = lastActiveDate === today

  const currentTier = getCurrentTier(currentStreak)
  const nextTier = getNextTier(currentStreak)

  let daysToNextTier = null
  let progressToNext = 0

  if (nextTier) {
    daysToNextTier = nextTier.days - currentStreak
    const bandStart = currentTier?.days ?? 0
    const bandEnd = nextTier.days
    const span = bandEnd - bandStart
    progressToNext = span > 0
      ? Math.min(1, Math.max(0, (currentStreak - bandStart) / span))
      : 0
  } else if (currentTier) {
    progressToNext = 1
  }

  const isAtRisk =
    currentStreak >= 7 &&
    !loggedToday &&
    currentStreak > 0 &&
    lastActiveDate === yesterdayLocalStr()

  const tiersAchieved = STREAK_TIERS.filter((t) => currentStreak >= t.days).length

  return {
    currentStreak,
    longestStreak,
    lastActiveDate,
    loggedToday,
    currentTier,
    nextTier,
    daysToNextTier,
    progressToNext,
    ladder: buildStreakLadder(currentStreak),
    weekCells,
    hasRestDayShield: hasFreezeAvailable(streakData),
    isAtRisk,
    tiersAchieved,
    hasStreak: currentStreak > 0,
  }
}

/**
 * Props bundle for UnlockCelebration when a streak milestone fires.
 */
export function buildStreakCelebrationProps(milestoneDays, currentStreak) {
  const tier = TIER_BY_DAYS.get(milestoneDays)
  if (!tier) return null

  const tiersAchieved = STREAK_TIERS.filter((t) => currentStreak >= t.days).length

  return {
    icon: 'flame',
    ringColor: tier.ringColor,
    tierLabel: tier.name,
    eyebrow: 'Streak milestone',
    title: `${milestoneDays}-day streak`,
    category: tier.name,
    description: streakCelebrationCopy(milestoneDays),
    progressDots: { total: STREAK_TIERS.length, filled: tiersAchieved },
    shareTitle: `${milestoneDays}-day streak on Checkpoint`,
    shareText: `I just hit ${tier.name} — a ${milestoneDays}-day gaming streak on Checkpoint!`,
  }
}

function streakCelebrationCopy(days) {
  switch (days) {
    case 3:
      return 'Three days in a row — the spark is lit.'
    case 7:
      return 'A whole week of play. The ember is glowing.'
    case 15:
      return 'Fifteen days strong. Fully kindled.'
    case 30:
      return 'A full month of consistency. That\'s a blaze.'
    case 100:
      return 'One hundred days. A wildfire run.'
    default:
      return 'Keep the streak alive.'
  }
}

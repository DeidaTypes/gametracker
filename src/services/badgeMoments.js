import { countEarnedBadgeFamilies, getShelfVisibleFamilies } from '../data/badges'
import { dispatchBadgeEarned } from '../components/BadgeReveal'
import { showToast } from '../components/Toast'
import { acknowledgeBadgeCelebration } from './badgeService'

let holdCount = 0
const shownFamilies = new Set()

/**
 * Pause single-badge moments (onboarding holds them until Let's play).
 * release() drops one hold and, once none remain, tells the unlock
 * watcher to look again. The event is deferred one microtask so a
 * Strict Mode remount can re-acquire the hold first.
 */
export function holdBadgeMoments() {
  holdCount += 1
  let released = false
  return function release() {
    if (released) return
    released = true
    holdCount = Math.max(0, holdCount - 1)
    queueMicrotask(() => {
      if (holdCount > 0) return
      try {
        window.dispatchEvent(new Event('badgeMomentsReleased'))
      } catch {
        // no window
      }
    })
  }
}

export function isBadgeMomentsHeld() {
  return holdCount > 0
}

let activeMomentKey = null

/**
 * One full-screen moment at a time: a badge celebration, a summary card,
 * a level-up, or the one-time level card. beginMoment refuses while one
 * is already up. endMoment releases it and tells the queues to look again.
 */
export function beginMoment(key) {
  if (key == null || activeMomentKey != null) return false
  activeMomentKey = key
  return true
}

export function endMoment(key) {
  if (activeMomentKey == null || activeMomentKey !== key) return false
  activeMomentKey = null
  try {
    window.dispatchEvent(new Event('momentEnded'))
  } catch {
    // no window
  }
  return true
}

export function isMomentShowing() {
  return activeMomentKey != null
}

/**
 * Badges whose family has not already been shown this session.
 * Claiming them up front stops a second surface from showing the
 * same family before acknowledge_my_badge lands.
 */
export function claimBadgeMoments(badges) {
  const claimed = []
  for (const badge of badges || []) {
    const family = badge?.family
    if (!family || shownFamilies.has(family)) continue
    shownFamilies.add(family)
    claimed.push(badge)
  }
  return claimed
}

function formatBadgeNames(badges) {
  const names = (badges || []).map((badge) => badge.name).filter(Boolean)
  if (names.length <= 1) return names.join('')
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`
  const rest = names.length - 3
  return `${names[0]}, ${names[1]}, ${names[2]} and ${rest} more`
}

function buildLede(badges, stats) {
  const names = formatBadgeNames(badges)
  const left = getShelfVisibleFamilies().length - countEarnedBadgeFamilies(stats || {})
  if (left > 0) return `${names}. ${left} more to find.`
  return `${names}.`
}

function showSummary(badges, stats, context) {
  const count = badges.length
  const onboarding = context === 'onboarding'
  const detail = {
    badges,
    eyebrow: onboarding ? 'You\u2019re all set' : 'Badges unlocked',
    title: onboarding
      ? `${count} ${count === 1 ? 'badge' : 'badges'} already`
      : `${count} new badges`,
    lede: buildLede(badges, stats),
    cta: onboarding ? 'Let\u2019s play' : 'Got it',
  }
  try {
    window.dispatchEvent(new CustomEvent('badgeSummary', { detail }))
  } catch {
    // no window
  }
}

/**
 * One moment for this arrival.
 * Onboarding (any count) and two or more at once share one card.
 * A single Easy badge is the notice capsule. A single Medium or Hard
 * badge is the full celebration. Every badge actually shown is acknowledged.
 */
export function showBadgeMoments(badges, { context, stats, userId, navigate } = {}) {
  const list = (badges || []).filter(Boolean)
  if (list.length === 0) return

  let shown = []
  if (context === 'onboarding' || list.length >= 2) {
    showSummary(list, stats, context)
    shown = list
  } else if (list.length === 1 && list[0].level === 1) {
    const badge = list[0]
    showToast(
      `Badge unlocked \u00b7 ${badge.name}`,
      'badge',
      4000,
      null,
      badge.icon,
      {
        sub: badge.notice,
        onTap: () => navigate(`/user/id/${userId}/badges`, { state: { openBadge: badge.family } }),
      }
    )
    shown = list
  } else if (list.length === 1 && (list[0].level === 2 || list[0].level === 3)) {
    dispatchBadgeEarned(list[0])
    shown = list
  }

  for (const badge of shown) {
    acknowledgeBadgeCelebration(badge.family)
  }
}

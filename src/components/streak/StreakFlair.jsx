import React from 'react'
import { Flame } from 'lucide-react'
import { getTierByDays } from '../../services/streakMilestoneState'
import './StreakFlair.css'

/**
 * StreakFlair — the small tier chip shown beside a username on reviews
 * and Pulse cards (S16-2 task 5).
 *
 * Sourced from `highestStreakMilestone` — the LIFETIME-highest streak
 * tier a user has ever reached (denormalized on `users.
 * highest_streak_milestone`, kept in sync by
 * streakMilestoneService.recordStreakMilestoneProgress). This is
 * deliberately NOT the user's current streak: the flair upgrades the
 * moment a higher tier is reached and never downgrades if the streak
 * later breaks, matching task 5's "highest milestone reached" wording.
 *
 * Renders nothing for users who haven't reached Spark (3 days) yet —
 * no placeholder/empty chip, per the "hide empty sections" rule.
 */
export default function StreakFlair({ milestoneDays }) {
  const tier = getTierByDays(milestoneDays)
  if (!tier) return null

  return (
    <span
      className="streak-flair"
      style={{ '--streak-flair-color': tier.ringColor }}
      title={`${tier.name} — reached a ${tier.days}-day streak`}
    >
      <Flame size={11} strokeWidth={2} aria-hidden="true" />
      <span className="streak-flair__label">{tier.name}</span>
    </span>
  )
}

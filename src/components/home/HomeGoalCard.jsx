import React from 'react'
import GoalRing from '../GoalRing'
import './HomeGoalCard.css'

/**
 * HomeGoalCard — small "{year} goal progress" card shown beside the
 * "This week" card. Reuses the existing GoalRing component (Sprint 4) and
 * goalService's real Supabase-backed count — never a fabricated number.
 *
 * Renders null entirely when no goal is set for the year (per spec: hide,
 * don't prompt) — Profile already owns the "Set a goal" flow.
 *
 * Props:
 *   goalProgress {{ hasGoal, target, current, year } | null}  null = still loading
 *   loading      {boolean}
 */
function HomeGoalCard({ goalProgress, loading = false }) {
  if (loading || goalProgress === null) {
    return (
      <div className="hgc-card" aria-hidden="true">
        <span className="skeleton hgc-skeleton-ring" />
        <div className="hgc-skeleton-lines">
          <span className="skeleton hgc-skeleton-line" />
          <span className="skeleton hgc-skeleton-line hgc-skeleton-line--short" />
        </div>
      </div>
    )
  }

  if (!goalProgress.hasGoal) return null

  const { current, target, year } = goalProgress
  const remaining = Math.max(0, target - current)

  return (
    <div className="hgc-card" aria-label={`${year} goal: ${current} of ${target} games`}>
      <GoalRing current={current} target={target} year={year} variant="compact" />
      <div className="hgc-info">
        <span className="hgc-headline">{current}/{target}</span>
        <span className="hgc-sub">
          {current >= target ? 'Goal reached!' : `${remaining} to go`}
        </span>
      </div>
    </div>
  )
}

export default HomeGoalCard

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getStreakData } from '../services/streakMilestoneService'
import {
  getGoalProgress,
  computeMilestoneBeat,
} from '../services/goalService'

/**
 * useProgressNudges
 *
 * Fires transient in-app nudges on real threshold crossings only —
 * never fabricates data and never re-fires a nudge the user already saw.
 *
 * Nudge types
 * -----------
 * streak_break      — last_active_date === yesterday AND current_streak > 0.
 *                     The streak will break if no activity is logged today.
 *
 * streak_milestone  — current_streak is within 2 days of 7 / 30 / 100.
 *                     Only the *nearest* upcoming milestone fires at a time.
 *
 * goal_milestone    — computeMilestoneBeat shows the user just crossed a
 *                     proportional milestone inside their yearly game-count goal.
 *
 * Dedup / seen logic
 * ------------------
 * Each nudge has a stable `id` keyed by `userId + type + date/value`. Once
 * the user dismisses a nudge, its id is stored in localStorage so it never
 * resurfaces for the same calendar day (or milestone).
 *
 * Checks run:
 *   • once on mount / userId change
 *   • on `streakUpdated`, `journalEntryAdded`, `goalUpdated` window events
 *   • every CHECK_INTERVAL_MS (5 minutes) while the app is open
 *
 * @returns {{
 *   nudges: Array<{
 *     id: string,
 *     type: 'streak_break' | 'streak_milestone' | 'goal_milestone',
 *     message: string,
 *     meta: object,
 *   }>,
 *   dismissNudge: (id: string) => void,
 * }}
 */

const CHECK_INTERVAL_MS = 5 * 60_000
const SEEN_PREFIX = 'gt:nudge-seen:v1'

const STREAK_MILESTONES = [7, 30, 100]

// ── localStorage seen helpers ────────────────────────────────────────────────

function seenKey(userId, id) {
  return `${SEEN_PREFIX}:${userId}:${id}`
}

function wasSeen(userId, id) {
  try {
    return !!localStorage.getItem(seenKey(userId, id))
  } catch {
    return false
  }
}

function markSeen(userId, id) {
  try {
    localStorage.setItem(seenKey(userId, id), '1')
  } catch {
    // localStorage full / private browsing — best effort
  }
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function todayLocalStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function yesterdayLocalStr() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Main hook ────────────────────────────────────────────────────────────────

export function useProgressNudges() {
  const { user } = useAuth()
  const userId = user?.id || null
  const [nudges, setNudges] = useState([])
  const checkingRef = useRef(false)

  const check = useCallback(async () => {
    if (!userId || checkingRef.current) return
    checkingRef.current = true

    try {
      const today = todayLocalStr()
      const yesterday = yesterdayLocalStr()
      const collected = []

      // ── 1. Streak nudges ──────────────────────────────────────────────────
      const streak = await getStreakData(userId)

      if (streak && streak.current_streak > 0 && streak.last_active_date) {
        // About to break: user was active yesterday but not yet today.
        if (streak.last_active_date === yesterday) {
          const id = `streak_break:${today}`
          if (!wasSeen(userId, id)) {
            collected.push({
              id,
              type: 'streak_break',
              message: `Your ${streak.current_streak}-day streak ends tonight — log any activity to keep it alive!`,
              meta: { streak: streak.current_streak },
            })
          }
        }

        // Milestone close: within 2 days of the next streak milestone.
        // Only the nearest milestone fires so we don't stack multiple nudges.
        const nextMilestone = STREAK_MILESTONES.find(
          (m) => streak.current_streak < m
        )
        if (nextMilestone != null) {
          const daysLeft = nextMilestone - streak.current_streak
          if (daysLeft <= 2) {
            const id = `streak_milestone:${nextMilestone}:${today}`
            if (!wasSeen(userId, id)) {
              collected.push({
                id,
                type: 'streak_milestone',
                message:
                  daysLeft === 1
                    ? `1 day to your ${nextMilestone}-day streak — you're almost there!`
                    : `${daysLeft} days to your ${nextMilestone}-day streak — keep going!`,
                meta: { milestone: nextMilestone, daysLeft, streak: streak.current_streak },
              })
            }
          }
        }
      }

      // ── 2. Goal milestone nudge ───────────────────────────────────────────
      const year = new Date().getFullYear()
      const goal = await getGoalProgress(userId, year)

      if (goal.hasGoal && goal.target && goal.current > 0) {
        const beat = computeMilestoneBeat(goal.current, goal.target)
        if (beat != null) {
          const id = `goal_milestone:${year}:${beat}`
          if (!wasSeen(userId, id)) {
            const remaining = goal.target - goal.current
            collected.push({
              id,
              type: 'goal_milestone',
              message:
                remaining <= 0
                  ? `You hit your ${goal.target}-game goal for ${year}!`
                  : `${beat} games finished — ${remaining} left to hit your ${goal.target}-game goal!`,
              meta: { beat, current: goal.current, target: goal.target, year },
            })
          }
        }
      }

      if (collected.length === 0) return

      setNudges((prev) => {
        const existingIds = new Set(prev.map((n) => n.id))
        const fresh = collected.filter((n) => !existingIds.has(n.id))
        return fresh.length > 0 ? [...prev, ...fresh] : prev
      })
    } catch (err) {
      console.error('[nudges] check failed:', err)
    } finally {
      checkingRef.current = false
    }
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setNudges([])
      return
    }

    check()

    const interval = setInterval(check, CHECK_INTERVAL_MS)
    window.addEventListener('streakUpdated', check)
    window.addEventListener('journalEntryAdded', check)
    window.addEventListener('goalUpdated', check)

    return () => {
      clearInterval(interval)
      window.removeEventListener('streakUpdated', check)
      window.removeEventListener('journalEntryAdded', check)
      window.removeEventListener('goalUpdated', check)
    }
  }, [userId, check])

  const dismissNudge = useCallback(
    (id) => {
      if (userId) markSeen(userId, id)
      setNudges((prev) => prev.filter((n) => n.id !== id))
    },
    [userId]
  )

  return { nudges, dismissNudge }
}

export default useProgressNudges

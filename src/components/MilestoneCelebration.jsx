import React, { useEffect, useRef, useState } from 'react'
import {
  getPendingMilestones,
  markMilestoneSeen,
} from '../services/streakMilestoneService'
import { buildStreakCelebrationProps } from '../services/streakMilestoneState'
import { useAuth } from '../contexts/AuthContext'
import UnlockCelebration from './celebration/UnlockCelebration'

/**
 * MilestoneCelebration — app-level overlay for streak milestones.
 *
 * Mount once in App.jsx. Subscribes to 'streakUpdated' and shows the
 * shared UnlockCelebration shell (S16-1) for each unseen milestone.
 */
export default function MilestoneCelebration() {
  const { user } = useAuth()
  const [milestone, setMilestone] = useState(null)
  const [currentStreak, setCurrentStreak] = useState(0)
  const timerRef = useRef(null)

  function dismiss() {
    clearTimeout(timerRef.current)
    setMilestone(null)
  }

  function checkMilestones(streak) {
    if (!user?.id || !streak) return
    const pending = getPendingMilestones(user.id, streak)
    if (pending.length === 0) return
    const top = Math.max(...pending)
    markMilestoneSeen(user.id, top)
    setCurrentStreak(streak)
    setMilestone(top)
  }

  useEffect(() => {
    function onStreakUpdated(e) {
      const streak = e?.detail?.currentStreak
      checkMilestones(streak)
    }
    window.addEventListener('streakUpdated', onStreakUpdated)
    return () => {
      window.removeEventListener('streakUpdated', onStreakUpdated)
      clearTimeout(timerRef.current)
    }
  }, [user?.id])

  const celebrationProps = milestone
    ? buildStreakCelebrationProps(milestone, currentStreak)
    : null

  return (
    <UnlockCelebration
      open={!!celebrationProps}
      onDismiss={dismiss}
      icon="flame"
      ringColor={celebrationProps?.ringColor}
      tierLabel={celebrationProps?.tierLabel}
      eyebrow={celebrationProps?.eyebrow}
      title={celebrationProps?.title}
      category={celebrationProps?.category}
      description={celebrationProps?.description}
      progressDots={celebrationProps?.progressDots}
      primaryCta="Share it"
      dismissCta="Not now"
      shareTitle={celebrationProps?.shareTitle}
      shareText={celebrationProps?.shareText}
    />
  )
}

/** Dispatch after updateStreak() returns. */
export function dispatchStreakUpdated(currentStreak) {
  try {
    window.dispatchEvent(
      new CustomEvent('streakUpdated', { detail: { currentStreak } })
    )
  } catch {
    // SSR / no-window
  }
}

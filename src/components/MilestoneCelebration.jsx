import React, { useEffect, useRef, useState } from 'react'
import {
  recordStreakMilestoneProgress,
  markMilestoneCelebrated,
} from '../services/streakMilestoneService'
import { buildStreakCelebrationProps } from '../services/streakMilestoneState'
import { useAuth } from '../contexts/AuthContext'
import UnlockCelebration from './celebration/UnlockCelebration'

/**
 * MilestoneCelebration — app-level overlay for streak milestones.
 *
 * Mount once in App.jsx. Subscribes to 'streakUpdated' and shows the
 * shared UnlockCelebration shell (S16-1) for each newly-reached, not-yet-
 * celebrated milestone.
 *
 * S16-2: the reached/celebrated state itself now lives server-side (see
 * streakMilestoneService.recordStreakMilestoneProgress /
 * markMilestoneCelebrated + user_streak_milestones) instead of
 * localStorage, so a milestone can never re-celebrate after a reinstall,
 * a relaunch, or a broken-and-rebuilt streak that re-crosses the same
 * tier — "reached once, ever" (see that service's module doc for the
 * full decision).
 */
export default function MilestoneCelebration() {
  const { user } = useAuth()
  const [milestone, setMilestone] = useState(null)
  const [currentStreak, setCurrentStreak] = useState(0)
  // Guards overlapping async checks — e.g. two 'streakUpdated' events
  // firing before the first round-trip resolves — from double-recording
  // or double-celebrating.
  const checkingRef = useRef(false)

  function dismiss() {
    setMilestone(null)
  }

  async function checkMilestones(streak) {
    if (!user?.id || !streak) return
    if (checkingRef.current) return
    checkingRef.current = true
    try {
      const pending = await recordStreakMilestoneProgress(user.id, streak)
      if (pending.length === 0) return
      // Multiple tiers can be pending at once only if the server-side
      // state was never celebrated for an earlier one (e.g. the app was
      // closed before a prior celebration ran) — show the highest now;
      // any lower pending tier is picked up on the next 'streakUpdated'.
      const top = Math.max(...pending)
      await markMilestoneCelebrated(user.id, top)
      setCurrentStreak(streak)
      setMilestone(top)
    } finally {
      checkingRef.current = false
    }
  }

  useEffect(() => {
    function onStreakUpdated(e) {
      const streak = e?.detail?.currentStreak
      checkMilestones(streak)
    }
    window.addEventListener('streakUpdated', onStreakUpdated)
    return () => {
      window.removeEventListener('streakUpdated', onStreakUpdated)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import UnlockCelebration from './celebration/UnlockCelebration'
import { buildBadgeCelebrationProps } from '../services/badgeCelebrationState'

/**
 * BadgeReveal — app-level overlay for badge tier unlocks.
 *
 * Mount once at the app root (App.jsx). Subscribes to `badgeEarned`
 * window events dispatched by useBadgeUnlockWatcher. Multiple unlocks
 * are queued and shown one at a time via the shared UnlockCelebration
 * shell (S16-1) — no second celebration component.
 */
export default function BadgeReveal() {
  const [queue, setQueue] = useState([])

  const current = queue[0] ?? null

  const dismiss = useCallback(() => {
    setQueue((q) => q.slice(1))
  }, [])

  useEffect(() => {
    function onBadgeEarned(e) {
      const badge = e?.detail?.badge
      if (!badge) return
      setQueue((q) => [...q, badge])
    }
    window.addEventListener('badgeEarned', onBadgeEarned)
    return () => window.removeEventListener('badgeEarned', onBadgeEarned)
  }, [])

  const celebrationProps = useMemo(
    () => (current ? buildBadgeCelebrationProps(current) : null),
    [current]
  )

  const IconComponent = celebrationProps?.Icon
  const icon = IconComponent
    ? <IconComponent size={44} strokeWidth={1.75} aria-hidden="true" />
    : null

  return (
    <UnlockCelebration
      open={!!celebrationProps}
      onDismiss={dismiss}
      icon={icon}
      ringColor={celebrationProps?.ringColor}
      tierLabel={celebrationProps?.tierLabel}
      eyebrow={celebrationProps?.eyebrow}
      title={celebrationProps?.title}
      category={celebrationProps?.category}
      description={celebrationProps?.description}
      progressDots={celebrationProps?.progressDots}
      shareTitle={celebrationProps?.shareTitle}
      shareText={celebrationProps?.shareText}
    />
  )
}

/** Dispatch a badgeEarned event. Called by useBadgeUnlockWatcher. */
export function dispatchBadgeEarned(badge) {
  try {
    window.dispatchEvent(new CustomEvent('badgeEarned', { detail: { badge } }))
  } catch {
    // SSR / no-window
  }
}

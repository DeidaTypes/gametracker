import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UnlockCelebration from './celebration/UnlockCelebration'
import { buildBadgeCelebrationProps } from '../services/badgeCelebrationState'
import { beginMoment, endMoment, isMomentShowing } from '../services/badgeMoments'
import { rankFor, rewardsBetween } from '../data/levels'
import { acknowledgeLevel } from '../services/xpService'

/**
 * BadgeReveal — app-level overlay for badge tier unlocks and level-ups.
 *
 * Mount once at the app root (App.jsx). Subscribes to `badgeEarned` and
 * `levelUp` window events. Multiple moments are queued and shown one at
 * a time, and only while no other moment (summary card included) is up.
 */
function levelDescription(fromLevel, toLevel) {
  const rewards = rewardsBetween(fromLevel, toLevel)
  if (rewards.length === 0) return null
  if (rewards.length === 1) {
    const reward = rewards[0]
    const detail = String(reward.detail || '').trim().replace(/\.$/, '')
    return detail
      ? `${reward.name} unlocked. ${detail}.`
      : `${reward.name} unlocked.`
  }
  const names = rewards.map((reward) => reward.name).filter(Boolean)
  return `Unlocked: ${names.join(', ')}.`
}

function LevelNumber({ level }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-body)',
        fontSize: 40,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
      }}
    >
      {level}
    </span>
  )
}

function levelView(item) {
  return {
    icon: <LevelNumber level={item.level} />,
    ringColor: 'var(--accent)',
    tierLabel: rankFor(item.level).name,
    eyebrow: 'Level up',
    title: `Level ${item.level}`,
    category: `${(Number(item.xpTotal) || 0).toLocaleString()} XP total`,
    description: levelDescription(item.fromLevel, item.level),
    progressDots: null,
    primaryCta: 'Share it',
    dismissCta: 'Not now',
    shareText: `I just hit Level ${item.level} on Checkpoint!`,
  }
}

function badgeView(badge) {
  const props = buildBadgeCelebrationProps(badge)
  const Icon = props.Icon
  return {
    ...props,
    icon: Icon ? <Icon size={44} strokeWidth={1.75} aria-hidden="true" /> : null,
  }
}

export default function BadgeReveal() {
  const queueRef = useRef([])
  const momentKeyRef = useRef(null)
  const closingKeyRef = useRef(null)
  const releaseTimerRef = useRef(null)
  const currentRef = useRef(null)
  const seqRef = useRef(0)
  const [current, setCurrent] = useState(null)
  const [open, setOpen] = useState(false)

  const show = useCallback((item) => {
    currentRef.current = item
    if (item.type === 'level') acknowledgeLevel(item.level)
    setCurrent(item)
    setOpen(true)
  }, [])

  const pump = useCallback(() => {
    if (momentKeyRef.current || closingKeyRef.current) return
    if (isMomentShowing()) return
    const next = queueRef.current.shift()
    if (!next) return
    if (!beginMoment(next.key)) {
      queueRef.current.unshift(next)
      return
    }
    momentKeyRef.current = next.key
    show(next)
  }, [show])

  const pumpRef = useRef(pump)
  pumpRef.current = pump

  const releaseMoment = useCallback(() => {
    if (releaseTimerRef.current) {
      clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
    }
    // A swap keeps the lock. A finished exit (or the fallback below) lets it go.
    if (momentKeyRef.current) return
    const key = closingKeyRef.current
    if (!key) return
    closingKeyRef.current = null
    endMoment(key)
    if (!momentKeyRef.current) {
      currentRef.current = null
      setCurrent(null)
      setOpen(false)
    }
  }, [])

  const dismiss = useCallback(() => {
    if (!momentKeyRef.current) return
    const next = queueRef.current[0]
    if (next && currentRef.current && next.type === currentRef.current.type) {
      queueRef.current.shift()
      show(next)
      return
    }
    closingKeyRef.current = momentKeyRef.current
    momentKeyRef.current = null
    setOpen(false)
    // The exit callback frees the lock as soon as the card is gone.
    // This only fires if that callback never arrives, and it waits past
    // the spring so the next moment cannot open on top of this one.
    releaseTimerRef.current = setTimeout(() => releaseMoment(), 800)
  }, [show, releaseMoment])

  useEffect(() => {
    function enqueue(item) {
      queueRef.current = [...queueRef.current, item]
      pumpRef.current()
    }
    function onBadgeEarned(e) {
      const badge = e?.detail?.badge
      if (!badge) return
      seqRef.current += 1
      enqueue({
        type: 'badge',
        badge,
        key: `badge:${badge.id}:${seqRef.current}`,
      })
    }
    function onLevelUp(e) {
      const detail = e?.detail
      const level = Number(detail?.level)
      if (!Number.isFinite(level)) return
      const fromRaw = Number(detail?.fromLevel)
      seqRef.current += 1
      enqueue({
        type: 'level',
        key: `level:${level}:${seqRef.current}`,
        level,
        xpTotal: Number(detail?.xpTotal) || 0,
        fromLevel: Number.isFinite(fromRaw) ? fromRaw : 0,
      })
    }
    const onEnded = () => pumpRef.current()
    window.addEventListener('badgeEarned', onBadgeEarned)
    window.addEventListener('levelUp', onLevelUp)
    window.addEventListener('momentEnded', onEnded)
    return () => {
      window.removeEventListener('badgeEarned', onBadgeEarned)
      window.removeEventListener('levelUp', onLevelUp)
      window.removeEventListener('momentEnded', onEnded)
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current)
        releaseTimerRef.current = null
      }
      const key = momentKeyRef.current || closingKeyRef.current
      momentKeyRef.current = null
      closingKeyRef.current = null
      if (key) endMoment(key)
    }
  }, [])

  const view = useMemo(() => {
    if (!current) return null
    if (current.type === 'level') return levelView(current)
    return badgeView(current.badge)
  }, [current])

  return (
    <UnlockCelebration
      open={open && !!view}
      onDismiss={dismiss}
      onExitComplete={releaseMoment}
      icon={view?.icon}
      ringColor={view?.ringColor}
      tierLabel={view?.tierLabel}
      eyebrow={view?.eyebrow}
      title={view?.title}
      category={view?.category}
      description={view?.description}
      progressDots={view?.progressDots}
      primaryCta={view?.primaryCta}
      dismissCta={view?.dismissCta}
      shareTitle={view?.shareTitle}
      shareText={view?.shareText}
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

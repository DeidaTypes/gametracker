import { useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { tierFor, rewardsBetween } from '../data/levels'
import { acknowledgeLevel, getMyLevelState } from '../services/xpService'
import { isBadgeMomentsHeld } from '../services/badgeMoments'
import { APP_RESUMED_EVENT, isLongAbsence } from './useAppResume'

/**
 * The two level moments, mounted once next to the badge unlock watcher.
 *
 * level_seen null means the account existed before levels: one
 * "You're Level N" card (level 1 is acknowledged quietly). Otherwise a
 * single celebration for the newest level when it passes level_seen.
 * Nothing is dispatched while onboarding is holding badge moments.
 * A ref of the last level handled stops a second dispatch this session.
 */

function historyLede(level, xpTotal) {
  const tierName = tierFor(level).name
  const xp = `${(Number(xpTotal) || 0).toLocaleString()} XP`
  const names = rewardsBetween(1, level).map((reward) => reward.name).filter(Boolean)
  if (names.length === 0) return `${tierName} \u00b7 ${xp}.`
  return `${tierName} \u00b7 ${xp}. Unlocked so far: ${names.join(', ')}.`
}

function dispatchSummary(detail) {
  try {
    window.dispatchEvent(new CustomEvent('badgeSummary', { detail }))
  } catch {
    // no window
  }
}

function dispatchLevelUp(detail) {
  try {
    window.dispatchEvent(new CustomEvent('levelUp', { detail }))
  } catch {
    // no window
  }
}

export function useLevelWatcher() {
  const { user } = useAuth()
  const userId = user?.id || null
  const handledLevelRef = useRef(null)
  const legacyCardRef = useRef(false)
  const chainRef = useRef(Promise.resolve())
  const genRef = useRef(0)

  useEffect(() => {
    const gen = ++genRef.current
    handledLevelRef.current = null
    legacyCardRef.current = false
    if (!userId) return undefined

    const evaluate = async () => {
      if (gen !== genRef.current) return
      if (isBadgeMomentsHeld()) return
      const state = await getMyLevelState()
      if (gen !== genRef.current) return
      if (!state || isBadgeMomentsHeld()) return

      const level = state.level
      const { levelSeen, xpTotal } = state

      if (levelSeen === null && !legacyCardRef.current) {
        legacyCardRef.current = true
        handledLevelRef.current = level
        if (level >= 2) {
          dispatchSummary({
            badges: [],
            eyebrow: 'Counted from your history',
            title: `You\u2019re Level ${level}`,
            lede: historyLede(level, xpTotal),
            cta: 'Nice',
          })
          acknowledgeLevel(level)
        } else {
          acknowledgeLevel(1)
        }
        return
      }

      if (handledLevelRef.current != null && level <= handledLevelRef.current) return

      const seenFloor = levelSeen == null ? handledLevelRef.current : levelSeen
      if (seenFloor == null || !(level > seenFloor)) return

      handledLevelRef.current = level
      dispatchLevelUp({ level, xpTotal, fromLevel: seenFloor })
    }

    const schedule = () => {
      chainRef.current = chainRef.current.then(() => evaluate()).catch(() => {})
    }

    schedule()

    const onChange = () => schedule()
    const onResume = (event) => {
      if (!isLongAbsence(event)) return
      schedule()
    }

    window.addEventListener('badgesUpdated', onChange)
    window.addEventListener('xpUpdated', onChange)
    window.addEventListener('badgeMomentsReleased', onChange)
    window.addEventListener(APP_RESUMED_EVENT, onResume)
    return () => {
      genRef.current += 1
      window.removeEventListener('badgesUpdated', onChange)
      window.removeEventListener('xpUpdated', onChange)
      window.removeEventListener('badgeMomentsReleased', onChange)
      window.removeEventListener(APP_RESUMED_EVENT, onResume)
    }
  }, [userId])
}

export default useLevelWatcher
